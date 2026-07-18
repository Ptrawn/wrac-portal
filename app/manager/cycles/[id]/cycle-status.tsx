"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CYCLE_STATUS_SEQUENCE,
  statusLabel,
  type CycleStatus,
} from "@/lib/cycles";
import { setCycleStatus } from "../actions";

export function CycleStatusControl({
  cycleId,
  status,
}: {
  cycleId: string;
  status: CycleStatus;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [isPending, startTransition] = useTransition();

  const idx = CYCLE_STATUS_SEQUENCE.indexOf(status);
  const total = CYCLE_STATUS_SEQUENCE.length;
  const next = idx < total - 1 ? CYCLE_STATUS_SEQUENCE[idx + 1] : null;
  const prev = idx > 0 ? CYCLE_STATUS_SEQUENCE[idx - 1] : null;

  const run = (target: CycleStatus) => {
    setError(null);
    startTransition(async () => {
      const res = await setCycleStatus(cycleId, target);
      if (res?.error) setError(res.error);
      else setConfirmingClose(false);
    });
  };

  const onAdvance = () => {
    if (!next) return;
    if (next === "closed") {
      setConfirmingClose(true);
      return;
    }
    run(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="text-sm">
          {statusLabel(status)}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Step {idx + 1} of {total}
        </span>
      </div>

      {/* simple stepper */}
      <div className="flex flex-wrap gap-1.5">
        {CYCLE_STATUS_SEQUENCE.map((s, i) => (
          <span
            key={s}
            title={statusLabel(s)}
            className={
              "h-1.5 w-7 rounded-full " +
              (i < idx
                ? "bg-foreground/40"
                : i === idx
                  ? "bg-foreground"
                  : "bg-foreground/10")
            }
          />
        ))}
      </div>

      {confirmingClose ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Closing the cycle finalizes it. Continue?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => run("closed")}
            >
              {isPending ? "Closing…" : "Close cycle"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmingClose(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {next ? (
            <Button size="sm" disabled={isPending} onClick={onAdvance}>
              {isPending ? "Working…" : `Advance to ${statusLabel(next)}`}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">
              This cycle is closed — the final status.
            </span>
          )}
          {prev && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(prev)}
            >
              Move back to {statusLabel(prev)}
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
