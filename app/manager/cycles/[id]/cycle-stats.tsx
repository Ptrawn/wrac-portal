import Link from "next/link";

import { formatBudget } from "@/lib/cycles";

export type CycleProposalStats = {
  pre: number;
  full: number;
  continuation: number;
  offCycle: number;
  funded: number;
  totalRequested: number;
  totalAwarded: number;
};

export type CycleReportStats = {
  pending: number;
  submitted: number;
  pastDue: number;
};

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "destructive" | "funded";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "text-lg font-bold tabular-nums " +
          (tone === "destructive"
            ? "text-destructive"
            : tone === "funded"
              ? "text-status-funded"
              : "")
        }
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Compact per-cycle summary: what came in, what was funded, requested vs
 * awarded, plus the cycle's report status. "Received" counts submitted
 * proposals; requested/awarded cover the fundable types (full / continuation /
 * off-cycle) so a pre-proposal and its full aren't double-counted.
 */
export function CycleStats({
  cycleId,
  proposals,
  reports,
}: {
  cycleId: string;
  proposals: CycleProposalStats;
  reports: CycleReportStats;
}) {
  const totalReports = reports.pending + reports.submitted;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Proposals received
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Pre-proposals" value={proposals.pre} />
          <Stat label="Full proposals" value={proposals.full} />
          <Stat label="Continuations" value={proposals.continuation} />
          {proposals.offCycle > 0 ? (
            <Stat label="Off-cycle" value={proposals.offCycle} />
          ) : (
            <Stat label="Funded" value={proposals.funded} tone="funded" />
          )}
        </div>
        {proposals.offCycle > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <Stat label="Funded" value={proposals.funded} tone="funded" />
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Money
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat
            label="Total requested"
            value={formatBudget(proposals.totalRequested)}
          />
          <Stat
            label="Total awarded"
            value={formatBudget(proposals.totalAwarded)}
            tone="funded"
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Requested and awarded cover full, continuation and off-cycle proposals
          (the fundable types).
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reports
          </div>
          <Link
            href={`/manager/cycles/${cycleId}/reports`}
            className="text-xs underline underline-offset-4"
          >
            Manage reports
          </Link>
        </div>
        {totalReports === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reports requested for this cycle yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="Outstanding" value={reports.pending} />
            <Stat label="Submitted" value={reports.submitted} />
            <Stat
              label="Past due"
              value={reports.pastDue}
              tone={reports.pastDue > 0 ? "destructive" : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
