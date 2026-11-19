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
import { resolveOffsets } from "./offsets";
import {
  getApprovedCommitteeContacts,
  getManagerNotificationAddress,
  getPendingResearcherContacts,
  getUserContact,
  type UserContact,
} from "./recipients";
import { sendEmail, type SendOutcome, type SendResult } from "./send";
import {
  daysLeftPhrase,
  isOverdueDue,
  isWithinDaysAfter,
  pickOffset,
  type CalendarDate,
} from "./schedule";

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

// ===========================================================================
// Deadline reminders (batch 4b)
// ===========================================================================
//
// All five follow the same shape:
//
//   find the deadline  ->  resolveOffsets  ->  pickOffset(deadline, today)
//   ->  if an offset is due, find who to tell  ->  one sendEmail each
//
// pickOffset is where the schedule lives (see schedule.ts): it opens each
// offset's window at D - o and closes it at D, takes the smallest window that
// is open, and the dedupe key carries BOTH the deadline and the offset. That
// combination is what makes a daily job safe to run daily: each offset sends
// once per deadline, a missed day is caught up rather than lost, and MOVING a
// deadline produces a fresh key, so the new date gets its own reminders.
//
// {days_left} is always computed from TODAY, never from the offset, so a
// reminder that catches up late still states the truth.

/**
 * Cycle statuses a cycle-based reminder will fire for.
 *
 * 'setup' is a cycle being built -- its dates are drafts and nobody should be
 * chased against them. 'closed' is over. This is the same exclusion
 * committee_review_progress, committee_member_review_status and
 * committee_dashboard use (20260816140000), so a reminder cannot contradict
 * the counts on the dashboards.
 */
const REMINDER_CYCLE_EXCLUDED_STATUSES = ["setup", "closed"];

/**
 * Project statuses that stop report reminders.
 *
 * projects.status is one of proposed / active / completed / ended / declined
 * (20260718093841). 'ended' is a project the researcher stopped early and
 * 'declined' was never funded -- chasing either for paperwork would be wrong.
 *
 * 'completed' DELIBERATELY still gets reminders. The only code path that writes
 * 'completed' is submit_report when a FINAL report is submitted
 * (20260723090000:443), so it is tempting to read an open report on a completed
 * project as a leftover nobody is waiting for. It is not, because two
 * manager-initiated paths create a real obligation AFTER completion, and
 * neither touches projects.status:
 *
 *   - reopen_report (20260723090000:452) sends a submitted report back to
 *     'reopened'. Reopen the final report of a completed project and the
 *     manager is waiting for a corrected submission on a project still marked
 *     completed. The manager's own cross-cycle report dashboard
 *     (app/manager/reports/page.tsx) lists it as outstanding, so a reminder
 *     that skipped it would contradict the screen.
 *   - create_report (20260910090000:86, superseding 20260723090000:250) has no
 *     project-status guard, so a manager can add a pending report to a
 *     completed project.
 *
 * Excluding 'completed' would silence both. A stale pending status report left
 * behind by an earlier year is the cost of that, and it stops on its own: the
 * overdue window closes 14 days past its due date.
 */
const REPORT_PAUSED_PROJECT_STATUSES = ["ended", "declined"];

/**
 * Report states that still owe something. reports.state is pending / submitted
 * / reopened (20260723090000); 'reopened' is a submitted report the manager
 * sent back, so it is outstanding again.
 */
const REPORT_OPEN_STATES = ["pending", "reopened"];

/** Proposal states that mean "still being written". */
const PROPOSAL_OPEN_STATES = ["draft", "reopened"];

type ActiveCycle = {
  id: string;
  name: string;
  pre_review_due_at: string | null;
  full_review_due_at: string | null;
  full_proposal_due_at: string | null;
  funding_meeting_at: string | null;
};

/**
 * Cycles a reminder may fire for. Returns null (not an empty list) when the
 * read itself failed, so a job can tell "nothing to do" from "I could not
 * look" and report the second honestly.
 */
async function activeCycles(
  admin: ReturnType<typeof createAdminClient>,
): Promise<ActiveCycle[] | null> {
  const { data, error } = await admin
    .from("cycles")
    .select(
      "id, name, pre_review_due_at, full_review_due_at, full_proposal_due_at, funding_meeting_at",
    )
    .not("status", "in", `(${REMINDER_CYCLE_EXCLUDED_STATUSES.join(",")})`);
  if (error || !data) return null;
  return data as ActiveCycle[];
}

/**
 * Remembers the contacts a job has already looked up.
 *
 * getUserContact is an auth.users round trip per call, and one researcher may
 * own several drafts or several reports in a single run. Memoised per job run
 * only -- never across runs, so a corrected address is picked up the next day.
 * A failed lookup is cached as null too: it will fail the same way all run.
 */
function contactCache(): (userId: string) => Promise<UserContact | null> {
  const seen = new Map<string, Promise<UserContact | null>>();
  return (userId: string) => {
    const hit = seen.get(userId);
    if (hit) return hit;
    const pending = getUserContact(userId);
    seen.set(userId, pending);
    return pending;
  };
}

/** Nothing to do, reported without ceremony. */
function idle(job: string): JobResult {
  return { job, considered: 0, attempted: 0, counts: emptyCounts() };
}

function unreadable(job: string, what: string): JobResult {
  return {
    job,
    considered: 0,
    attempted: 0,
    counts: emptyCounts(),
    note: `Could not read ${what}.`,
  };
}

/** A recipient with no address: nothing to send, and nobody at fault. */
const NO_ADDRESS: SendResult = { outcome: "skipped_off" };

function summarize(
  job: string,
  results: PromiseSettledResult<SendResult>[],
): JobResult {
  return {
    job,
    considered: results.length,
    attempted: results.length,
    counts: tally(results),
  };
}

// ---------------------------------------------------------------------------
// 3. Full proposal deadline approaching (to the researcher)
// ---------------------------------------------------------------------------

/**
 * Chase the researchers who still have an unsubmitted full proposal.
 *
 * WHO: proposals of type 'full' or 'continuation' -- the two that submit
 * against full_proposal_due_at (computeSubmissionEligibility in lib/proposals,
 * mirroring submit_proposal) -- in state 'draft' or 'reopened'. A 'submitted'
 * proposal needs no chasing; 'rescinded' (the researcher pulled it) and
 * 'withdrawn' (the manager un-issued the invitation, 20260830100000) are not
 * waiting on anybody, so neither is reminded. 'pre' and 'off_cycle' submit
 * against different rules and are out of scope.
 */
export async function runFullProposalDueReminder(
  today: CalendarDate,
): Promise<JobResult> {
  const job = "full_proposal_due";
  const admin = createAdminClient();
  const contactFor = contactCache();

  const cycles = await activeCycles(admin);
  if (!cycles) return unreadable(job, "cycles");

  const sends: Promise<SendResult>[] = [];

  for (const cycle of cycles) {
    const deadline = cycle.full_proposal_due_at;
    if (!deadline) continue;

    const offsets = await resolveOffsets(job, cycle.id);
    const offset = pickOffset(deadline, today, offsets);
    if (offset === null) continue;

    const { data, error } = await admin
      .from("proposals")
      .select("id, title, researcher_id")
      .eq("cycle_id", cycle.id)
      .in("type", ["full", "continuation"])
      .in("state", PROPOSAL_OPEN_STATES);
    if (error || !data) continue;

    const shown = formatPacificDate(deadline) ?? deadline;
    const left = daysLeftPhrase(deadline, today) ?? "soon";

    for (const proposal of data as {
      id: string;
      title: string;
      researcher_id: string;
    }[]) {
      sends.push(
        (async () => {
          const contact = await contactFor(proposal.researcher_id);
          if (!contact) return NO_ADDRESS;
          return await sendEmail({
            key: job,
            to: contact.email,
            recipientUserId: proposal.researcher_id,
            vars: {
              researcher_name: contact.fullName ?? contact.email,
              proposal_title: proposal.title,
              cycle_name: cycle.name,
              deadline: shown,
              days_left: left,
              portal_url: portalUrl(),
            },
            dedupeKey: `${job}:${proposal.id}:${deadline}:${offset}`,
            entity: { type: "proposal", id: proposal.id },
          });
        })(),
      );
    }
  }

  if (sends.length === 0) return idle(job);
  return summarize(job, await Promise.allSettled(sends));
}

// ---------------------------------------------------------------------------
// 4. Review deadline approaching (to the committee)
// ---------------------------------------------------------------------------

/** The two review rounds, their deadline column, and the proposals in each. */
const REVIEW_STAGES = [
  {
    slug: "pre",
    label: "Pre-proposal review",
    deadlineOf: (c: ActiveCycle) => c.pre_review_due_at,
    types: ["pre"],
  },
  {
    slug: "full",
    label: "Full proposal review",
    deadlineOf: (c: ActiveCycle) => c.full_review_due_at,
    types: ["full", "continuation"],
  },
] as const;

/**
 * Remind committee members who still have reviews to do.
 *
 * WHAT COUNTS AS OUTSTANDING -- taken from committee_dashboard
 * (20260816140000, item 6c), which is the screen the recipient will open:
 *
 *     to_review   = submitted proposals in the cycle MINUS those this member
 *                   has declined
 *     submitted   = this member's own reviews with participation 'reviewing'
 *                   AND state 'submitted'
 *     outstanding = max(to_review - submitted, 0)
 *
 * The consequence worth stating is that a member who has never OPENED a
 * proposal has no review row at all and still counts it as outstanding. That
 * is the point: the member who has done nothing is exactly who a reminder is
 * for. The narrower rule -- only proposals already opted into with
 * participation 'reviewing', which is what committee_review_progress counts
 * for the manager's aggregate -- would mail everyone EXCEPT the people who
 * have not started. It also means the number in the email matches the number
 * on the member's own dashboard rather than quietly disagreeing with it.
 *
 * Scoped to the STAGE (the dashboard figure is per cycle), because the two
 * rounds have separate deadlines and a member can be done with one, not the
 * other. A declined proposal is never outstanding; a member who declined
 * everything in the round is not mailed at all.
 */
export async function runReviewDueReminder(
  today: CalendarDate,
): Promise<JobResult> {
  const job = "review_due";
  const admin = createAdminClient();

  const cycles = await activeCycles(admin);
  if (!cycles) return unreadable(job, "cycles");

  const members = await getApprovedCommitteeContacts();
  if (members.length === 0) return idle(job);

  const sends: Promise<SendResult>[] = [];

  for (const cycle of cycles) {
    for (const stage of REVIEW_STAGES) {
      const deadline = stage.deadlineOf(cycle);
      if (!deadline) continue;

      const offsets = await resolveOffsets(job, cycle.id);
      const offset = pickOffset(deadline, today, offsets);
      if (offset === null) continue;

      // The proposals this round is about.
      const { data: proposalData, error: proposalError } = await admin
        .from("proposals")
        .select("id")
        .eq("cycle_id", cycle.id)
        .in("type", stage.types)
        .eq("state", "submitted");
      if (proposalError || !proposalData) continue;
      const proposalIds = (proposalData as { id: string }[]).map((p) => p.id);
      if (proposalIds.length === 0) continue;

      // Every review row on those proposals in one read, rather than one read
      // per member: the committee is a dozen people, the proposals a few dozen.
      const { data: reviewData, error: reviewError } = await admin
        .from("reviews")
        .select("reviewer_id, participation, state")
        .in("proposal_id", proposalIds);
      if (reviewError || !reviewData) continue;
      const reviews = reviewData as {
        reviewer_id: string;
        participation: string;
        state: string;
      }[];

      const shown = formatPacificDate(deadline) ?? deadline;
      const left = daysLeftPhrase(deadline, today) ?? "soon";

      for (const member of members) {
        const mine = reviews.filter((r) => r.reviewer_id === member.userId);
        const declined = mine.filter(
          (r) => r.participation === "declined",
        ).length;
        const done = mine.filter(
          (r) => r.participation === "reviewing" && r.state === "submitted",
        ).length;
        const outstanding = Math.max(proposalIds.length - declined - done, 0);
        if (outstanding === 0) continue;

        sends.push(
          sendEmail({
            key: job,
            to: member.email,
            recipientUserId: member.userId,
            vars: {
              recipient_name: member.fullName ?? member.email,
              cycle_name: cycle.name,
              stage_label: stage.label,
              deadline: shown,
              days_left: left,
              // A counted noun rather than a bare number: "You have 1 review"
              // reads as a typo, and the template cannot pluralise.
              outstanding_count:
                outstanding === 1 ? "1 review" : `${outstanding} reviews`,
              portal_url: portalUrl(),
            },
            dedupeKey: `${job}:${cycle.id}:${stage.slug}:${member.userId}:${deadline}:${offset}`,
            entity: { type: "cycle", id: cycle.id },
          }),
        );
      }
    }
  }

  if (sends.length === 0) return idle(job);
  return summarize(job, await Promise.allSettled(sends));
}

// ---------------------------------------------------------------------------
// 5. Funding meeting approaching (to the committee)
// ---------------------------------------------------------------------------

/**
 * Tell the committee the allocation meeting is coming.
 *
 * EVERY approved member, with no outstanding-work filter: attendance is the
 * ask, and a member who has finished every review still needs to be in the
 * room. The date is cycles.funding_meeting_at (20261119090000).
 */
export async function runFundingMeetingReminder(
  today: CalendarDate,
): Promise<JobResult> {
  const job = "funding_meeting";
  const admin = createAdminClient();

  const cycles = await activeCycles(admin);
  if (!cycles) return unreadable(job, "cycles");

  const dueCycles: { cycle: ActiveCycle; date: string; offset: number }[] = [];
  for (const cycle of cycles) {
    const date = cycle.funding_meeting_at;
    if (!date) continue;
    const offsets = await resolveOffsets(job, cycle.id);
    const offset = pickOffset(date, today, offsets);
    if (offset !== null) dueCycles.push({ cycle, date, offset });
  }
  if (dueCycles.length === 0) return idle(job);

  const members = await getApprovedCommitteeContacts();
  if (members.length === 0) return idle(job);

  const sends: Promise<SendResult>[] = [];
  for (const { cycle, date, offset } of dueCycles) {
    const shown = formatPacificDate(date) ?? date;
    const left = daysLeftPhrase(date, today) ?? "soon";
    for (const member of members) {
      sends.push(
        sendEmail({
          key: job,
          to: member.email,
          recipientUserId: member.userId,
          vars: {
            recipient_name: member.fullName ?? member.email,
            cycle_name: cycle.name,
            meeting_date: shown,
            days_left: left,
            portal_url: portalUrl(),
          },
          dedupeKey: `${job}:${cycle.id}:${member.userId}:${date}:${offset}`,
          entity: { type: "cycle", id: cycle.id },
        }),
      );
    }
  }

  return summarize(job, await Promise.allSettled(sends));
}

// ---------------------------------------------------------------------------
// 6 & 7. Report reminders (to the researcher)
// ---------------------------------------------------------------------------

type OpenReport = {
  id: string;
  type: string;
  due_date: string;
  project: {
    id: string;
    title: string;
    status: string;
    researcher_id: string;
  } | null;
};

/**
 * Every report that still owes something and has a date to owe it by.
 *
 * Reports are deliberately NOT filtered by cycle status: a report falls due
 * months after its cycle closes, so silencing reminders the day a manager
 * closes a cycle would silence exactly the ones that matter. The PROJECT's
 * status is the relevant gate, not the cycle's.
 */
async function openReports(
  admin: ReturnType<typeof createAdminClient>,
): Promise<OpenReport[] | null> {
  const { data, error } = await admin
    .from("reports")
    .select(
      "id, type, due_date, project:projects(id, title, status, researcher_id)",
    )
    .in("state", REPORT_OPEN_STATES)
    .not("due_date", "is", null);
  if (error || !data) return null;

  return (data as unknown as OpenReport[]).filter(
    (r) =>
      r.project != null &&
      !REPORT_PAUSED_PROJECT_STATUSES.includes(r.project.status),
  );
}

/** Reports whose due date is coming up. */
export async function runReportDueReminder(
  today: CalendarDate,
): Promise<JobResult> {
  const job = "report_due";
  const admin = createAdminClient();
  const contactFor = contactCache();

  const reports = await openReports(admin);
  if (!reports) return unreadable(job, "reports");
  if (reports.length === 0) return idle(job);

  // A report's deadline is its own, not the cycle's, so there is no per-cycle
  // override to resolve -- one portal-wide schedule covers all of them.
  const offsets = await resolveOffsets(job, null);

  const sends: Promise<SendResult>[] = [];
  for (const report of reports) {
    const project = report.project;
    if (!project) continue;
    const offset = pickOffset(report.due_date, today, offsets);
    if (offset === null) continue;

    const shown = formatPacificDate(report.due_date) ?? report.due_date;
    const left = daysLeftPhrase(report.due_date, today) ?? "soon";

    sends.push(
      (async () => {
        const contact = await contactFor(project.researcher_id);
        if (!contact) return NO_ADDRESS;
        return await sendEmail({
          key: job,
          to: contact.email,
          recipientUserId: project.researcher_id,
          vars: {
            researcher_name: contact.fullName ?? contact.email,
            project_title: project.title,
            report_type: report.type,
            deadline: shown,
            days_left: left,
            portal_url: portalUrl(),
          },
          dedupeKey: `${job}:${report.id}:${report.due_date}:${offset}`,
          entity: { type: "report", id: report.id },
        });
      })(),
    );
  }

  if (sends.length === 0) return idle(job);
  return summarize(job, await Promise.allSettled(sends));
}

/**
 * Reports that are past due and still not in.
 *
 * ONE reminder per report per due date -- the dedupe key carries no offset,
 * because there is only ever one. A manager who moves the due date gives the
 * researcher a fresh date and, with it, a fresh overdue reminder if that one
 * is missed too.
 */
export async function runReportOverdueReminder(
  today: CalendarDate,
): Promise<JobResult> {
  const job = "report_overdue";
  const admin = createAdminClient();
  const contactFor = contactCache();

  const reports = await openReports(admin);
  if (!reports) return unreadable(job, "reports");
  if (reports.length === 0) return idle(job);

  // A single value, meaning days AFTER. resolveOffsets guarantees at least one.
  const daysAfter = (await resolveOffsets(job, null))[0];

  const sends: Promise<SendResult>[] = [];
  for (const report of reports) {
    const project = report.project;
    if (!project) continue;
    if (!isOverdueDue(report.due_date, today, daysAfter)) continue;

    const shown = formatPacificDate(report.due_date) ?? report.due_date;

    sends.push(
      (async () => {
        const contact = await contactFor(project.researcher_id);
        if (!contact) return NO_ADDRESS;
        return await sendEmail({
          key: job,
          to: contact.email,
          recipientUserId: project.researcher_id,
          vars: {
            researcher_name: contact.fullName ?? contact.email,
            project_title: project.title,
            report_type: report.type,
            deadline: shown,
            portal_url: portalUrl(),
          },
          dedupeKey: `${job}:${report.id}:${report.due_date}`,
          entity: { type: "report", id: report.id },
        });
      })(),
    );
  }

  if (sends.length === 0) return idle(job);
  return summarize(job, await Promise.allSettled(sends));
}
