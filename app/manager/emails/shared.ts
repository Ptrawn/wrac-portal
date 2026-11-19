// SERVER-SIDE reads and page constants for the System Email page.
//
// Deliberately NOT a "use server" module: that file may only export async
// functions, and the page and the "load more" action need to share one log
// reader so a freshly rendered page and a paged-in page agree on what a row is.
//
// Client-safe types and constants live in ./log-types -- this module imports
// lib/email/*, which is "server-only" and must never reach the browser bundle.
//
// Every read here uses the MANAGER'S OWN session client, not the service-role
// client. RLS already restricts all three email tables to managers, so a
// non-manager's query returns nothing rather than relying on the page guard
// alone.
import { catalogEntry, type EmailAudience } from "@/lib/email/catalog";
import { formatPacificDateTime } from "@/lib/email/format";
import type { createClient } from "@/lib/supabase/server";
import type { LogFilters, LogPage, LogRow } from "./log-types";

/** The manager's own session client, as lib/supabase/server hands it over. */
type SessionClient = Awaited<ReturnType<typeof createClient>>;

/** One page of the send log, and the "load more" step. */
export const LOG_PAGE_SIZE = 50;

type RawLogRow = {
  id: string;
  email_key: string;
  recipient_email: string;
  subject: string;
  body: string;
  status: string;
  error: string | null;
  created_at: string;
};

function toLogRow(r: RawLogRow): LogRow {
  return {
    id: r.id,
    time: formatPacificDateTime(r.created_at),
    emailKey: r.email_key,
    // Falling back to the raw key matters: a log row outlives its catalog
    // entry, and "(unknown type)" would lose the only clue to what was sent.
    typeLabel: catalogEntry(r.email_key)?.label ?? r.email_key,
    recipient: r.recipient_email,
    subject: r.subject,
    status: r.status,
    error: r.error,
    body: r.body,
  };
}

/**
 * One page of email_log, newest first, with the filters applied in the DATABASE
 * rather than over an already-fetched page -- filtering 50 loaded rows would
 * quietly answer "no failures" when the failures are on page two.
 */
export async function fetchLogPage(
  supabase: SessionClient,
  filters: LogFilters = {},
): Promise<LogPage> {
  const { emailKey = null, status = null, offset = 0 } = filters;

  let query = supabase
    .from("email_log")
    .select(
      "id, email_key, recipient_email, subject, body, status, error, created_at",
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + LOG_PAGE_SIZE - 1);

  if (emailKey) query = query.eq("email_key", emailKey);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return { rows: [], hasMore: false, error: error.message };

  const raw = (data as RawLogRow[] | null) ?? [];
  return {
    rows: raw.map(toLogRow),
    hasMore: raw.length === LOG_PAGE_SIZE,
    error: null,
  };
}

/** The order the audience groups appear in on the page. */
export const AUDIENCE_ORDER: EmailAudience[] = [
  "researcher",
  "committee",
  "manager",
];

export const AUDIENCE_HEADINGS: Record<EmailAudience, string> = {
  researcher: "Researchers",
  committee: "Committee",
  manager: "Manager",
};

/**
 * Types the manager does not manage here. system_test is the batch-1 self-test:
 * it ignores its own mode (ALWAYS_AUTO_KEYS), and a switch that does nothing is
 * worse than no switch. Its editor at /manager/emails/system_test still works
 * if someone navigates to it directly.
 */
export const HIDDEN_KEYS = ["system_test"];
