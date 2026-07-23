"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBudget } from "@/lib/cycles";
import type { ContinuationCandidate } from "@/lib/reviews";
import { inviteContinuation } from "./actions";

export function ContinuationCandidates({
  cycleId,
  candidates,
}: {
  cycleId: string;
  candidates: ContinuationCandidate[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          Continuation candidates{" "}
          <span className="text-muted-foreground font-normal text-base">
            ({candidates.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects are eligible for continuation in this cycle.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <CandidateRow key={c.project_id} cycleId={cycleId} candidate={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CandidateRow({
  cycleId,
  candidate: c,
}: {
  cycleId: string;
  candidate: ContinuationCandidate;
}) {
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);
  const [isPending, startTransition] = useTransition();

  const invite = () => {
    setError(null);
    startTransition(async () => {
      const res = await inviteContinuation(cycleId, c.project_id);
      if (res.error) setError(res.error);
      else {
        setNewId(res.newProposalId ?? null);
        setInvited(true);
      }
    });
  };

  return (
    <li className="border rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium">{c.project_title}</div>
          <div className="text-muted-foreground">
            {c.researcher_name ?? "Unknown"}
            {c.researcher_institution ? ` · ${c.researcher_institution}` : ""}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>
              Year {c.next_year_number} of {c.planned_years}
            </span>
            <span>
              Last funded: Year {c.last_funded_year},{" "}
              {formatBudget(c.last_funded_amount)} ({c.last_funded_cycle_name})
            </span>
            <span>
              Originally projected for Year {c.next_year_number}:{" "}
              {c.projected_amount == null
                ? "—"
                : formatBudget(c.projected_amount)}
            </span>
          </div>
        </div>
        {!invited && (
          <Button
            size="sm"
            className="shrink-0"
            disabled={isPending}
            onClick={invite}
          >
            {isPending ? "Inviting…" : "Invite continuation"}
          </Button>
        )}
      </div>

      {invited && (
        <p className="text-sm text-green-600">
          Continuation draft created ·{" "}
          {newId ? (
            <Link
              href={`/manager/cycles/${cycleId}/proposals/${newId}`}
              className="underline underline-offset-4"
            >
              open the draft
            </Link>
          ) : (
            "reload to see it below"
          )}
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </li>
  );
}
