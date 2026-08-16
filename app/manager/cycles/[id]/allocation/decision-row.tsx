"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBudget } from "@/lib/cycles";
import { formatAverage } from "@/lib/reviews";
import { SerialTag } from "@/components/serial-tag";
import { clearFundingDecision, setFundingDecision } from "./actions";
import { CommentsButton } from "./comments-button";

type Row = {
  proposal_id: string;
  title: string;
  serial_number: string | null;
  requested_amount: number | string | null;
  researcher_name: string | null;
  researcher_institution: string | null;
  outcome: string | null;
  funded_amount: number | string | null;
  total_score: number | string | null;
  average_score: number | string | null;
  reviews_submitted: number;
  is_wsu: boolean;
  arc_amount: number | string | null;
  arc_ceiling: number;
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
  // Amount to ARC (WSU only). Pre-fill from the saved decision if any, else 0 --
  // moving money to ARC is a deliberate act, so we don't auto-max it; the
  // ceiling is shown so the manager knows the maximum at a glance.
  const [arc, setArc] = useState<string>(
    row.is_wsu && row.arc_amount != null ? String(row.arc_amount) : "0",
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

  // Saved split (committed values), shown under the current decision.
  const savedArc = row.arc_amount == null ? 0 : Number(row.arc_amount);
  const savedPoolDraw =
    fundedNum == null ? 0 : Math.max(0, fundedNum - savedArc);

  const fund = () =>
    run(() =>
      setFundingDecision(
        cycleId,
        row.proposal_id,
        true,
        amount.trim() === "" ? null : Number(amount),
        row.is_wsu ? (arc.trim() === "" ? 0 : Number(arc)) : 0,
      ),
    );

  return (
    <div className="border rounded-md p-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium flex items-center gap-2">
            {row.serial_number && (
              <SerialTag
                serialNumber={row.serial_number}
                outcome={row.outcome}
              />
            )}
            <span>{row.title}</span>
          </div>
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
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-status-funded">
              Funded {formatBudget(row.funded_amount)}
              {differs && (
                <span className="text-status-review">
                  {" "}
                  of {formatBudget(row.requested_amount)} requested
                </span>
              )}
            </span>
            {row.is_wsu && (
              <span className="text-xs text-muted-foreground">
                {savedArc > 0 ? (
                  <>
                    {formatBudget(savedArc)} from ARC ·{" "}
                    {formatBudget(savedPoolDraw)} from main pool
                  </>
                ) : (
                  <>All {formatBudget(savedPoolDraw)} from main pool (none to ARC)</>
                )}
              </span>
            )}
          </div>
        ) : row.outcome === "not_funded" ? (
          <span className="font-medium text-muted-foreground">Declined</span>
        ) : (
          <span className="text-muted-foreground">Undecided</span>
        )}
      </div>

      {/* WSU ARC eligibility (informational cap) */}
      {row.is_wsu && (
        <div className="text-xs rounded-md border border-status-review/40 bg-status-review/5 p-2">
          <span className="font-medium text-status-review">WSU proposal.</span>{" "}
          ARC-eligible ceiling (sum of WSU line items):{" "}
          <span className="font-semibold">{formatBudget(row.arc_ceiling)}</span>.
          This is the most of the award that the WSU ARC fund can cover.
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] uppercase text-muted-foreground">
            Funded amount
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            className="w-36"
            aria-label="Funded amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {row.is_wsu && (
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] uppercase text-muted-foreground">
              Amount to ARC (max {formatBudget(row.arc_ceiling)})
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              max={Math.min(
                row.arc_ceiling,
                amount.trim() === "" ? row.arc_ceiling : Number(amount),
              )}
              className="w-36"
              aria-label="Amount to ARC"
              value={arc}
              onChange={(e) => setArc(e.target.value)}
            />
          </div>
        )}
        <Button size="sm" disabled={isPending} onClick={fund}>
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

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
