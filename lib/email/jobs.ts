// SERVER-ONLY. The jobs the daily cron route runs.
//
// Each exported run* function is self-contained: it works out who should be
// told what, calls sendEmail for each, and returns a tally. It NEVER THROWS for
// an expected condition (no manager address, an unreadable table) -- it returns
// a JobResult with a note saying what stopped it, so the route's JSON explains
// itself. The route still wraps each call in try/catch for the unexpected.
//
// Database access is SERVICE-ROLE: a cron request has no user session, so there
// is no RLS context to borrow. That makes the queries here the only guard on
// what the jobs can see, which is why each one is narrow and read-only.
//
// IDEMPOTENCE IS THE DEDUPE KEY, not the schedule. Every send carries a key
// that identifies the thing being announced -- a registration, a cycle's
// deadline -- so the sweep can run every day and only the first run that sees
// something sends about it. That is also what makes a MISSED run harmless:
// the deadline job looks back over a window rather than at yesterday alone.
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { formatPacificDate, portalUrl } from "./format";
import {
  getManagerNotificationAddress,
  getPendingResearcherContacts,
} from "./recipients";
import { sendEmail, type SendOutcome, type SendResult } from "./send";
import { isWithinDaysAfter, type CalendarDate } from "./schedule";

/**
 * How far back the deadline summary will look. A week covers a missed cron day,
 * a Vercel outage, or an email type switched on a few days late, and stops a
 * type turned on in July from mailing a summary of every deadline in history.
 */
export const SUMMARY_WINDOW_DAYS = 7;

export type OutcomeCounts = Record<SendOutcome, number>;

export type JobResult = {
  /** The catalog key the job sends, which is also its name in the response. */
  job: string;
  /** Candidates examined -- pending researchers, or cycle deadlines in window. */
  considered: number;
  /** Sends attempted. Fewer than `considered` means something stopped them. */
  attempted: number;
  counts: OutcomeCounts;
  /** Present only when the job stopped short of sending, and why. */
  note?: string;
};

function emptyCounts(): OutcomeCounts {
  return { sent: 0, logged: 0, skipped_off: 0, duplicate: 0, failed: 0 };
}

/**
 * Fold settled sendEmail results into a tally. A REJECTED promise counts as
 * failed: sendEmail is documented never to throw, so a rejection here means
 * something below it did, and silently dropping it would make the job's report
 * a lie.
 */
function tally(results: PromiseSettledResult<SendResult>[]): OutcomeCounts {
  const counts = emptyCounts();
  for (const r of results) {
    if (r.status === "fulfilled") counts[r.value.outcome] += 1;
    else counts.failed += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// 1. New registration sweep
// ---------------------------------------------------------------------------

/**
 * Tell the manager about every researcher sitting at status 'pending'.
 *
 * ONE EMAIL PER RESEARCHER, not a digest, and deduped on the researcher's user
 * id. That is deliberate: a digest would have to be deduped on its own contents
 * (or on the day it was sent), so either the same person appears in a second
 * digest tomorrow or a registration that arrives the next day is never
 * mentioned at all. Per-researcher, "already told about this one" is exactly
 * what the dedupe key expresses, and the manager gets one message per thing to
 * act on.
 *
 * The sweep is therefore a safety net rather than the primary trigger: it
 * catches registrations no matter when they arrived, including those made
 * before this email type was switched on.
 */
export async function runRegistrationSweep(): Promise<JobResult> {
  const job = "registration_pending";

  const [to, pending] = await Promise.all([
    getManagerNotificationAddress(),
    getPendingResearcherContacts(),
  ]);

  if (!to) {
    return {
      job,
      considered: pending.length,
      attempted: 0,
      counts: emptyCounts(),
      note:
        "No manager notification address is set in email_config, so there was " +
        "nowhere to send. Set it on the System Email page.",
    };
  }
  if (pending.length === 0) {
    return { job, considered: 0, attempted: 0, counts: emptyCounts() };
  }

  const results = await Promise.allSettled(
    pending.map((researcher) =>
      sendEmail({
        key: job,
        to,
        // The RECIPIENT is the manager, who may not be a portal user at all --
        // the address is configured, not looked up. The researcher this is
        // about is recorded as the entity instead.
        recipientUserId: null,
        vars: {
          researcher_name: researcher.fullName ?? researcher.email,
          institution: researcher.institution ?? "not given",
          portal_url: portalUrl(),
        },
        dedupeKey: `${job}:${researcher.userId}`,
        entity: { type: "profile", id: researcher.userId },
      }),
    ),
  );

  return {
    job,
    considered: pending.length,
    attempted: pending.length,
    counts: tally(results),
  };
}

// ---------------------------------------------------------------------------
// 2. Submission deadline summary
// ---------------------------------------------------------------------------

/**
 * The two deadlines a researcher submits against, and what counts as a
 * submission for each.
 *
 * The type lists mirror computeSubmissionEligibility in lib/proposals (and
 * submit_proposal in the database): a 'pre' is due at pre_proposal_closes_at,
 * while 'full' and 'continuation' are both due at full_proposal_due_at. Neither
 * list includes 'off_cycle' -- an off-cycle proposal is invited outside the
 * calendar, is exempt from both deadline checks, and is funded from a separate
 * source, so counting one here would attribute it to a round it never entered.
 */
const SUBMISSION_STAGES = [
  {
    slug: "pre",
    label: "Pre-proposal",
    deadlineOf: (c: CycleDates) => c.pre_proposal_closes_at,
    types: ["pre"],
  },
  {
    slug: "full",
    label: "Full proposal",
    deadlineOf: (c: CycleDates) => c.full_proposal_due_at,
    types: ["full", "continuation"],
  },
] as const;

type CycleDates = {
  id: string;
  name: string;
  pre_proposal_closes_at: string | null;
  full_proposal_due_at: string | null;
};

/**
 * States that mean "in the researcher's hands, not submitted".
 *
 * 'reopened' belongs here even though such a proposal WAS submitted once: the
 * manager has deliberately unlocked it, so right now nothing is submitted and
 * it is the thing to chase. 'rescinded' (researcher pulled it) and 'withdrawn'
 * (manager un-issued the invitation) are excluded from both counts entirely --
 * neither is waiting on anyone.
 */
const UNSUBMITTED_STATES = ["draft", "reopened"];
const COUNTED_STATES = ["submitted", ...UNSUBMITTED_STATES];

type StageCounts = { submitted: number; draft: number };

async function countStage(
  admin: ReturnType<typeof createAdminClient>,
  cycleId: string,
  types: readonly string[],
): Promise<StageCounts | null> {
  const { data, error } = await admin
    .from("proposals")
    .select("state")
    .eq("cycle_id", cycleId)
    .in("type", types)
    .in("state", COUNTED_STATES);
  if (error || !data) return null;

  const rows = data as { state: string }[];
  return {
    submitted: rows.filter((r) => r.state === "submitted").length,
    draft: rows.filter((r) => UNSUBMITTED_STATES.includes(r.state)).length,
  };
}

/**
 * One summary per cycle deadline, once, in the week after it passes.
 *
 * Every cycle is examined rather than only open ones: the status a cycle is in
 * says nothing about whether its deadline just passed (a manager may not have
 * advanced it yet, which is precisely when this email is useful). The date
 * window does the filtering, and it is narrow enough that "every cycle" is a
 * handful of rows.
 */
export async function runSubmissionDeadlineSummary(
  today: CalendarDate,
): Promise<JobResult> {
  const job = "submission_deadline_summary";
  const admin = createAdminClient();

  const [to, cyclesRes] = await Promise.all([
    getManagerNotificationAddress(),
    admin
      .from("cycles")
      .select("id, name, pre_proposal_closes_at, full_proposal_due_at"),
  ]);

  if (cyclesRes.error) {
    return {
      job,
      considered: 0,
      attempted: 0,
      counts: emptyCounts(),
      note: `Could not read cycles: ${cyclesRes.error.message}`,
    };
  }
  const cycles = (cyclesRes.data as CycleDates[] | null) ?? [];

  // Which (cycle, stage) pairs crossed their deadline inside the window.
  const due: { cycle: CycleDates; stage: (typeof SUBMISSION_STAGES)[number] }[] =
    [];
  for (const cycle of cycles) {
    for (const stage of SUBMISSION_STAGES) {
      const deadline = stage.deadlineOf(cycle);
      if (isWithinDaysAfter(deadline, today, SUMMARY_WINDOW_DAYS)) {
        due.push({ cycle, stage });
      }
    }
  }

  if (due.length === 0) {
    return { job, considered: 0, attempted: 0, counts: emptyCounts() };
  }
  if (!to) {
    return {
      job,
      considered: due.length,
      attempted: 0,
      counts: emptyCounts(),
      note:
        "No manager notification address is set in email_config, so there was " +
        "nowhere to send. Set it on the System Email page.",
    };
  }

  const results = await Promise.allSettled(
    due.map(async ({ cycle, stage }) => {
      const deadline = stage.deadlineOf(cycle);
      const counted = await countStage(admin, cycle.id, stage.types);
      // A count that could not be read must not be reported as zero -- "no
      // proposals came in" is a different and alarming claim. Let the send fail
      // instead, visibly, in the log the manager reads.
      if (!counted) {
        throw new Error(
          `Could not count ${stage.slug} proposals for cycle ${cycle.id}`,
        );
      }
      return await sendEmail({
        key: job,
        to,
        recipientUserId: null,
        vars: {
          cycle_name: cycle.name,
          stage_label: stage.label,
          // The window check already proved the deadline parses as a date, so
          // the fallback is belt-and-braces rather than a real branch.
          deadline: formatPacificDate(deadline) ?? (deadline ?? ""),
          submitted_count: String(counted.submitted),
          draft_count: String(counted.draft),
          portal_url: portalUrl(),
        },
        dedupeKey: `${job}:${cycle.id}:${stage.slug}`,
        entity: { type: "cycle", id: cycle.id },
      });
    }),
  );

  return {
    job,
    considered: due.length,
    attempted: due.length,
    counts: tally(results),
  };
}
