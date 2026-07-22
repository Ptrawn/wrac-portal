export type ReviewStage = "pre" | "full";
export type ReviewState = "draft" | "submitted" | "reopened";

export type Review = {
  id: string;
  proposal_id: string;
  reviewer_id: string;
  stage: ReviewStage;
  state: ReviewState;
  submitted_at: string | null;
  reopened_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewAnswer = {
  id: string;
  review_id: string;
  question_id: string;
  score: number | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

// Row shape from list_cycle_proposals_for_manager RPC.
export type ManagerProposalRow = {
  proposal_id: string;
  title: string;
  type: string;
  state: string;
  outcome: string | null;
  requested_amount: number | string | null;
  funded_amount: number | string | null;
  year_number: number;
  submitted_at: string | null;
  parent_proposal_id: string | null;
  project_id: string;
  researcher_id: string;
  researcher_name: string | null;
  researcher_institution: string | null;
  has_full_proposal: boolean;
};

// Row shape from proposal_review_summary RPC (numerics arrive as strings).
export type ProposalReviewSummary = {
  proposal_id: string;
  reviews_submitted: number;
  reviews_in_progress: number;
  total_score: number | string | null;
  average_score: number | string | null;
  max_possible: number | string | null;
};

// Single-row result of cycle_funding_summary RPC (numerics arrive as strings).
export type CycleFundingSummary = {
  total_budget: number | string;
  allocated: number | string;
  remaining: number | string;
  requested_total: number | string;
  decided_count: number;
  undecided_count: number;
  offcycle_allocated: number | string;
};

export const OUTCOME_LABELS: Record<string, string> = {
  advanced: "Advanced",
  declined: "Declined",
  funded: "Funded",
  not_funded: "Not funded",
};

export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return "";
  return OUTCOME_LABELS[outcome] ?? outcome;
}

/** Format a numeric-or-string average to 2dp, or "—" when null. */
export function formatAverage(value: number | string | null): string {
  if (value === null || value === "") return "—";
  const n = Number(value);
  return Number.isNaN(n) ? String(value) : n.toFixed(2);
}

/** Queue badge: state -> label, with "Not started" for no review yet. */
export function reviewStatusLabel(state: string | null | undefined): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "reopened":
      return "Reopened";
    default:
      return "Not started";
  }
}

/** Stage mapping: pre-proposals use the 'pre' set; everything else 'full'. */
export function stageForProposalType(type: string): ReviewStage {
  return type === "pre" ? "pre" : "full";
}

/** A review is editable unless it's submitted (draft / reopened / not-yet-created). */
export function isReviewEditable(state: string | null | undefined): boolean {
  return state !== "submitted";
}
