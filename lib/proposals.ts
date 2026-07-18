export type ProposalType = "pre" | "full" | "continuation" | "off_cycle";
export type ProposalState = "draft" | "submitted" | "reopened" | "rescinded";

// numeric columns can arrive from supabase-js as number or string.
export type Proposal = {
  id: string;
  project_id: string;
  cycle_id: string;
  researcher_id: string;
  type: ProposalType;
  parent_proposal_id: string | null;
  title: string;
  year_number: number;
  requested_amount: number | string | null;
  state: ProposalState;
  outcome: string | null;
  funded_amount: number | string | null;
  cv_snapshot_path: string | null;
  submitted_at: string | null;
  reopened_at: string | null;
  rescinded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  researcher_id: string;
  title: string;
  planned_years: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProposalDocument = {
  id: string;
  proposal_id: string;
  requirement_id: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
};

export const PROPOSAL_STATE_LABELS: Record<ProposalState, string> = {
  draft: "Draft",
  submitted: "Submitted",
  reopened: "Reopened",
  rescinded: "Rescinded",
};

export const PROPOSAL_TYPE_LABELS: Record<ProposalType, string> = {
  pre: "Pre-proposal",
  full: "Full proposal",
  continuation: "Continuation",
  off_cycle: "Off-cycle",
};

export function proposalStateLabel(state: string): string {
  return PROPOSAL_STATE_LABELS[state as ProposalState] ?? state;
}

export function proposalTypeLabel(type: string): string {
  return PROPOSAL_TYPE_LABELS[type as ProposalType] ?? type;
}

export function isProposalEditable(state: string): boolean {
  return state === "draft" || state === "reopened";
}
