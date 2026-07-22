import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import { formatBudget, formatDate, statusLabel, type Cycle } from "@/lib/cycles";
import { proposalStateLabel, proposalTypeLabel } from "@/lib/proposals";
import {
  formatAverage,
  outcomeLabel,
  type ManagerProposalRow,
  type ProposalReviewSummary,
} from "@/lib/reviews";

type Row = ManagerProposalRow & {
  summary: ProposalReviewSummary | null;
};

const TYPE_GROUPS: { type: string; title: string }[] = [
  { type: "pre", title: "Pre-proposals" },
  { type: "full", title: "Full proposals" },
  { type: "continuation", title: "Continuations" },
  { type: "off_cycle", title: "Off-cycle" },
];

function avgNumber(summary: ProposalReviewSummary | null): number {
  const v = summary?.average_score;
  if (v === null || v === undefined || v === "") return -Infinity;
  const n = Number(v);
  return Number.isNaN(n) ? -Infinity : n;
}

export default async function ManagerProposalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await requireManager();
  const { id: cycleId } = await params;

  const supabase = await createClient();

  const { data: cycleData } = await supabase
    .from("cycles")
    .select("*")
    .eq("id", cycleId)
    .single();
  if (!cycleData) notFound();
  const cycle = cycleData as Cycle;

  const { data: rowData, error: rowError } = await supabase.rpc(
    "list_cycle_proposals_for_manager",
    { p_cycle_id: cycleId },
  );
  const { data: summaryData } = await supabase.rpc("proposal_review_summary", {
    p_cycle_id: cycleId,
  });

  const summaries = new Map<string, ProposalReviewSummary>(
    ((summaryData as ProposalReviewSummary[] | null) ?? []).map((s) => [
      s.proposal_id,
      s,
    ]),
  );
  const rows: Row[] = ((rowData as ManagerProposalRow[] | null) ?? []).map(
    (r) => ({ ...r, summary: summaries.get(r.proposal_id) ?? null }),
  );

  const { count: committeeCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "committee");
  const totalReviewers = committeeCount ?? 0;

  const submittedCount = rows.filter((r) => r.state === "submitted").length;

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-4xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/manager/cycles/${cycleId}`}
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              ← Cycle
            </Link>
            <Link
              href={`/manager/cycles/${cycleId}/allocation`}
              className="text-sm underline underline-offset-4"
            >
              Allocation tool →
            </Link>
          </div>
          <div className="flex items-center justify-between gap-3 mt-1">
            <h1 className="text-2xl font-bold">
              {cycle.name} ({cycle.year}) — proposals
            </h1>
            <Badge variant="secondary">{statusLabel(cycle.status)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length} proposals · {submittedCount} submitted · total budget{" "}
            {formatBudget(cycle.total_budget)}
          </p>
        </div>

        {rowError ? (
          <p className="text-sm text-red-500">
            Couldn&apos;t load proposals: {rowError.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No proposals in this cycle yet.
          </p>
        ) : (
          TYPE_GROUPS.map((group) => {
            const items = rows
              .filter((r) => r.type === group.type)
              .sort((a, b) => avgNumber(b.summary) - avgNumber(a.summary));
            if (items.length === 0) return null;
            return (
              <Card key={group.type}>
                <CardHeader>
                  <CardTitle className="text-xl">
                    {group.title}{" "}
                    <span className="text-muted-foreground font-normal text-base">
                      ({items.length})
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-2">
                    {items.map((r) => {
                      const s = r.summary;
                      return (
                        <li key={r.proposal_id}>
                          <Link
                            href={`/manager/cycles/${cycleId}/proposals/${r.proposal_id}`}
                          >
                            <div className="border rounded-md p-3 hover:border-foreground/30 transition-colors flex flex-col gap-1">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-sm">
                                  {r.title}
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  {r.outcome && (
                                    <Badge>{outcomeLabel(r.outcome)}</Badge>
                                  )}
                                  <Badge variant="secondary">
                                    {proposalStateLabel(r.state)}
                                  </Badge>
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                                <span>
                                  {r.researcher_name ?? "Unknown"}
                                  {r.researcher_institution
                                    ? ` · ${r.researcher_institution}`
                                    : ""}
                                </span>
                                <span>{proposalTypeLabel(r.type)}</span>
                                {r.requested_amount != null && (
                                  <span>
                                    Requested {formatBudget(r.requested_amount)}
                                  </span>
                                )}
                                {r.submitted_at && (
                                  <span>
                                    Submitted{" "}
                                    {formatDate(r.submitted_at.slice(0, 10))}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                                <span>
                                  Reviews: {s?.reviews_submitted ?? 0} of{" "}
                                  {totalReviewers} submitted
                                  {s && s.reviews_in_progress > 0
                                    ? ` (${s.reviews_in_progress} in progress)`
                                    : ""}
                                </span>
                                <span>
                                  Total {s ? Number(s.total_score ?? 0) : 0} /{" "}
                                  {s ? Number(s.max_possible ?? 0) : 0}
                                </span>
                                <span>
                                  Avg {formatAverage(s?.average_score ?? null)}
                                </span>
                              </div>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </main>
  );
}
