"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { approveResearcher, getCvUrl, rejectResearcher } from "./actions";

export type PendingResearcher = {
  id: string;
  full_name: string | null;
  institution: string | null;
  email: string | null;
  cv_path: string | null;
  created_at: string;
};

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function PendingRow({ researcher }: { researcher: PendingResearcher }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res?.error) setError(res.error);
    });
  };

  const viewCv = async () => {
    if (!researcher.cv_path) return;
    setError(null);
    const res = await getCvUrl(researcher.cv_path);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {researcher.full_name ?? "(no name)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <span className="text-muted-foreground">Institution</span>
          <span>{researcher.institution ?? "—"}</span>
          <span className="text-muted-foreground">Email</span>
          <span>{researcher.email ?? "—"}</span>
          <span className="text-muted-foreground">Submitted</span>
          <span>{formatDate(researcher.created_at)}</span>
          <span className="text-muted-foreground">CV</span>
          <span>
            {researcher.cv_path ? (
              <button
                type="button"
                onClick={viewCv}
                className="underline underline-offset-4"
              >
                View CV
              </button>
            ) : (
              <span className="text-muted-foreground">No CV uploaded</span>
            )}
          </span>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3">
          <Button
            onClick={() => run(() => approveResearcher(researcher.id))}
            disabled={isPending}
          >
            {isPending ? "Working…" : "Approve"}
          </Button>
          <Button
            variant="outline"
            onClick={() => run(() => rejectResearcher(researcher.id))}
            disabled={isPending}
          >
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PendingList({
  researchers,
}: {
  researchers: PendingResearcher[];
}) {
  if (researchers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No pending registrations.</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {researchers.map((r) => (
        <PendingRow key={r.id} researcher={r} />
      ))}
    </div>
  );
}
