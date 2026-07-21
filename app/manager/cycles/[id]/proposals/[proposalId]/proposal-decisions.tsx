"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { outcomeLabel } from "@/lib/reviews";
import {
  inviteFullProposal,
  reopenProposalAction,
  setProposalOutcome,
} from "../actions";

export function ProposalDecisions({
  cycleId,
  proposalId,
  type,
  state,
  outcome,
  hasFullProposal,
  childId,
}: {
  cycleId: string;
  proposalId: string;
  type: string;
  state: string;
  outcome: string | null;
  hasFullProposal: boolean;
  childId: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newChildId, setNewChildId] = useState<string | null>(null);
  const [confirmingReopen, setConfirmingReopen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isSubmitted = state === "submitted";
  const isPre = type === "pre";
  const effectiveChildId = childId ?? newChildId;

  const setOutcome = (value: string) => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await setProposalOutcome(cycleId, proposalId, value);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  const invite = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await inviteFullProposal(cycleId, proposalId);
      if (res?.error) {
        setError(res.error);
      } else {
        setNewChildId(res.newProposalId ?? null);
        setMessage("Full-proposal draft created.");
        router.refresh();
      }
    });
  };

  const reopen = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await reopenProposalAction(cycleId, proposalId);
      if (res?.error) setError(res.error);
      else {
        setConfirmingReopen(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Advance / decline (submitted pre-proposals) */}
      {isPre && isSubmitted && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">
            Advance decision
            {outcome ? ` · current: ${outcomeLabel(outcome)}` : ""}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={outcome === "advanced" ? "default" : "outline"}
              disabled={isPending}
              onClick={() => setOutcome("advanced")}
            >
              Advance
            </Button>
            <Button
              size="sm"
              variant={outcome === "declined" ? "default" : "outline"}
              disabled={isPending}
              onClick={() => setOutcome("declined")}
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      {/* Invite full proposal */}
      {isPre && isSubmitted && outcome === "advanced" && !effectiveChildId && (
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            disabled={isPending}
            onClick={invite}
            className="w-fit"
          >
            {isPending ? "Inviting…" : "Invite full proposal"}
          </Button>
        </div>
      )}

      {effectiveChildId && (
        <p className="text-sm">
          Full-proposal draft created ·{" "}
          <Link
            href={`/manager/cycles/${cycleId}/proposals/${effectiveChildId}`}
            className="underline underline-offset-4"
          >
            open the draft
          </Link>
        </p>
      )}

      {/* Reopen proposal */}
      {isSubmitted &&
        (!confirmingReopen ? (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={isPending}
            onClick={() => setConfirmingReopen(true)}
          >
            Reopen proposal
          </Button>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Reopening lets the researcher edit and re-upload documents; they
              must resubmit before it&apos;s reviewed again. Continue?
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={reopen}
              >
                {isPending ? "Reopening…" : "Reopen proposal"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => setConfirmingReopen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ))}

      {!isSubmitted && !isPre && (
        <p className="text-sm text-muted-foreground">
          Decision controls appear once this proposal is submitted.
        </p>
      )}
      {!isSubmitted && isPre && (
        <p className="text-sm text-muted-foreground">
          This pre-proposal is {state}; advance decisions apply to submitted
          proposals.
        </p>
      )}

      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
