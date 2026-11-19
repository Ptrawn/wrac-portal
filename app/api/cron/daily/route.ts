// The portal's one scheduled entry point. Vercel Cron calls it once a day
// (vercel.json: "0 15 * * *" -- 07:00 PST / 08:00 PDT, so the manager's mail
// arrives before the working day rather than overnight).
//
// AUTHORISATION IS THE BEARER SECRET, NOTHING ELSE. This route has no user
// session and the jobs behind it use the service-role client, so the secret is
// the only thing between the public internet and a mail-sending endpoint. The
// proxy's login redirect is deliberately switched off for /api/cron/ (Vercel
// Cron sends a header, not a cookie, and would otherwise be bounced to the
// login page), which means the check below is load-bearing in a way the rest of
// the app's route guards are not. An unset or empty CRON_SECRET fails CLOSED:
// no secret configured means nothing is authorised, never "anyone".
//
// ONE JOB CANNOT TAKE DOWN ANOTHER. Each runs in its own try/catch and reports
// its own tally, because the alternative -- a half-run sweep with no record of
// which half -- is the thing a manager cannot recover from. The response is a
// per-job summary so a Vercel log line says what actually happened.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  runFullProposalDueReminder,
  runFundingMeetingReminder,
  runRegistrationSweep,
  runReportDueReminder,
  runReportOverdueReminder,
  runReviewDueReminder,
  runSubmissionDeadlineSummary,
  type JobResult,
} from "@/lib/email/jobs";
import {
  isCalendarDate,
  pacificToday,
  type CalendarDate,
} from "@/lib/email/schedule";

// Nothing about a cron run is cacheable, and a cached 200 would mean the jobs
// silently stopped running.
export const dynamic = "force-dynamic";

const JOBS: {
  name: string;
  run: (today: CalendarDate) => Promise<JobResult>;
}[] = [
  { name: "registration_pending", run: () => runRegistrationSweep() },
  {
    name: "submission_deadline_summary",
    run: (today) => runSubmissionDeadlineSummary(today),
  },
  // Deadline reminders. Order is cosmetic -- they share no state and each one
  // re-reads what it needs -- but it keeps the response readable: the people
  // being chased, then the committee, then the paperwork.
  { name: "full_proposal_due", run: (today) => runFullProposalDueReminder(today) },
  { name: "review_due", run: (today) => runReviewDueReminder(today) },
  { name: "funding_meeting", run: (today) => runFundingMeetingReminder(today) },
  { name: "report_due", run: (today) => runReportDueReminder(today) },
  { name: "report_overdue", run: (today) => runReportOverdueReminder(today) },
];

/**
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time.
 *
 * timingSafeEqual rather than `===`: this endpoint can be called repeatedly by
 * anyone, which is the one setting where a byte-by-byte early exit is actually
 * measurable. It throws on a length mismatch, so lengths are checked first --
 * that leaks the secret's length, which is not worth defending.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  const presented = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/**
 * Which day the jobs should reason about.
 *
 * ?date=YYYY-MM-DD is honoured ONLY in development. Being able to ask "what
 * would you have sent the day after the deadline?" is the difference between
 * testing this and waiting a year for February -- but in production it would
 * let anyone holding the secret re-run history, and the dedupe keys would
 * happily let the first such run send.
 */
function resolveToday(request: Request): {
  today: CalendarDate;
  override: string | null;
  /** Why the override was not used. Null when there was none, or it was used. */
  ignoredBecause: string | null;
} {
  const requested = new URL(request.url).searchParams.get("date");
  if (!requested) {
    return { today: pacificToday(), override: null, ignoredBecause: null };
  }
  // Two different refusals, reported separately: "not allowed here" and "that
  // is not a date" send a developer looking in different places.
  const ignoredBecause =
    process.env.NODE_ENV !== "development"
      ? "?date is honoured in development only"
      : !isCalendarDate(requested)
        ? "?date must be YYYY-MM-DD"
        : null;
  if (ignoredBecause) {
    return { today: pacificToday(), override: requested, ignoredBecause };
  }
  return { today: requested, override: requested, ignoredBecause: null };
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    // No detail: a caller without the secret learns only that it was refused.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { today, override, ignoredBecause } = resolveToday(request);

  const results: (JobResult & { error?: string })[] = [];
  for (const job of JOBS) {
    try {
      results.push(await job.run(today));
    } catch (err: unknown) {
      // The jobs return notes for expected problems, so reaching here means
      // something genuinely unforeseen broke. Record it against the job's name
      // and carry on to the next one.
      console.error(`[cron] ${job.name} threw:`, message(err));
      results.push({
        job: job.name,
        considered: 0,
        attempted: 0,
        counts: { sent: 0, logged: 0, skipped_off: 0, duplicate: 0, failed: 0 },
        error: message(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    today,
    // Says out loud whether anything could have left the building, so a run
    // that reports "logged" everywhere is not mistaken for a delivery failure.
    delivery: process.env.EMAIL_DELIVERY === "live" ? "live" : "log",
    ...(override
      ? {
          date_override: override,
          ...(ignoredBecause
            ? { date_override_ignored: ignoredBecause }
            : {}),
        }
      : {}),
    jobs: results,
  });
}
