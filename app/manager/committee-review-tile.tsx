"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type ReviewProgress = {
  expected_reviews: number;
  submitted_reviews: number;
  outstanding_reviews: number;
};

export type MemberStatus = {
  reviewer_id: string;
  reviewer_name: string | null;
  assigned_count: number;
  submitted_count: number;
  outstanding_count: number;
};

export function CommitteeReviewTile({
  progress,
  members,
}: {
  progress: ReviewProgress;
  members: MemberStatus[];
}) {
  const [open, setOpen] = useState(false);
  const outstanding = progress.outstanding_reviews;
  const behind = members.filter((m) => m.outstanding_count > 0);

  return (
    <Card id="committee-status" className="scroll-mt-4">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xl">Committee review progress</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link href="/manager/committee">Manage committee</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold tabular-nums">
            {progress.submitted_reviews}
            <span className="text-muted-foreground font-normal text-lg">
              {" "}
              / {progress.expected_reviews}
            </span>
          </span>
          <span className="text-sm text-muted-foreground">
            reviews submitted
          </span>
          {outstanding > 0 ? (
            <Badge
              variant="outline"
              className="ml-auto border-amber-500/50 text-amber-600"
            >
              {outstanding} outstanding
            </Badge>
          ) : (
            <Badge variant="secondary" className="ml-auto">
              All in
            </Badge>
          )}
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No committee members yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-sm underline underline-offset-4 w-fit"
            >
              {open
                ? "Hide member breakdown"
                : `Show member breakdown (${behind.length} behind)`}
            </button>
            {open && (
              <ul className="flex flex-col gap-1">
                {members.map((m) => (
                  <li
                    key={m.reviewer_id}
                    className="flex items-center justify-between gap-3 text-sm border rounded-md px-3 py-2"
                  >
                    <span>{m.reviewer_name ?? "(no name)"}</span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground">
                        {m.submitted_count} / {m.assigned_count} done
                      </span>
                      {m.outstanding_count > 0 ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/50 text-amber-600"
                        >
                          {m.outstanding_count} left
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Done</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
