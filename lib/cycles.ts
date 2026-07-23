export type CycleStatus =
  | "setup"
  | "pre_proposal_open"
  | "pre_review"
  | "advance_decision"
  | "full_proposal_open"
  | "full_review"
  | "deliberation"
  | "funding_decisions"
  | "closed";

// date columns come back from supabase-js as strings; numeric(14,2) can arrive
// as a number, so total_budget is typed to accept either.
export type Cycle = {
  id: string;
  name: string;
  year: number;
  status: CycleStatus;
  total_budget: number | string | null;
  pre_proposal_opens_at: string | null;
  pre_proposal_closes_at: string | null;
  pre_review_due_at: string | null;
  full_proposal_due_at: string | null;
  full_review_due_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewStage = "pre" | "full";

export type ReviewQuestion = {
  id: string;
  cycle_id: string;
  stage: ReviewStage;
  prompt: string;
  score_min: number;
  score_max: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type DocumentStage = "pre" | "full" | "status_report" | "final_report";

export type DocumentRequirement = {
  id: string;
  cycle_id: string;
  stage: DocumentStage;
  label: string;
  description: string | null;
  is_required: boolean;
  accepted_file_types: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const STATUS_LABELS: Record<CycleStatus, string> = {
  setup: "Setup",
  pre_proposal_open: "Pre-proposal open",
  pre_review: "Pre-review",
  advance_decision: "Advance decision",
  full_proposal_open: "Full-proposal open",
  full_review: "Full review",
  deliberation: "Deliberation",
  funding_decisions: "Funding decisions",
  closed: "Closed",
};

// The lifecycle order the Manager advances a cycle through.
export const CYCLE_STATUS_SEQUENCE: CycleStatus[] = [
  "setup",
  "pre_proposal_open",
  "pre_review",
  "advance_decision",
  "full_proposal_open",
  "full_review",
  "deliberation",
  "funding_decisions",
  "closed",
];

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as CycleStatus] ?? status;
}

export function formatBudget(value: number | string | null): string {
  if (value === null || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatDate(value: string | null): string {
  return value && value.length > 0 ? value : "—";
}

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Human-readable date, e.g. "2026-11-30" -> "30 November 2026", matching the
 * wording the submit_proposal RPC uses in its error messages. Parses the
 * y/m/d parts directly (no Date object) so it never shifts across time zones.
 */
export function formatLongDate(value: string | null): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  const monthName = LONG_MONTHS[Number(mo) - 1] ?? mo;
  return `${Number(d)} ${monthName} ${y}`;
}

// Mirrors the stage phrases in submit_proposal's error messages.
export const CYCLE_STAGE_PHRASES: Record<CycleStatus, string> = {
  setup: "it is still in setup",
  pre_proposal_open: "it is in the pre-proposal stage",
  pre_review: "it is in pre-proposal review",
  advance_decision: "it is in the advancement-decision stage",
  full_proposal_open: "it is in the full-proposal stage",
  full_review: "it is in full-proposal review",
  deliberation: "it is in deliberation",
  funding_decisions: "it is in funding decisions",
  closed: "it is closed",
};

export function cycleStagePhrase(status: string): string {
  return (
    CYCLE_STAGE_PHRASES[status as CycleStatus] ?? `it is in the ${status} stage`
  );
}

/**
 * Today's calendar date in America/Los_Angeles as "YYYY-MM-DD". Deadlines are
 * inclusive and mean end-of-day Pacific, so a stage deadline is passed exactly
 * when this Pacific date has rolled past it — the client-visible equivalent of
 * the RPC's `now() >= ((deadline + 1 day) at time zone 'America/Los_Angeles')`.
 */
export function pacificDateToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
