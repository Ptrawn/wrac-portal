// Shapes shared between the server read and the browser table.
//
// Separate from shared.ts on purpose: shared.ts imports lib/email/catalog and
// lib/email/format, both of which are "server-only" and would throw if they
// reached the client bundle. The log table is a client component, so anything
// it needs at RUNTIME -- not just as an erased type -- has to live here, in a
// module with no server imports at all.

export const LOG_STATUSES = ["sent", "logged", "failed", "sending"] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

/**
 * A log row as the table renders it. The time arrives already formatted:
 * converting to Pacific needs a fixed time zone, and doing it on the server
 * keeps the viewer's own locale out of a log that records Pacific deadlines.
 */
export type LogRow = {
  id: string;
  /** Already formatted, e.g. "18 Nov 2026, 3:42 pm PT". */
  time: string;
  emailKey: string;
  /** Catalog label, or the raw key when the type has since been removed. */
  typeLabel: string;
  recipient: string;
  subject: string;
  status: string;
  error: string | null;
  body: string;
};

export type LogFilters = {
  /** Catalog key, or null for every type. */
  emailKey?: string | null;
  status?: string | null;
  offset?: number;
};

export type LogPage = {
  rows: LogRow[];
  /** True when the read returned a full page, so there may be more behind it. */
  hasMore: boolean;
  error: string | null;
};
