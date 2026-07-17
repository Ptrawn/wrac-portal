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
