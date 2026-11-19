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
