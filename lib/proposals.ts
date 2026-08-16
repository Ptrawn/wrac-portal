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
  serial_seq: number | null;
  serial_number: string | null;
  outcome: string | null;
  funded_amount: number | string | null;
  is_wsu: boolean;
  wsu_salary: number | string | null;
  wsu_salary_benefits: number | string | null;
  wsu_wages: number | string | null;
  wsu_wage_benefits: number | string | null;
  arc_amount: number | string | null;
  // Manager's note on the funding decision (esp. why funded below request).
  funding_note: string | null;
  cv_snapshot_path: string | null;
  late_submission_allowed: boolean;
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
  ended_at: string | null;
  ended_reason: string | null;
  final_report_required: boolean;
  // No-cost extension: extra TIME to finish, never extra money and never an
  // entitlement to another funded year (planned_years is deliberately untouched).
  nce_granted: boolean;
  nce_granted_at: string | null;
  nce_reason: string | null;
  nce_extended_to: string | null;
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

/**
 * Display serial for a proposal: the base serial_number with an "F" appended
 * when the proposal is funded. The F is NEVER stored (it's derived from
 * outcome), so it stays correct if the outcome changes. Returns null for a
 * proposal with no serial yet (i.e. not submitted).
 */
export function displaySerial(
  serialNumber: string | null | undefined,
  outcome: string | null | undefined,
): string | null {
  if (!serialNumber) return null;
  return outcome === "funded" ? `${serialNumber}F` : serialNumber;
}

/**
 * Whether a profile institution string looks like Washington State University.
 * Used only as a convenience nudge on the WSU checkbox — never authoritative;
 * the researcher's tick (and the manager's override) is the source of truth.
 */
export function institutionLooksLikeWsu(
  institution: string | null | undefined,
): boolean {
  if (!institution) return false;
  const s = institution.toLowerCase();
  return (
    /\bwsu\b/.test(s) ||
    s.includes("washington state univ")
  );
}

/** Coerce a numeric-or-string-or-null money value to a number (blank -> 0). */
export function moneyToNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * The ARC-eligible ceiling for a WSU proposal: the sum of the four informational
 * WSU line items. Mirrors the DB helper public.proposal_arc_ceiling. This is the
 * maximum that the WSU ARC fund could cover for the proposal — it is a breakout
 * of detail within the requested amount, not additional money.
 */
export function arcEligibleTotal(items: {
  wsu_salary: number | string | null;
  wsu_salary_benefits: number | string | null;
  wsu_wages: number | string | null;
  wsu_wage_benefits: number | string | null;
}): number {
  return (
    moneyToNumber(items.wsu_salary) +
    moneyToNumber(items.wsu_salary_benefits) +
    moneyToNumber(items.wsu_wages) +
    moneyToNumber(items.wsu_wage_benefits)
  );
}

// Result of the client-side pre-check that mirrors submit_proposal's stage and
// deadline enforcement, so a researcher sees WHY submission is blocked before
// they click. The RPC remains the source of truth (a deadline can pass between
// page load and click), so blocked submissions still surface its error inline.
export type SubmissionEligibility = {
  canSubmit: boolean;
  blockedReason: "wrong_stage" | "deadline_passed" | null;
  message: string | null; // explanatory notice for a blocked or overridden proposal
  overrideActive: boolean; // manager granted late_submission_allowed
  deadline: string | null; // the relevant stage deadline (date string), if any
};

/**
 * Mirror of submit_proposal's stage + deadline rules:
 *   pre                 -> cycle 'pre_proposal_open',  deadline pre_proposal_closes_at
 *   full / continuation -> cycle 'full_proposal_open', deadline full_proposal_due_at
 *   off_cycle           -> exempt from both checks
 * A manager override (late_submission_allowed) skips both. A null deadline
 * means "no deadline" and never blocks.
 */
export function computeSubmissionEligibility(input: {
  type: string;
  cycleStatus: string;
  preProposalClosesAt: string | null;
  fullProposalDueAt: string | null;
  lateSubmissionAllowed: boolean;
  // injected so this stays pure/testable; callers pass cycleStagePhrase,
  // formatLongDate, and pacificDateToday from lib/cycles.
  stagePhrase: (status: string) => string;
  formatLongDate: (value: string | null) => string;
  pacificToday: string;
}): SubmissionEligibility {
  const {
    type,
    cycleStatus,
    preProposalClosesAt,
    fullProposalDueAt,
    lateSubmissionAllowed,
    stagePhrase,
    formatLongDate,
    pacificToday,
  } = input;

  const isPre = type === "pre";
  const deadline = isPre ? preProposalClosesAt : fullProposalDueAt;

  // Off-cycle proposals are invited outside the normal cycle and are exempt.
  if (type === "off_cycle") {
    return {
      canSubmit: true,
      blockedReason: null,
      message: null,
      overrideActive: false,
      deadline: null,
    };
  }

  // Manager override skips both stage and deadline checks.
  if (lateSubmissionAllowed) {
    return {
      canSubmit: true,
      blockedReason: null,
      message:
        "The program manager has permitted a late submission for this proposal, so you can submit it outside the normal stage and deadline.",
      overrideActive: true,
      deadline,
    };
  }

  const requiredStatus = isPre ? "pre_proposal_open" : "full_proposal_open";
  const kindPlural = isPre ? "pre-proposals" : "full proposals";
  const kindHyphen = isPre ? "pre-proposal" : "full-proposal";

  // (a) stage: the cycle must be in the status that accepts this type.
  if (cycleStatus !== requiredStatus) {
    return {
      canSubmit: false,
      blockedReason: "wrong_stage",
      message: `This cycle is not currently accepting ${kindPlural} — ${stagePhrase(cycleStatus)}.`,
      overrideActive: false,
      deadline,
    };
  }

  // (b) deadline: inclusive, end of day Pacific. Null means no deadline.
  if (deadline && pacificToday > deadline) {
    return {
      canSubmit: false,
      blockedReason: "deadline_passed",
      message: `The ${kindHyphen} deadline passed on ${formatLongDate(deadline)}. Contact the program manager if you need to submit late.`,
      overrideActive: false,
      deadline,
    };
  }

  return {
    canSubmit: true,
    blockedReason: null,
    message: null,
    overrideActive: false,
    deadline,
  };
}
