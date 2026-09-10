import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import { formatBudget, statusLabel, type Cycle } from "@/lib/cycles";
import { arcEligibleTotal } from "@/lib/proposals";
import {
  type CycleFundingSummary,
  type ManagerProposalRow,
  type ProposalReviewSummary,
} from "@/lib/reviews";
import { ArcTally } from "./arc-tally";
import { DecisionRow } from "./decision-row";

type WsuRow = {
  id: string;
  serial_number: string | null;
  is_wsu: boolean;
  arc_amount: number | string | null;
  funding_note: string | null;
  wsu_salary: number | string | null;
  wsu_salary_benefits: number | string | null;
  wsu_wages: number | string | null;
  wsu_wage_benefits: number | string | null;
};

function avgNumber(s: ProposalReviewSummary | undefined): number {
  const v = s?.average_score;
  if (v === null || v === undefined || v === "") return -Infinity;
  const n = Number(v);
  return Number.isNaN(n) ? -Infinity : n;
}

export default async function AllocationPage({
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

  const { data: summaryData } = await supabase.rpc("cycle_funding_summary", {
    p_cycle_id: cycleId,
  });
  const summary =
    (summaryData as CycleFundingSummary[] | null)?.[0] ?? null;

  const { data: rowData } = await supabase.rpc(
    "list_cycle_proposals_for_manager",
    { p_cycle_id: cycleId },
  );
  const { data: reviewSummaryData } = await supabase.rpc(
    "proposal_review_summary",
    { p_cycle_id: cycleId },
  );

  const reviewSummaries = new Map<string, ProposalReviewSummary>(
    ((reviewSummaryData as ProposalReviewSummary[] | null) ?? []).map((s) => [
      s.proposal_id,
      s,
    ]),
  );
  const allRows = (rowData as ManagerProposalRow[] | null) ?? [];

  // Serial numbers + WSU/ARC fields aren't in the list RPC; fetch directly
  // (manager RLS permits this read).
  const { data: wsuData } = await supabase
    .from("proposals")
    .select(
      "id, serial_number, is_wsu, arc_amount, funding_note, wsu_salary, wsu_salary_benefits, wsu_wages, wsu_wage_benefits",
    )
    .eq("cycle_id", cycleId);
  const wsuByProposal = new Map(
    ((wsuData as WsuRow[] | null) ?? []).map((r) => [r.id, r]),
  );

  const buildRows = (types: string[]) =>
    allRows
      .filter((r) => r.state === "submitted" && types.includes(r.type))
      .sort(
        (a, b) =>
          avgNumber(reviewSummaries.get(b.proposal_id)) -
          avgNumber(reviewSummaries.get(a.proposal_id)),
      )
      .map((r) => {
        const s = reviewSummaries.get(r.proposal_id);
        const w = wsuByProposal.get(r.proposal_id) ?? null;
        return {
          proposal_id: r.proposal_id,
          title: r.title,
          serial_number: w?.serial_number ?? null,
          requested_amount: r.requested_amount,
          researcher_name: r.researcher_name,
          researcher_institution: r.researcher_institution,
          outcome: r.outcome,
          funded_amount: r.funded_amount,
          total_score: s?.total_score ?? null,
          average_score: s?.average_score ?? null,
          reviews_submitted: s?.reviews_submitted ?? 0,
          declined_count: s?.declined_count ?? 0,
          is_wsu: w?.is_wsu ?? false,
          arc_amount: w?.arc_amount ?? null,
          funding_note: w?.funding_note ?? null,
          // The four line items go to the row so the decision row can show them
          // individually; salary additionally drives the ARC ceiling and the
          // live magic-funds figure.
          wsu_salary: w?.wsu_salary ?? null,
          wsu_salary_benefits: w?.wsu_salary_benefits ?? null,
          wsu_wages: w?.wsu_wages ?? null,
          wsu_wage_benefits: w?.wsu_wage_benefits ?? null,
          // ARC-eligible ceiling: WSU SALARY only (not the four-item sum).
          arc_ceiling: w ? arcEligibleTotal({ wsu_salary: w.wsu_salary }) : 0,
        };
      });

  // Split by type so the screen follows the order the funding meeting runs in:
  // continuing projects first, then new proposals. Each call sorts on its own,
  // so every group is ranked independently.
  const continuationRows = buildRows(["continuation"]);
  const fullRows = buildRows(["full"]);
  const offCycleRows = buildRows(["off_cycle"]);

  const remaining = summary ? Number(summary.remaining) : 0;
  const overAllocated = remaining < 0;
  const decided = summary?.decided_count ?? 0;
  const undecided = summary?.undecided_count ?? 0;
  const offcycle = summary ? Number(summary.offcycle_allocated) : 0;

  // ARC fund: the RPC coalesces arc_fund_total to 0, so "configured" comes from
  // the cycle's raw column. arc_allocated/arc_remaining are meeting figures.
  const arcConfigured = cycle.arc_fund_total != null;
  const arcTotal = summary ? Number(summary.arc_fund_total) : 0;
  const arcAllocated = summary ? Number(summary.arc_allocated) : 0;
  const arcRemaining = summary ? Number(summary.arc_remaining) : 0;
  // WSU magic funds: uncapped, so a single figure rather than a tally triplet.
  const magicTotal = summary ? Number(summary.magic_total) : 0;

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />

      {/* Sticky tally header */}
      <div className="sticky top-0 z-20 w-full border-b bg-background">
        <div className="w-full max-w-5xl mx-auto p-4">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <span className="text-sm text-muted-foreground">
              {cycle.name} ({cycle.year}) — allocation
            </span>
            <span className="text-sm text-muted-foreground">
              {statusLabel(cycle.status)} · {decided} of {decided + undecided}{" "}
              decided
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Main pool tally (net of ARC) */}
            <div className="rounded-md border border-l-4 border-l-status-funded p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-status-funded mb-1">
                Main Pool
              </div>
              {/* The ARC fund is carved OUT of the cycle's total budget, so the
                  figure below is the budget less that carve-out — not the gross
                  total the cycle was set up with. Only worth saying when a fund
                  is actually configured. */}
              {arcConfigured && (
                <div className="text-[10px] text-muted-foreground mb-1">
                  Total budget less the ARC carve-out
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Available
                  </div>
                  <div className="text-lg font-bold tabular-nums">
                    {formatBudget(summary?.total_budget ?? 0)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Allocated
                  </div>
                  <div className="text-lg font-bold tabular-nums">
                    {formatBudget(summary?.allocated ?? 0)}
                  </div>
                </div>
                <div
                  className={
                    overAllocated ? "rounded-md bg-destructive/15 px-2 -mx-2" : ""
                  }
                >
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Remaining
                  </div>
                  <div
                    className={
                      "text-xl font-extrabold tabular-nums " +
                      (overAllocated ? "text-destructive" : "text-status-funded")
                    }
                  >
                    {formatBudget(summary?.remaining ?? 0)}
                  </div>
                  {overAllocated && (
                    <div className="text-[10px] text-destructive font-medium">
                      Over budget
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* WSU ARC fund tally (client — editable total) */}
            <ArcTally
              cycleId={cycleId}
              configured={arcConfigured}
              arcTotal={arcTotal}
              arcAllocated={arcAllocated}
              arcRemaining={arcRemaining}
            />

            {/* WSU magic funds — a SINGLE figure, deliberately not the
                Available/Allocated/Remaining triplet the other two panels use:
                there is no configured pot to allocate against, so a three-cell
                layout would imply a budget that doesn't exist. Neutral styling
                (border-l-line) rather than a status colour, since status-funded
                and status-review already mean other things elsewhere. */}
            <div className="rounded-md border border-l-4 border-l-line p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                WSU Magic Funds
              </div>
              <div className="text-[10px] uppercase text-muted-foreground">
                WSU contributes
              </div>
              <div className="text-xl font-extrabold tabular-nums">
                {formatBudget(magicTotal)}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Salary benefits WSU covers, in proportion to the salary you move
                to ARC. Paid by WSU directly — not WRAC money, and not part of
                the pool.
              </p>
            </div>
          </div>
          {offcycle > 0 && (
            <div className="mt-2 text-sm">
              <span className="text-muted-foreground">
                Off-cycle allocated (separate source, not from the pool):
              </span>{" "}
              <span className="font-semibold">
                {formatBudget(summary?.offcycle_allocated ?? 0)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="w-full max-w-5xl p-5 flex flex-col gap-6 mt-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/manager/cycles/${cycleId}/proposals`}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Review dashboard
          </Link>
          <Link
            href={`/manager/cycles/${cycleId}/report`}
            className="text-sm underline underline-offset-4"
          >
            Commission report →
          </Link>
        </div>

        {/* Continuations, then new full proposals — the order the meeting works
            through them. An empty group renders nothing; if BOTH are empty the
            single card below still gives the manager a signal rather than a gap
            between the tally header and the off-cycle section. */}
        {continuationRows.length === 0 && fullRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Proposals</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No submitted full or continuation proposals in this cycle.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {continuationRows.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">
                    Continuations{" "}
                    <span className="text-muted-foreground font-normal text-base">
                      ({continuationRows.length})
                    </span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Continuing projects, highest average review score first.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    {continuationRows.map((r) => (
                      <DecisionRow
                        key={r.proposal_id}
                        cycleId={cycleId}
                        row={r}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {fullRows.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">
                    Full proposals{" "}
                    <span className="text-muted-foreground font-normal text-base">
                      ({fullRows.length})
                    </span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    New proposals, highest average review score first.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    {fullRows.map((r) => (
                      <DecisionRow
                        key={r.proposal_id}
                        cycleId={cycleId}
                        row={r}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {offCycleRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Off-cycle proposals</CardTitle>
              <p className="text-sm text-muted-foreground">
                Funded from a separate source — these do not count against the
                annual pool.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {offCycleRows.map((r) => (
                  <DecisionRow key={r.proposal_id} cycleId={cycleId} row={r} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
