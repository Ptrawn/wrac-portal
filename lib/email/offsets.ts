// SERVER-ONLY. Where a reminder's schedule comes from.
//
// Three layers, most specific first:
//
//   1. cycle_email_offsets  -- this cycle wants its own schedule
//   2. email_settings.reminder_offsets -- the portal-wide override
//   3. the catalog's defaultReminderOffsets -- what the code ships with
//
// The ORDER is the whole design. A manager who sets a portal-wide schedule
// expects it everywhere except the cycles they have deliberately changed, and a
// manager who has set nothing expects the shipped default -- which, because it
// lives in code, improves for everyone when the default changes rather than
// being frozen as a copy in every row.
//
// NEVER THROWS, and never returns an empty schedule. Any read failure falls
// through to the catalog default, because a reminder sent on the default
// schedule is a far better failure than no reminder at all, and a job must not
// die because one table was briefly unreadable.
//
// Service-role: these are read by cron jobs that have no user session.
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { catalogEntry } from "./catalog";

/** The fallback of last resort, if a reminder type ships without defaults. */
const LAST_RESORT: readonly number[] = [7];

/** Shape the database may hand back; nothing beyond this is trusted. */
function sanitize(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const nums = value
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 120);
  // De-duplicate: the CHECK forbids repeats, but this code also runs against
  // rows written before that constraint existed.
  const unique = [...new Set(nums)];
  return unique.length > 0 ? unique.slice(0, 2) : null;
}

/** The catalog's default for a key, or the last resort if it declares none. */
export function defaultOffsets(emailKey: string): number[] {
  const entry = catalogEntry(emailKey);
  const fromCatalog = sanitize(entry?.defaultReminderOffsets);
  return fromCatalog ?? [...LAST_RESORT];
}

/**
 * The schedule that actually applies, in days before the deadline.
 *
 * `cycleId` is null for reminders that are not tied to a cycle's calendar (the
 * report reminders, which hang off each report's own due date) -- those skip
 * layer 1 entirely rather than pretending to look it up.
 *
 * Sorted descending (furthest-out first) purely so logs and the manager's UI
 * read the way people say them: "30 and 7 days before".
 */
export async function resolveOffsets(
  emailKey: string,
  cycleId: string | null,
): Promise<number[]> {
  const fallback = defaultOffsets(emailKey);

  try {
    const admin = createAdminClient();

    if (cycleId) {
      const { data } = await admin
        .from("cycle_email_offsets")
        .select("offsets")
        .eq("cycle_id", cycleId)
        .eq("email_key", emailKey)
        .maybeSingle();
      const perCycle = sanitize((data as { offsets: unknown } | null)?.offsets);
      if (perCycle) return perCycle.sort((a, b) => b - a);
    }

    const { data: settings } = await admin
      .from("email_settings")
      .select("reminder_offsets")
      .eq("key", emailKey)
      .maybeSingle();
    const global = sanitize(
      (settings as { reminder_offsets: unknown } | null)?.reminder_offsets,
    );
    if (global) return global.sort((a, b) => b - a);

    return fallback.sort((a, b) => b - a);
  } catch {
    return fallback.sort((a, b) => b - a);
  }
}

/**
 * A stored value as the UI should treat it: the cleaned list, or null when the
 * row holds nothing usable and the caller should fall back to the default.
 *
 * Exported so the manager's screens apply exactly the same cleaning as the
 * jobs do, rather than trusting a raw column into an input box.
 */
export function storedOffsets(value: unknown): number[] | null {
  const clean = sanitize(value);
  return clean ? clean.sort((a, b) => b - a) : null;
}

/**
 * Validate what a manager typed. Returns the cleaned list, or a message saying
 * what is wrong -- the SAME rule as the database CHECK
 * (public.valid_reminder_offsets), so the form refuses what Postgres would.
 *
 * `single` is for report_overdue, whose one value means days AFTER the due
 * date: two values there would have no meaning.
 */
export function validateOffsets(
  values: number[],
  single: boolean,
): { ok: true; offsets: number[] } | { ok: false; error: string } {
  if (values.length === 0) {
    return { ok: false, error: "Enter at least one number of days." };
  }
  if (single && values.length > 1) {
    return { ok: false, error: "This reminder takes a single number of days." };
  }
  if (values.length > 2) {
    return { ok: false, error: "Enter at most two reminders." };
  }
  for (const v of values) {
    if (!Number.isInteger(v)) {
      return { ok: false, error: "Use whole numbers of days." };
    }
    if (v < 1 || v > 120) {
      return { ok: false, error: "Each value must be between 1 and 120 days." };
    }
  }
  if (new Set(values).size !== values.length) {
    return { ok: false, error: "The two values must be different." };
  }
  return { ok: true, offsets: [...values].sort((a, b) => b - a) };
}
