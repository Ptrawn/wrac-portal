"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/cycles";
import { reportStateLabel, reportTypeLabel } from "@/lib/reviews";
import {
  deleteReport,
  getReportFileUrl,
  reopenReport,
  updateReportSchedule,
} from "./actions";

export type ReportDoc = {
  id: string;
  file_name: string;
  file_path: string;
};

export type ReportItem = {
  id: string;
  type: string;
  label: string | null;
  due_date: string | null;
  state: string;
  narrative: string | null;
  submitted_at: string | null;
  year_number: number | null;
  project_title: string;
  researcher_name: string | null;
  researcher_institution: string | null;
  overdue: boolean;
  documents: ReportDoc[];
};

function stateBadgeVariant(
  state: string,
): "default" | "secondary" | "outline" {
  switch (state) {
    case "submitted":
      return "default";
    case "reopened":
      return "outline";
    default:
      return "secondary";
  }
}

export function ReportsList({
  cycleId,
  reports,
}: {
  cycleId: string;
  reports: ReportItem[];
}) {
  if (reports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reports have been requested for this cycle yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {reports.map((r) => (
        <ReportRow key={r.id} cycleId={cycleId} report={r} />
      ))}
    </ul>
  );
}

function ReportRow({
  cycleId,
  report: r,
}: {
  cycleId: string;
  report: ReportItem;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmingReopen, setConfirmingReopen] = useState(false);
  const [label, setLabel] = useState(r.label ?? "");
  const [dueDate, setDueDate] = useState(r.due_date ?? "");
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

  const openDoc = async (path: string) => {
    setError(null);
    const res = await getReportFileUrl(path);
    if (res.error) setError(res.error);
    else if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
  };

  return (
    <li className="border rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium">
            {r.project_title}{" "}
            <span className="text-muted-foreground font-normal">
              — {reportTypeLabel(r.type)} report
              {r.year_number != null ? ` · Year ${r.year_number}` : ""}
            </span>
          </div>
          <div className="text-muted-foreground text-xs">
            {r.researcher_name ?? "Unknown"}
            {r.researcher_institution ? ` · ${r.researcher_institution}` : ""}
          </div>
          <div className="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {r.label && <span className="text-muted-foreground">{r.label}</span>}
            <span className={r.overdue ? "text-destructive font-medium" : ""}>
              Due {formatDate(r.due_date)}
            </span>
            {r.submitted_at && (
              <span className="text-muted-foreground">
                Submitted {r.submitted_at.slice(0, 10)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {r.overdue && (
            <Badge
              variant="outline"
              className="border-destructive/40 text-destructive"
            >
              Overdue
            </Badge>
          )}
          <Badge variant={stateBadgeVariant(r.state)}>
            {reportStateLabel(r.state)}
          </Badge>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide details" : "Details"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Cancel edit" : "Edit schedule"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => run(() => deleteReport(cycleId, r.id))}
        >
          Delete
        </Button>
        {r.state === "submitted" &&
          (!confirmingReopen ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirmingReopen(true)}
            >
              Reopen
            </Button>
          ) : (
            <span className="flex items-center gap-2 text-sm">
              Reopen for correction?
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => reopenReport(cycleId, r.id),
                    () => setConfirmingReopen(false),
                  )
                }
              >
                {isPending ? "Reopening…" : "Reopen"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmingReopen(false)}
              >
                Cancel
              </Button>
            </span>
          ))}
      </div>

      {/* Edit schedule */}
      {editing && (
        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <div className="grid gap-1">
            <Label htmlFor={`label-${r.id}`} className="text-xs">
              Label
            </Label>
            <Input
              id={`label-${r.id}`}
              className="w-56"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`due-${r.id}`} className="text-xs">
              Due date
            </Label>
            <Input
              id={`due-${r.id}`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  updateReportSchedule(
                    cycleId,
                    r.id,
                    label.trim() === "" ? null : label.trim(),
                    dueDate === "" ? null : dueDate,
                  ),
                () => setEditing(false),
              )
            }
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}

      {/* Details: narrative + documents */}
      {expanded && (
        <div className="border-t pt-3 flex flex-col gap-3 text-sm">
          <div>
            <div className="font-medium mb-1">Narrative</div>
            {r.narrative && r.narrative.trim() !== "" ? (
              <p className="whitespace-pre-wrap">{r.narrative}</p>
            ) : (
              <p className="text-muted-foreground">
                No narrative submitted yet.
              </p>
            )}
          </div>
          <div>
            <div className="font-medium mb-1">Documents</div>
            {r.documents.length === 0 ? (
              <p className="text-muted-foreground">No documents uploaded.</p>
            ) : (
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
                      onClick={() => openDoc(d.file_path)}
                      className="underline underline-offset-4 shrink-0"
                    >
                      View
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </li>
  );
}
