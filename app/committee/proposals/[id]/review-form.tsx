"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ensureReview, saveReviewAnswers, submitReview } from "../../actions";

type Question = {
  id: string;
  prompt: string;
  score_min: number;
  score_max: number;
};

type Props = {
  proposalId: string;
  stage: string;
  reviewId: string | null;
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

type Draft = { score: string; comment: string };

export function ReviewForm(props: Props) {
  const {
    proposalId,
    reviewId,
    reviewState,
    submittedAt,
    editable,
    questions,
    initialAnswers,
  } = props;

  const router = useRouter();

  // Create the review on first open if it doesn't exist yet.
  const [ensuring, setEnsuring] = useState(false);
  const [ensureError, setEnsureError] = useState<string | null>(null);
  useEffect(() => {
    if (reviewId) return;
    setEnsuring(true);
    ensureReview(proposalId).then((res) => {
      if (res?.error) {
        setEnsureError(res.error);
        setEnsuring(false);
      } else {
        router.refresh();
      }
    });
  }, [reviewId, proposalId, router]);

  const initialMap = useMemo(() => {
    const m = new Map<string, Draft>();
    for (const a of initialAnswers) {
      m.set(a.question_id, {
        score: a.score == null ? "" : String(a.score),
        comment: a.comment ?? "",
      });
    }
    return m;
  }, [initialAnswers]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const obj: Record<string, Draft> = {};
    for (const q of questions) {
      obj[q.id] = initialMap.get(q.id) ?? { score: "", comment: "" };
    }
    return obj;
  });

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const setField = (qid: string, field: keyof Draft, value: string) => {
    setSaved(false);
    setDrafts((d) => ({ ...d, [qid]: { ...d[qid], [field]: value } }));
  };

  const scoreOf = (qid: string): number | null => {
    const raw = drafts[qid]?.score ?? "";
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  };

  const enteredTotal = questions.reduce(
    (sum, q) => sum + (scoreOf(q.id) ?? 0),
    0,
  );
  const maxTotal = questions.reduce((sum, q) => sum + q.score_max, 0);

  const buildAnswers = () =>
    questions.map((q) => ({
      questionId: q.id,
      score: scoreOf(q.id),
      comment: (drafts[q.id]?.comment ?? "").trim() || null,
    }));

  const save = () => {
    if (!reviewId) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveReviewAnswers(reviewId, proposalId, buildAnswers());
      if (res?.error) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  const doSubmit = () => {
    if (!reviewId) return;
    setError(null);
    startTransition(async () => {
      // Save current answers first so the RPC sees the latest scores.
      const saveRes = await saveReviewAnswers(
        reviewId,
        proposalId,
        buildAnswers(),
      );
      if (saveRes?.error) {
        setError(saveRes.error);
        return;
      }
      const res = await submitReview(reviewId, proposalId);
      if (res?.error) {
        setError(res.error);
        setConfirming(false);
      } else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  if (!reviewId) {
    return (
      <div className="text-sm text-muted-foreground">
        {ensureError ? (
          <p className="text-red-500">{ensureError}</p>
        ) : (
          <p>{ensuring ? "Preparing your review…" : "Loading…"}</p>
        )}
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No review questions are defined for this stage yet.
      </p>
    );
  }

  // Read-only (submitted) view.
  if (!editable) {
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-accent text-sm p-3 rounded-md">
          Submitted{submittedAt ? ` on ${submittedAt.slice(0, 10)}` : ""}. This
          review is locked unless the manager reopens it.
        </div>
        <ul className="flex flex-col gap-4">
          {questions.map((q) => (
            <li key={q.id} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{q.prompt}</span>
              <span>
                Score: {drafts[q.id]?.score === "" ? "—" : drafts[q.id]?.score}{" "}
                <span className="text-muted-foreground">
                  ({q.score_min}–{q.score_max})
                </span>
              </span>
              {drafts[q.id]?.comment && (
                <span className="text-muted-foreground whitespace-pre-wrap">
                  {drafts[q.id].comment}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Total score: {enteredTotal} / {maxTotal}
        </p>
      </div>
    );
  }

  // Editable (draft / reopened) view.
  return (
    <div className="flex flex-col gap-5">
      {reviewState === "reopened" && (
        <div className="bg-accent text-sm p-3 rounded-md">
          The manager reopened this review for changes.
        </div>
      )}

      <ul className="flex flex-col gap-5">
        {questions.map((q) => (
          <li key={q.id} className="flex flex-col gap-2">
            <span className="text-sm font-medium">{q.prompt}</span>
            <div className="grid gap-1">
              <Label htmlFor={`score-${q.id}`} className="text-xs">
                Score ({q.score_min}–{q.score_max})
              </Label>
              <Input
                id={`score-${q.id}`}
                type="number"
                min={q.score_min}
                max={q.score_max}
                step={1}
                className="w-28"
                value={drafts[q.id]?.score ?? ""}
                onChange={(e) => setField(q.id, "score", e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`comment-${q.id}`} className="text-xs">
                Comment
              </Label>
              <textarea
                id={`comment-${q.id}`}
                className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={drafts[q.id]?.comment ?? ""}
                onChange={(e) => setField(q.id, "comment", e.target.value)}
              />
            </div>
          </li>
        ))}
      </ul>

      <p className="text-sm">
        Total score so far: {enteredTotal} / {maxTotal}
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Saved.</p>}

      {confirming ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Once submitted, your review is locked unless the manager reopens it.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={isPending} onClick={doSubmit}>
              {isPending ? "Submitting…" : "Submit review"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={save}
          >
            {isPending ? "Working…" : "Save draft"}
          </Button>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Review &amp; submit
          </Button>
        </div>
      )}
    </div>
  );
}
