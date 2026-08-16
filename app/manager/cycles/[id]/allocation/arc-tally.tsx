"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBudget } from "@/lib/cycles";
import { setArcFundTotal } from "./actions";

/**
 * The WSU ARC fund tally in the allocation header — the second of the two
 * tallies (main pool being the first). Shows total / allocated / remaining for
 * the ARC fund, warns when over-allocated, and lets the manager set or clear
 * the ARC fund total inline (it can shift before funding is finalised).
 *
 * `configured` reflects the cycle's raw arc_fund_total column (null => not
 * configured). We DON'T infer this from the summary, which coalesces to 0.
 */
export function ArcTally({
  cycleId,
  configured,
  arcTotal,
  arcAllocated,
  arcRemaining,
}: {
  cycleId: string;
  configured: boolean;
  arcTotal: number;
  arcAllocated: number;
  arcRemaining: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(configured ? String(arcTotal) : "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const overAllocated = configured && arcRemaining < 0;

  const save = (total: number | null) => {
    setError(null);
    startTransition(async () => {
      const res = await setArcFundTotal(cycleId, total);
      if (res?.error) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-md border border-l-4 border-l-status-review p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-status-review">
          WSU ARC Fund
        </div>
        {!editing && (
          <button
            type="button"
            className="text-xs underline underline-offset-4 text-muted-foreground"
            onClick={() => {
              setValue(configured ? String(arcTotal) : "");
              setEditing(true);
            }}
          >
            {configured ? "Edit" : "Set total"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              className="w-36"
              aria-label="ARC fund total"
              placeholder="ARC fund total"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                save(value.trim() === "" ? null : Number(value))
              }
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {configured && (
            <button
              type="button"
              className="text-xs underline underline-offset-4 text-muted-foreground w-fit"
              disabled={isPending}
              onClick={() => save(null)}
            >
              Clear ARC fund (mark not configured)
            </button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : !configured ? (
        <p className="text-sm text-muted-foreground">
          Not configured — set an ARC fund total to track WSU salary/wage
          coverage separately from the main pool.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">
              ARC total
            </div>
            <div className="text-lg font-bold tabular-nums">
              {formatBudget(arcTotal)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">
              ARC allocated
            </div>
            <div className="text-lg font-bold tabular-nums">
              {formatBudget(arcAllocated)}
            </div>
          </div>
          <div
            className={
              overAllocated ? "rounded-md bg-destructive/15 px-2 -mx-2" : ""
            }
          >
            <div className="text-[10px] uppercase text-muted-foreground">
              ARC remaining
            </div>
            <div
              className={
                "text-xl font-extrabold tabular-nums " +
                (overAllocated ? "text-destructive" : "text-status-funded")
              }
            >
              {formatBudget(arcRemaining)}
            </div>
            {overAllocated && (
              <div className="text-[10px] text-destructive font-medium">
                Over ARC fund
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
