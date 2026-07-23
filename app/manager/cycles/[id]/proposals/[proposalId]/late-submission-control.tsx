"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { setLateSubmission } from "../actions";

export function LateSubmissionControl({
  cycleId,
  proposalId,
  allowed,
  isOffCycle,
}: {
  cycleId: string;
  proposalId: string;
  allowed: boolean;
  isOffCycle: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const apply = (next: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await setLateSubmission(cycleId, proposalId, next);
      if (res?.error) setError(res.error);
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">
          Late submission:{" "}
          <span
            className={
              allowed ? "font-medium text-green-600" : "text-muted-foreground"
            }
          >
            {allowed ? "Allowed" : "Not allowed"}
          </span>
        </span>
        {allowed ? (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => apply(false)}
          >
            {isPending ? "Working…" : "Revoke"}
          </Button>
        ) : (
          !confirming && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirming(true)}
            >
              Allow late submission
            </Button>
          )
        )}
      </div>

      {confirming && !allowed && (
        <div className="text-sm flex flex-col gap-2 border rounded-md p-3">
          <p>
            This lets the researcher submit this proposal outside the normal
            stage and deadline. Continue?
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={isPending} onClick={() => apply(true)}>
              {isPending ? "Working…" : "Allow late submission"}
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
      )}

      {isOffCycle && (
        <p className="text-xs text-muted-foreground">
          Off-cycle proposals are already exempt from stage and deadline checks,
          so this override has no additional effect.
        </p>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
