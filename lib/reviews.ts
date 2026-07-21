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
