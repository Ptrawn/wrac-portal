"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewStatusLabel } from "@/lib/reviews";
import { getProposalReviews, type CommentReview } from "./actions";

export function CommentsButton({
  proposalId,
  proposalTitle,
}: {
  proposalId: string;
  proposalTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<CommentReview[] | null>(null);

  const openModal = async () => {
    setOpen(true);
    if (reviews) return; // cache after first load
    setLoading(true);
    setError(null);
    const res = await getProposalReviews(proposalId);
    if (res.error) setError(res.error);
    else setReviews(res.reviews ?? []);
    setLoading(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={openModal}>
        Comments
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-background border rounded-lg shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 p-4 border-b">
              <h2 className="text-lg font-semibold truncate">
                Reviews — {proposalTitle}
              </h2>
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>

            <div className="overflow-y-auto p-4 flex flex-col gap-4">
              {loading && (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              {reviews && reviews.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No committee members.
                </p>
              )}
              {reviews?.map((r, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{r.reviewerName}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {reviewStatusLabel(r.state)}
                      </Badge>
                      {r.state && (
                        <span className="text-sm text-muted-foreground">
                          Total {r.total}
                        </span>
                      )}
                    </div>
                  </div>
                  {!r.state ? (
                    <p className="text-sm text-muted-foreground">
                      This reviewer hasn&apos;t started.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {r.answers.map((a, j) => (
                        <li key={j} className="flex flex-col gap-0.5 text-sm">
                          <span className="text-muted-foreground">
                            {a.prompt}
                          </span>
                          <span>
                            Score: {a.score ?? "—"}{" "}
                            <span className="text-muted-foreground">
                              ({a.min}–{a.max})
                            </span>
                          </span>
                          {a.comment && (
                            <span className="whitespace-pre-wrap">
                              {a.comment}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
