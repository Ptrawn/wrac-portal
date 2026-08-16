"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/cycles";
import {
  grantNoCostExtension,
  revokeNoCostExtension,
  unendProject,
} from "../actions";

type Props = {
  cycleId: string;
  proposalId: string;
  projectId: string;
  projectTitle: string;
  status: string;
  plannedYears: number;
  endedAt: string | null;
  endedReason: string | null;
  nceGranted: boolean;
  nceGrantedAt: string | null;
  nceReason: string | null;
  nceExtendedTo: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  active: "Active",
  completed: "Completed",
  ended: "Ended",
  declined: "Declined",
};

/**
 * Project-level manager corrections, shown on the proposal detail page (the
 * manager reaches projects only through proposals today): undo an accidental
 * "end project", and grant/revoke a no-cost extension.
 */
export function ProjectControls(props: Props) {
  const {
    cycleId,
    proposalId,
    projectId,
    projectTitle,
    status,
    plannedYears,
    endedAt,
    endedReason,
    nceGranted,
    nceGrantedAt,
    nceReason,
    nceExtendedTo,
  } = props;

  const router = useRouter();
  const [confirmingUnend, setConfirmingUnend] = useState(false);
  const [granting, setGranting] = useState(false);
  const [reason, setReason] = useState("");
  const [extendedTo, setExtendedTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else {
        onOk?.();
        router.refresh();
      }
    });
  };

  const grant = () => {
    if (reason.trim() === "") {
      setError("Give a short reason for the extension.");
      return;
    }
    run(
      () =>
        grantNoCostExtension(
          cycleId,
          proposalId,
          projectId,
          reason.trim(),
          extendedTo.trim() === "" ? null : extendedTo,
        ),
      () => {
        setGranting(false);
        setReason("");
        setExtendedTo("");
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Project status */}
      <div className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <span className="text-muted-foreground">Project</span>
        <span>{projectTitle}</span>
        <span className="text-muted-foreground">Status</span>
        <span
          className={
            status === "ended"
              ? "font-medium text-destructive"
              : status === "active"
                ? "font-medium text-status-funded"
                : ""
          }
        >
          {STATUS_LABELS[status] ?? status}
        </span>
        <span className="text-muted-foreground">Planned years</span>
        <span>{plannedYears}</span>
      </div>

      {/* Ended -> offer undo */}
      {status === "ended" && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <div className="text-sm flex flex-col gap-0.5">
            <span className="font-medium">This project was ended.</span>
            <span className="text-muted-foreground">
              {endedAt ? `Ended ${formatDate(endedAt.slice(0, 10))}.` : ""}
              {endedReason ? ` Reason: ${endedReason}` : ""}
            </span>
          </div>
          {!confirmingUnend ? (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={isPending}
              onClick={() => setConfirmingUnend(true)}
            >
              Undo end project
            </Button>
          ) : (
            <div className="text-sm flex flex-col gap-2 rounded-md border bg-background p-3">
              <p>
                This reopens the project — back to{" "}
                <span className="font-medium">Active</span> if it has a funded
                proposal, otherwise <span className="font-medium">Proposed</span>
                . The end date and reason are cleared. Continue?
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    run(() => unendProject(cycleId, proposalId, projectId), () =>
                      setConfirmingUnend(false),
                    )
                  }
                >
                  {isPending ? "Working…" : "Undo end project"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    setConfirmingUnend(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No-cost extension */}
      <div className="flex flex-col gap-2 border-t pt-4">
        <div>
          <h4 className="font-medium text-sm">No-cost extension</h4>
          <p className="text-xs text-muted-foreground">
            A no-cost extension gives the researcher{" "}
            <span className="font-medium">additional time only</span> to finish
            work that is already funded. It provides{" "}
            <span className="font-medium">no additional funding</span> and does{" "}
            <span className="font-medium">
              not entitle the project to another funded year
            </span>{" "}
            — it doesn&apos;t change the planned years or make the project a
            continuation candidate.
          </p>
        </div>

        {nceGranted ? (
          <div className="flex flex-col gap-2 rounded-md border border-status-review/40 bg-status-review/5 p-3">
            <div className="text-sm flex flex-col gap-0.5">
              <span className="font-medium text-status-review">
                No-cost extension granted
                {nceGrantedAt ? ` ${formatDate(nceGrantedAt.slice(0, 10))}` : ""}
              </span>
              {nceExtendedTo && (
                <span>
                  New expected completion:{" "}
                  <span className="font-medium">
                    {formatDate(nceExtendedTo)}
                  </span>
                </span>
              )}
              {nceReason && (
                <span className="text-muted-foreground whitespace-pre-wrap">
                  Reason: {nceReason}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                Time only — no additional funding was granted.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={isPending}
              onClick={() =>
                run(() =>
                  revokeNoCostExtension(cycleId, proposalId, projectId),
                )
              }
            >
              {isPending ? "Working…" : "Revoke extension"}
            </Button>
          </div>
        ) : !granting ? (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={isPending}
            onClick={() => setGranting(true)}
          >
            Grant no-cost extension
          </Button>
        ) : (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="grid gap-1">
              <Label htmlFor="nce_reason" className="text-xs">
                Reason (required)
              </Label>
              <Input
                id="nce_reason"
                placeholder="e.g. Field trial delayed by weather"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="nce_extended_to" className="text-xs">
                New expected completion date (optional)
              </Label>
              <Input
                id="nce_extended_to"
                type="date"
                className="w-48"
                value={extendedTo}
                onChange={(e) => setExtendedTo(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This grants time only. No money moves, and the project still has{" "}
              {plannedYears} planned year{plannedYears === 1 ? "" : "s"} — the
              extension does not add a funded year.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={isPending} onClick={grant}>
                {isPending ? "Working…" : "Grant extension"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setGranting(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
