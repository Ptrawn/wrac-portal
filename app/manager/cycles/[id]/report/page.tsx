import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import { formatBudget, type Cycle } from "@/lib/cycles";
import { displaySerial } from "@/lib/proposals";
import {
  type CycleFundingReportRow,
  type CycleFundingSummary,
} from "@/lib/reviews";
import { PrintButton } from "./print-button";

// Print + on-screen "paper" styling for the report. Kept in one place so the
// printed output is deterministic: app chrome (.no-print) is dropped, and the
// document renders as a clean single-column page with repeating table headers
// and rows that don't split across page breaks.
const REPORT_CSS = `
.report-doc {
  background: #ffffff;
  color: #111827;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
  padding: 2.5rem 2.75rem;
}
.report-doc h1, .report-doc h2, .report-doc h3 { color: #111827; }
.report-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.report-table caption { text-align: left; }
.report-table th, .report-table td {
  border: 1px solid #cbd5e1;
  padding: 6px 9px;
  text-align: left;
  vertical-align: top;
}
.report-table thead th { background: #f1f5f9; font-weight: 600; }
.report-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.report-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem 2rem; }
.report-summary .k { color: #374151; }
.report-summary .v { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }

@media print {
  .no-print { display: none !important; }
  @page { margin: 1.6cm; }
  html, body { background: #ffffff !important; }
  main { margin: 0 !important; padding: 0 !important; min-height: 0 !important; }
  .report-shell { margin: 0 !important; padding: 0 !important; max-width: none !important; }
  .report-doc {
    border: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
    max-width: none !important;
  }
  .report-table { break-inside: auto; }
  .report-table thead { display: table-header-group; }
  .report-table tfoot { display: table-footer-group; }
  .report-table tr { break-inside: avoid; page-break-inside: avoid; }
  .report-section { break-inside: avoid; }
}
`;

type ReportRow = CycleFundingReportRow & {
  serial_number: string | null;
  is_wsu: boolean;
  arc_amount: number | string | null;
};

function num(v: number | string | null): number {
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

// When `showArc`, the Awarded column is split into From ARC / From pool so the
// Commission sees the two funding sources per project. Non-ARC cycles pass
// showArc=false and the table renders exactly as before.
function ProjectTable({
  rows,
  showArc,
}: {
  rows: ReportRow[];
  showArc: boolean;
}) {
  return (
    <table className="report-table">
      <thead>
        <tr>
          <th>Serial</th>
          <th>Project</th>
          <th>Researcher</th>
          <th>Institution</th>
          <th>Project year</th>
          <th className="num">Requested</th>
          <th className="num">Awarded</th>
          {showArc && <th className="num">From ARC</th>}
          {showArc && <th className="num">From pool</th>}
          <th className="num">Multi-year plan</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const arc = num(r.arc_amount);
          const poolDraw = num(r.funded_amount) - arc;
          return (
            <tr key={r.proposal_id}>
              {/* report rows are all funded, so the display serial carries the F */}
              <td className="num">
                {displaySerial(r.serial_number, "funded") ?? "—"}
              </td>
              <td>{r.title}</td>
              <td>{r.researcher_name ?? "—"}</td>
              <td>{r.researcher_institution ?? "—"}</td>
              <td>
                Year {r.year_number} of {r.planned_years}
              </td>
              <td className="num">{formatBudget(r.requested_amount)}</td>
              <td className="num">{formatBudget(r.funded_amount)}</td>
              {showArc && (
                <td className="num">{arc > 0 ? formatBudget(arc) : "—"}</td>
              )}
              {showArc && <td className="num">{formatBudget(poolDraw)}</td>}
              <td className="num">{formatBudget(r.plan_total)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function CommissionReportPage({
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
  const summary = (summaryData as CycleFundingSummary[] | null)?.[0] ?? null;

  const { data: reportData } = await supabase.rpc("cycle_funding_report", {
    p_cycle_id: cycleId,
  });
  // Serial + WSU/ARC fields aren't in the report RPC; read them directly
  // (manager RLS permits it), same pattern as the allocation tool.
  const { data: extraData } = await supabase
    .from("proposals")
    .select("id, serial_number, is_wsu, arc_amount")
    .eq("cycle_id", cycleId);
  const extraByProposal = new Map(
    ((extraData as
      | {
          id: string;
          serial_number: string | null;
          is_wsu: boolean;
          arc_amount: number | string | null;
        }[]
      | null) ?? []).map((r) => [r.id, r]),
  );
  const rows: ReportRow[] = (
    (reportData as CycleFundingReportRow[] | null) ?? []
  ).map((r) => {
    const extra = extraByProposal.get(r.proposal_id);
    return {
      ...r,
      serial_number: extra?.serial_number ?? null,
      is_wsu: extra?.is_wsu ?? false,
      arc_amount: extra?.arc_amount ?? null,
    };
  });
  const poolRows = rows.filter(
    (r) => r.type === "full" || r.type === "continuation",
  );
  const offCycleRows = rows.filter((r) => r.type === "off_cycle");

  const generatedOn = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(new Date());

  const offcycleTotal = summary ? num(summary.offcycle_allocated) : 0;

  // ARC is "active" for this report if the cycle configured a fund OR any funded
  // proposal actually drew on ARC. A cycle with neither renders as it did before
  // (no ARC column, no ARC summary).
  const arcConfigured = cycle.arc_fund_total != null;
  const anyArcOnRows = rows.some((r) => num(r.arc_amount) > 0);
  const arcActive = arcConfigured || anyArcOnRows;

  return (
    <main className="min-h-screen flex flex-col items-center">
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />

      <div className="no-print w-full">
        <AppHeader email={email} />
      </div>

      <div className="report-shell w-full max-w-3xl p-5 flex flex-col gap-4 mt-8">
        <div className="no-print flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link
              href={`/manager/cycles/${cycleId}`}
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              ← Cycle
            </Link>
            <Link
              href={`/manager/cycles/${cycleId}/allocation`}
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              Allocation tool
            </Link>
          </div>
          <PrintButton />
        </div>

        <div className="report-doc flex flex-col gap-6">
          {/* Title block */}
          <div className="report-section flex flex-col gap-1">
            <h1 className="text-xl font-bold leading-snug">
              Washington State Wine Commission — Research Advisory Committee
            </h1>
            <h2 className="text-lg font-semibold">Funding Recommendations</h2>
            <p className="text-sm text-gray-600">
              {cycle.name} ({cycle.year})
            </p>
          </div>

          {/* Summary */}
          <div className="report-section flex flex-col gap-2">
            <h3 className="text-base font-semibold border-b border-gray-300 pb-1">
              Summary
            </h3>
            {arcActive ? (
              <>
                {/* Main pool (net of ARC) and the WSU ARC fund, reported as two
                    distinct sources so the Commission sees each clearly. */}
                <div className="text-sm font-semibold text-gray-700">
                  Main pool
                </div>
                <div className="report-summary text-sm">
                  <span className="k">Total budget</span>
                  <span className="v">
                    {formatBudget(summary?.total_budget ?? 0)}
                  </span>
                  <span className="k">Total awarded from pool (net of ARC)</span>
                  <span className="v">
                    {formatBudget(summary?.allocated ?? 0)}
                  </span>
                  <span className="k">Remaining</span>
                  <span className="v">
                    {formatBudget(summary?.remaining ?? 0)}
                  </span>
                  <span className="k">Projects funded</span>
                  <span className="v">{poolRows.length}</span>
                </div>
                <div className="text-sm font-semibold text-gray-700 mt-2">
                  WSU ARC Fund (separate source)
                </div>
                <div className="report-summary text-sm">
                  <span className="k">ARC fund total</span>
                  <span className="v">
                    {formatBudget(summary?.arc_fund_total ?? 0)}
                  </span>
                  <span className="k">ARC awarded</span>
                  <span className="v">
                    {formatBudget(summary?.arc_allocated ?? 0)}
                  </span>
                  <span className="k">ARC remaining</span>
                  <span className="v">
                    {formatBudget(summary?.arc_remaining ?? 0)}
                  </span>
                </div>
              </>
            ) : (
              <div className="report-summary text-sm">
                <span className="k">Total budget</span>
                <span className="v">
                  {formatBudget(summary?.total_budget ?? 0)}
                </span>
                <span className="k">Total awarded (annual pool)</span>
                <span className="v">{formatBudget(summary?.allocated ?? 0)}</span>
                <span className="k">Remaining</span>
                <span className="v">{formatBudget(summary?.remaining ?? 0)}</span>
                <span className="k">Projects funded</span>
                <span className="v">{poolRows.length}</span>
              </div>
            )}
            {offcycleTotal > 0 && (
              <p className="text-sm text-gray-600 mt-1">
                Off-cycle awards (funded from a separate source, outside the
                annual pool):{" "}
                <span className="font-semibold text-gray-800">
                  {formatBudget(summary?.offcycle_allocated ?? 0)}
                </span>{" "}
                across {offCycleRows.length} proposal
                {offCycleRows.length === 1 ? "" : "s"}.
              </p>
            )}
          </div>

          {/* Pool-funded projects */}
          <div className="report-section flex flex-col gap-2">
            <h3 className="text-base font-semibold border-b border-gray-300 pb-1">
              Funded projects (annual pool)
            </h3>
            {poolRows.length === 0 ? (
              <p className="text-sm text-gray-600">
                No projects have been funded from the annual pool for this cycle.
              </p>
            ) : (
              <ProjectTable rows={poolRows} showArc={arcActive} />
            )}
          </div>

          {/* Off-cycle projects — only when present */}
          {offCycleRows.length > 0 && (
            <div className="report-section flex flex-col gap-2">
              <h3 className="text-base font-semibold border-b border-gray-300 pb-1">
                Off-cycle awards (separate funding source)
              </h3>
              <p className="text-xs text-gray-600">
                These awards are funded outside the annual pool and are not drawn
                against the cycle&apos;s total budget.
              </p>
              <ProjectTable rows={offCycleRows} showArc={false} />
            </div>
          )}

          <p className="text-xs text-gray-500 mt-2">Generated on {generatedOn}</p>
        </div>
      </div>
    </main>
  );
}
