// SERVER-ONLY. Small shared helpers for turning stored values into the strings
// that go into an email body. Pure -- no database, no network.
import "server-only";

import { formatLongDate } from "@/lib/cycles";

/**
 * Where to send people. PORTAL_URL is set per environment (localhost in
 * development, the deployed origin in production).
 *
 * The fallback is deliberate rather than a thrown error: a missing env var must
 * not silently kill every notification, and the production origin is the only
 * sensible guess. If you see this URL in a development email, PORTAL_URL is
 * unset in .env.local.
 */
const FALLBACK_PORTAL_URL = "https://wrac-portal.vercel.app";

export function portalUrl(): string {
  const configured = process.env.PORTAL_URL?.trim();
  return configured && configured.length > 0 ? configured : FALLBACK_PORTAL_URL;
}

/**
 * A stored `date` as a reader-facing string: "2027-03-15" -> "15 March 2027".
 *
 * The formatting itself is formatLongDate from lib/cycles -- the same function
 * the screens use, so a deadline reads identically in an email and on the page
 * it links to. It is already safe to call on a server in any time zone: it
 * parses the y/m/d parts out of the string rather than building a Date, so
 * "2027-03-15" cannot come out as 14 March under UTC. Pass it a `date` column;
 * a timestamptz would lose its time.
 *
 * What this wrapper adds is the null contract. formatLongDate returns an em
 * dash for a missing date and echoes back anything it cannot parse, both of
 * which would slide into an email body unnoticed. Here a missing or malformed
 * date returns null, so the caller has to decide what to say instead.
 */
export function formatPacificDate(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const formatted = formatLongDate(value);
  // Defensive: an unknown month would come back containing the raw digits.
  return formatted === value || formatted === "—" ? null : formatted;
}

/**
 * A timestamptz as a readable Pacific wall-clock time, e.g.
 * "18 November 2026" -> "18 Nov 2026, 3:42 pm PT".
 *
 * The opposite problem from formatPacificDate: these ARE instants (email_log's
 * created_at / sent_at), so the conversion has to happen in a real time zone
 * rather than by string surgery. en-GB for day-month order, matching
 * formatLongDate elsewhere in the app, and "PT" spelled out because a manager
 * reading a send log needs to know which clock it is.
 *
 * Returns an em dash for a missing value: unlike an email body, a log table
 * with a gap in it reads correctly.
 */
export function formatPacificDateTime(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  const shown = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
  return `${shown} PT`;
}
