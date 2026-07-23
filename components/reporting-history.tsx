"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatLongDate } from "@/lib/cycles";
import { reportStateLabel, reportTypeLabel } from "@/lib/reviews";
import { getReportFileSignedUrl } from "./reporting-history-actions";

export type ReportHistoryDoc = {
  id: string;
  file_name: string;
  file_path: string;
};

export type ReportHistoryItem = {
  report_id: string;
  type: string;
  label: string | null;
  due_date: string | null;
  state: string;
  narrative: string | null;
  submitted_at: string | null;
  cycle_name: string | null;
  year_number: number | null;
  documents: ReportHistoryDoc[];
};

function cycleYearLabel(r: ReportHistoryItem): string {
  const cycle = r.cycle_name ?? "Cycle";
  return r.year_number != null ? `${cycle} · Year ${r.year_number}` : cycle;
}

/**
 * A project's full reporting history, for committee reviewers and the manager.
 * Submitted reports are collapsed rows that expand to narrative + documents;
 * pending/reopened reports render as outstanding obligations (their absence is
 * itself information). Renders nothing when the project has no reports.
 */
export function ProjectReportingHistory({
  reports,
}: {
  reports: ReportHistoryItem[];
}) {
  if (reports.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Project reporting history</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {reports.map((r) => (
            <ReportHistoryRow key={r.report_id} report={r} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ReportHistoryRow({ report: r }: { report: ReportHistoryItem }) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = async (path: string) => {
    setError(null);
    const res = await getReportFileSignedUrl(path);
    if (res.error) setError(res.error);
    else if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
  };

  // Pending / reopened: show as an outstanding obligation, not an empty block.
  if (r.state !== "submitted") {
    return (
      <li className="border rounded-md p-3 text-sm flex items-center justify-between gap-3">
        <span className="text-muted-foreground">
          {reportTypeLabel(r.type)} report
          {r.label ? ` (${r.label})` : ""} — {cycleYearLabel(r)} — due{" "}
          {formatLongDate(r.due_date)} —{" "}
          {r.state === "reopened"
            ? "reopened, not yet resubmitted"
            : "not yet submitted"}
        </span>
        <Badge variant="secondary" className="shrink-0">
          {reportStateLabel(r.state)}
        </Badge>
      </li>
    );
  }

  return (
    <li className="border rounded-md p-3 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between gap-3 text-left text-sm"
      >
        <span className="font-medium">
          {reportTypeLabel(r.type)} report
          {r.label ? ` · ${r.label}` : ""}
          <span className="text-muted-foreground font-normal">
            {" "}
            — {cycleYearLabel(r)}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <Badge>{reportStateLabel(r.state)}</Badge>
          <span className="text-muted-foreground text-xs">
            {expanded ? "Hide" : "Show"}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 text-sm border-t pt-2">
          <div className="text-xs text-muted-foreground">
            Due {formatLongDate(r.due_date)}
            {r.submitted_at ? ` · submitted ${r.submitted_at.slice(0, 10)}` : ""}
          </div>
          <div>
            <div className="font-medium mb-0.5">Narrative</div>
            {r.narrative && r.narrative.trim() !== "" ? (
              <p className="whitespace-pre-wrap">{r.narrative}</p>
            ) : (
              <p className="text-muted-foreground">No narrative.</p>
            )}
          </div>
          {r.documents.length > 0 && (
            <div>
              <div className="font-medium mb-0.5">Documents</div>
              <ul className="flex flex-col gap-1">
                {r.documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-muted-foreground truncate">
                      {d.file_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => view(d.file_path)}
                      className="underline underline-offset-4 shrink-0"
                    >
                      View
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      )}
    </li>
  );
}
