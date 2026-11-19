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
