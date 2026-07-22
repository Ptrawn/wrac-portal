"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBudget } from "@/lib/cycles";
import { formatAverage } from "@/lib/reviews";
import { clearFundingDecision, setFundingDecision } from "./actions";
import { CommentsButton } from "./comments-button";

type Row = {
  proposal_id: string;
  title: string;
  requested_amount: number | string | null;
  researcher_name: string | null;
  researcher_institution: string | null;
  outcome: string | null;
  funded_amount: number | string | null;
  total_score: number | string | null;
  average_score: number | string | null;
  reviews_submitted: number;
};

export function DecisionRow({
  cycleId,
  row,
}: {
  cycleId: string;
  row: Row;
}) {
  const router = useRouter();
  const requested =
    row.requested_amount == null ? "" : String(row.requested_amount);
  const [amount, setAmount] = useState<string>(
    row.outcome === "funded" && row.funded_amount != null
      ? String(row.funded_amount)
      : requested,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  const requestedNum =
    row.requested_amount == null ? null : Number(row.requested_amount);
  const fundedNum = row.funded_amount == null ? null : Number(row.funded_amount);
  const differs =
    row.outcome === "funded" &&
    fundedNum != null &&
    requestedNum != null &&
    fundedNum !== requestedNum;

  return (
    <div className="border rounded-md p-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium">{row.title}</div>
          <div className="text-muted-foreground">
            {row.researcher_name ?? "Unknown"}
            {row.researcher_institution ? ` · ${row.researcher_institution}` : ""}
          </div>
        </div>
        <div className="text-right text-sm shrink-0">
          <div>Requested {formatBudget(row.requested_amount)}</div>
          <div className="text-muted-foreground text-xs">
            Score {row.total_score == null ? 0 : Number(row.total_score)} · avg{" "}
            {formatAverage(row.average_score)} · {row.reviews_submitted} reviews
          </div>
        </div>
      </div>

      {/* Current decision */}
      <div className="text-sm">
        {row.outcome === "funded" ? (
          <span className="font-medium text-green-600">
            Funded {formatBudget(row.funded_amount)}
            {differs && (
              <span className="text-amber-600">
                {" "}
                of {formatBudget(row.requested_amount)} requested
              </span>
            )}
          </span>
        ) : row.outcome === "not_funded" ? (
          <span className="font-medium text-muted-foreground">Declined</span>
        ) : (
          <span className="text-muted-foreground">Undecided</span>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          className="w-36"
          aria-label="Funded amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(() =>
              setFundingDecision(
                cycleId,
                row.proposal_id,
                true,
                amount.trim() === "" ? null : Number(amount),
              ),
            )
          }
        >
          Fund
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            run(() =>
              setFundingDecision(cycleId, row.proposal_id, false, null),
            )
          }
        >
          Decline
        </Button>
        {row.outcome && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => clearFundingDecision(cycleId, row.proposal_id))}
          >
            Clear
          </Button>
        )}
        <CommentsButton proposalId={row.proposal_id} proposalTitle={row.title} />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
