"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { reopenReviewAction } from "../actions";

export function ReopenReviewButton({
  cycleId,
  proposalId,
  reviewId,
}: {
  cycleId: string;
  proposalId: string;
  reviewId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reopen = () => {
    setError(null);
    startTransition(async () => {
      const res = await reopenReviewAction(cycleId, proposalId, reviewId);
      if (res?.error) setError(res.error);
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirming(true)}
      >
        Reopen review
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" disabled={isPending} onClick={reopen}>
          {isPending ? "Reopening…" : "Confirm reopen"}
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
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
