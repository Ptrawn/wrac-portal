// SERVER-ONLY. Date arithmetic for the scheduled jobs.
//
// The scheduled jobs reason entirely in Pacific CALENDAR DAYS, because that is
// what the cycle calendar is made of: pre_proposal_closes_at and friends are
// `date` columns meaning end-of-day Pacific. A job that asked "is this deadline
// in the past?" with a UTC instant would answer yes for seven hours of every
// Pacific day before it actually was.
//
// So everything here works on "YYYY-MM-DD" strings. Nothing in this file
// constructs a Date from a date string, and the one place a Date is needed --
// finding out what today is -- goes through Intl in America/Los_Angeles.
import "server-only";

import { daysUntilDate, pacificDateToday } from "@/lib/cycles";

/** A plain "YYYY-MM-DD" calendar date. Only the format is implied, not validity. */
export type CalendarDate = string;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today's date in America/Los_Angeles as "YYYY-MM-DD".
 *
 * This is pacificDateToday from lib/cycles, re-exported under the name the jobs
 * read naturally. It is reused rather than reimplemented because the screens
 * already decide "is this deadline passed?" with it, and a job that drew its
 * own line would eventually disagree with the page the manager is looking at.
 * lib/cycles imports nothing, so pulling it in here costs nothing and cannot
 * drag client code into a server module.
 */
export function pacificToday(): CalendarDate {
  return pacificDateToday();
}

/** True for a well-formed "YYYY-MM-DD". Does not check that the day exists. */
export function isCalendarDate(value: unknown): value is CalendarDate {
  return typeof value === "string" && DATE_ONLY.test(value);
}

/**
 * Whole days from `dateStr` to `todayStr`, i.e. how long ago `dateStr` was.
 * Positive = in the past, 0 = today, negative = still to come. Null if either
 * string is unparseable.
 *
 * The inverse of daysUntilDate, which both pages and jobs use; defined in terms
 * of it so there is one implementation of "how many days apart are these two
 * date strings" in the codebase. That one compares at UTC midnight on both
 * sides, which cancels out exactly -- no shift is possible when neither operand
 * carries a time of day.
 */
export function daysSince(
  dateStr: string | null | undefined,
  todayStr: CalendarDate,
): number | null {
  const until = daysUntilDate(dateStr ?? null, todayStr);
  return until === null ? null : -until;
}

/**
 * True when `dateStr` is in the past relative to `todayStr` and no more than
 * `maxDays` days behind it: the window a catch-up job fires in.
 *
 * Strictly past (>= 1), because a cycle deadline is inclusive -- a researcher
 * may still submit all day on the deadline date, so nothing has "passed" until
 * the Pacific date has rolled over.
 *
 * The upper bound is what makes a missed run harmless: the job can fire any day
 * inside the window and the dedupe key makes sure only the first one sends.
 * Without the bound, turning an email type on in July would mail the manager a
 * summary of every deadline the portal has ever had.
 */
export function isWithinDaysAfter(
  dateStr: string | null | undefined,
  todayStr: CalendarDate,
  maxDays: number,
): boolean {
  const since = daysSince(dateStr, todayStr);
  return since !== null && since >= 1 && since <= maxDays;
}

// ---------------------------------------------------------------------------
// The reminder selection rule
// ---------------------------------------------------------------------------

/**
 * Which reminder, if any, is due today for a deadline.
 *
 * Given a deadline D, a set of offsets O (days BEFORE D) and today T, an offset
 * o is ELIGIBLE when `D - o <= T <= D`: its window has opened and the deadline
 * has not passed. The SMALLEST eligible offset wins.
 *
 * Two consequences, both deliberate:
 *
 *   1. A MISSED REMINDER IS CAUGHT UP, NOT SKIPPED. If the cron does not run on
 *      the 30-day mark, the 30-day reminder still goes out the next day it does
 *      run -- its window stays open until the deadline. The email says "in 19
 *      days" rather than "in 30", because the phrase is computed from today
 *      (see daysLeftPhrase), so a late reminder is still TRUE.
 *
 *   2. A LARGER MISSED OFFSET IS NEVER SENT LATE ONCE A SMALLER ONE IS DUE.
 *      Taking the smallest eligible offset means that once the 7-day window
 *      opens, 7 is what sends. A recipient who has already had the near one
 *      must not then receive the far one, which would read as going backwards.
 *      Each offset still sends at most once, because the dedupe key carries it.
 *
 * Returns null when nothing is due: before the earliest window, or after D.
 * A deadline that cannot be parsed is treated as "nothing due" rather than an
 * error -- a malformed date must not stop the rest of the job.
 */
export function pickOffset(
  deadline: string | null | undefined,
  todayStr: CalendarDate,
  offsets: readonly number[],
): number | null {
  const until = daysUntilDate(deadline ?? null, todayStr);
  // until > 0 means the deadline is ahead; 0 is the deadline itself; negative
  // means it has passed, and a passed deadline gets no "due soon" reminder.
  if (until === null || until < 0) return null;

  let best: number | null = null;
  for (const o of offsets) {
    if (!Number.isFinite(o) || o < 1) continue;
    if (until <= o && (best === null || o < best)) best = o;
  }
  return best;
}

/**
 * How long a reminder keeps chasing an overdue thing: the first send is n days
 * after the due date, and the window closes 14 days after that.
 *
 * Bounded for the same reason the deadline summary is: without an upper bound,
 * switching the type on would mail about every report that has ever been late.
 * The dedupe key means only the first day inside the window actually sends; the
 * width is there so a missed cron day does not lose the reminder entirely.
 */
export const OVERDUE_WINDOW_DAYS = 14;

/**
 * True when an overdue reminder is due today: at least `daysAfter` days past
 * the due date, and no more than `daysAfter + OVERDUE_WINDOW_DAYS`.
 */
export function isOverdueDue(
  dueDate: string | null | undefined,
  todayStr: CalendarDate,
  daysAfter: number,
): boolean {
  const since = daysSince(dueDate, todayStr);
  if (since === null) return false;
  return since >= daysAfter && since <= daysAfter + OVERDUE_WINDOW_DAYS;
}

/**
 * How much time is left, as a phrase for an email body: "today", "tomorrow" or
 * "in 12 days".
 *
 * Computed from TODAY, never from the offset that triggered the send. A 30-day
 * reminder that catches up a week late must not tell the recipient they have 30
 * days when they have 23 -- the whole point of the catch-up window is that the
 * late message is still accurate.
 *
 * Returns null for an unparseable date, and for a deadline already past (no
 * reminder in this family is sent then, so the caller has nothing to say).
 */
export function daysLeftPhrase(
  deadline: string | null | undefined,
  todayStr: CalendarDate,
): string | null {
  const until = daysUntilDate(deadline ?? null, todayStr);
  if (until === null || until < 0) return null;
  if (until === 0) return "today";
  if (until === 1) return "tomorrow";
  return `in ${until} days`;
}
