"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { unrescindProposal } from "../actions";

/**
 * "Undo rescind" for a proposal the researcher withdrew by mistake. The RPC
 * restores it to 'submitted' when it had been submitted before (submitted_at is
 * set) and to 'draft' otherwise -- the confirm text says which will happen.
 */
export function UnrescindControl({
  cycleId,
  proposalId,
  wasSubmitted,
}: {
  cycleId: string;
  proposalId: string;
  wasSubmitted: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const restoreTo = wasSubmitted ? "Submitted" : "Draft";

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await unrescindProposal(cycleId, proposalId);
      if (res?.error) setError(res.error);
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex flex-col gap-1">
        <span className="font-medium">This proposal was rescinded.</span>
        <span className="text-muted-foreground">
          The researcher withdrew it. It stays in their history and can&apos;t be
          reviewed or funded while rescinded.
        </span>
      </div>

      {!confirming ? (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={isPending}
          onClick={() => setConfirming(true)}
        >
          Undo rescind
        </Button>
      ) : (
        <div className="text-sm flex flex-col gap-2 border rounded-md p-3">
          <p>
            This restores the proposal to{" "}
            <span className="font-medium">{restoreTo}</span>
            {wasSubmitted
              ? " — it had been submitted before it was rescinded, so it returns to the review/funding flow."
              : " — it had never been submitted, so it returns to the researcher as an editable draft."}{" "}
            Continue?
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={isPending} onClick={run}>
              {isPending ? "Working…" : `Restore to ${restoreTo.toLowerCase()}`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
