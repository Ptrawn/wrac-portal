"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { setReviewParticipation } from "../../actions";
import { ReviewForm } from "./review-form";

type Question = {
  id: string;
  prompt: string;
  question_type: string;
  score_min: number;
  score_max: number;
};

type Props = {
  proposalId: string;
  stage: string;
  reviewId: string | null;
  participation: "undecided" | "reviewing" | "declined";
  reviewState: string | null;
  submittedAt: string | null;
  editable: boolean;
  questions: Question[];
  initialAnswers: {
    question_id: string;
    score: number | null;
    comment: string | null;
  }[];
};

/**
 * Wraps the review with the "will you review this?" participation gate:
 *   undecided -> the Yes/No gate (no scoring form yet)
 *   reviewing -> the scoring form (plus a subtle decline-instead option)
 *   declined  -> a declined state with a switch-back button (no scoring form)
 *   submitted -> the locked, read-only form (participation is locked)
 */
export function ReviewWorkspace(props: Props) {
  const {
    proposalId,
    stage,
    reviewId,
    participation,
    reviewState,
    submittedAt,
    editable,
    questions,
    initialAnswers,
  } = props;

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const choose = (p: "reviewing" | "declined") => {
    setError(null);
    startTransition(async () => {
      const res = await setReviewParticipation(proposalId, p);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  const form = (
    <ReviewForm
      proposalId={proposalId}
      stage={stage}
      reviewId={reviewId}
      reviewState={reviewState}
      submittedAt={submittedAt}
      editable={editable}
      questions={questions}
      initialAnswers={initialAnswers}
    />
  );

  // Submitted: participation is locked; show the read-only form, no gate/toggle.
  if (reviewState === "submitted") {
    return form;
  }

  // Declined (not submitted): no scoring form, offer to switch back.
  if (participation === "declined") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-md border bg-muted/40 p-3 text-sm flex flex-col gap-1">
          <p className="font-medium">You&apos;ve declined to review this proposal.</p>
          <p className="text-muted-foreground">
            You&apos;re excluded from this proposal&apos;s scoring — you won&apos;t
            affect its total or its maximum possible. You can change your mind
            until you submit or the review deadline passes.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          size="sm"
          className="w-fit"
          disabled={isPending}
          onClick={() => choose("reviewing")}
        >
          {isPending ? "Working…" : "Actually, I'll review it"}
        </Button>
      </div>
    );
  }

  // Undecided: the gate, shown before any scoring form.
  if (participation !== "reviewing") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-status-review/40 bg-status-review/5 p-3 text-sm flex flex-col gap-1">
          <p className="font-medium">Will you review this proposal?</p>
          <p className="text-muted-foreground">
            If you decline, you&apos;re removed from this proposal&apos;s scoring —
            you won&apos;t count toward its total or its maximum possible. Decline
            if it&apos;s outside your expertise. You can change your mind until you
            submit or the review deadline passes.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => choose("reviewing")}
          >
            {isPending ? "Working…" : "Yes, I'll review"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => choose("declined")}
          >
            No, I&apos;ll decline
          </Button>
        </div>
      </div>
    );
  }

  // Reviewing: the scoring form, plus a subtle "decline instead" option while
  // the review is still editable (draft/reopened).
  return (
    <div className="flex flex-col gap-4">
      {form}
      {editable && (
        <div className="border-t pt-3 flex flex-col gap-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-4 w-fit disabled:opacity-50"
            disabled={isPending}
            onClick={() => choose("declined")}
          >
            Changed your mind? Decline to review this proposal instead.
          </button>
        </div>
      )}
    </div>
  );
}
