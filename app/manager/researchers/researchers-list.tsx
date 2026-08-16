"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approveResearcher, getCvUrl, rejectResearcher } from "../actions";

export type ResearcherRow = {
  id: string;
  full_name: string | null;
  institution: string | null;
  email: string | null;
  status: string;
  cv_path: string | null;
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "approved") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

/** All registered researchers, filterable by status, with the approve/reject
 *  actions inline so the pending queue isn't a separate destination. */
export function ResearchersList({
  researchers,
}: {
  researchers: ResearcherRow[];
}) {
  const [filter, setFilter] = useState<string>("all");

  const counts = {
    all: researchers.length,
    pending: researchers.filter((r) => r.status === "pending").length,
    approved: researchers.filter((r) => r.status === "approved").length,
    rejected: researchers.filter((r) => r.status === "rejected").length,
  };

  const shown =
    filter === "all"
      ? researchers
      : researchers.filter((r) => r.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Show:</span>
        {(["all", "pending", "approved", "rejected"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {key === "all" ? "All" : STATUS_LABELS[key]} ({counts[key]})
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No researchers match this filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => (
            <ResearcherCard key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResearcherCard({ r }: { r: ResearcherRow }) {
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
    if (!r.cv_path) return;
    setError(null);
    const res = await getCvUrl(r.cv_path);
    if (res.error) setError(res.error);
    else if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
  };

  return (
    <li className="border rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm min-w-0">
          <div className="font-medium">{r.full_name ?? "(no name)"}</div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{r.institution ?? "No institution"}</span>
            {r.email && <span>{r.email}</span>}
            <span>Registered {formatDate(r.created_at)}</span>
          </div>
        </div>
        <Badge variant={statusVariant(r.status)} className="shrink-0">
          {STATUS_LABELS[r.status] ?? r.status}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {r.cv_path ? (
          <Button size="sm" variant="outline" onClick={viewCv}>
            View CV
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">No CV uploaded</span>
        )}
        {r.status === "pending" && (
          <>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => run(() => approveResearcher(r.id))}
            >
              {isPending ? "Working…" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => rejectResearcher(r.id))}
            >
              Reject
            </Button>
          </>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}
