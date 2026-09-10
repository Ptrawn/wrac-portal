"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createReportsForProjects,
  type BatchReportResult,
} from "./actions";

export type FundedProject = {
  proposalId: string;
  projectId: string;
  projectTitle: string;
  researcherName: string | null;
  yearNumber: number;
};

/**
 * The three things a manager can request. Both status options write type
 * 'status' — the index only picks which cycle default seeds the due date, and
 * is never stored on the report.
 */
type RequestKind = "status_1" | "status_2" | "final";

const KINDS: { value: RequestKind; label: string; autoLabel: string }[] = [
  { value: "status_1", label: "First status report", autoLabel: "First status report" },
  { value: "status_2", label: "Second status report", autoLabel: "Second status report" },
  { value: "final", label: "Final report", autoLabel: "Final report" },
];

function kindToType(kind: RequestKind): string {
  return kind === "final" ? "final" : "status";
}

function kindToStatusIndex(kind: RequestKind): number {
  return kind === "status_2" ? 2 : 1;
}

export function RequestReport({
  cycleId,
  fundedProjects,
  defaultStatusDue,
  defaultStatus2Due,
  defaultFinalDue,
  existingByProject,
}: {
  cycleId: string;
  fundedProjects: FundedProject[];
  defaultStatusDue: string | null;
  defaultStatus2Due: string | null;
  defaultFinalDue: string | null;
  // project_id -> report types already present in THIS cycle. Used only to warn;
  // duplicates remain allowed on purpose.
  existingByProject: Record<string, string[]>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<RequestKind>("status_1");
  const [label, setLabel] = useState("");
  // Whether the label still tracks the selected kind. Typing in the field turns
  // this off, so a manager's own wording is never overwritten.
  const [labelAuto, setLabelAuto] = useState(true);
  const [dueDate, setDueDate] = useState(defaultStatusDue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchReportResult[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const defaultFor = (k: RequestKind): string | null =>
    k === "final"
      ? defaultFinalDue
      : k === "status_2"
        ? defaultStatus2Due
        : defaultStatusDue;

  // Switching the kind re-seeds the due date from that kind's cycle default,
  // and the label too while the label is still auto.
  const onKindChange = (next: RequestKind) => {
    setKind(next);
    setDueDate(defaultFor(next) ?? "");
    if (labelAuto) {
      setLabel(KINDS.find((k) => k.value === next)?.autoLabel ?? "");
    }
  };

  const toggle = (projectId: string) => {
    setResults(null);
    setSelected((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId],
    );
  };

  const allSelected =
    fundedProjects.length > 0 && selected.length === fundedProjects.length;

  // Projects in the current selection that already have a report of this type
  // in this cycle. A signal only — requesting another is allowed.
  const duplicateTitles = fundedProjects
    .filter(
      (p) =>
        selected.includes(p.projectId) &&
        (existingByProject[p.projectId] ?? []).includes(kindToType(kind)),
    )
    .map((p) => p.projectTitle);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResults(null);
    if (selected.length === 0) {
      setError("Pick at least one funded project.");
      return;
    }
    const projects = fundedProjects
      .filter((p) => selected.includes(p.projectId))
      .map((p) => ({
        projectId: p.projectId,
        proposalId: p.proposalId,
        title: p.projectTitle,
      }));

    startTransition(async () => {
      const res = await createReportsForProjects(cycleId, {
        projects,
        type: kindToType(kind),
        label: label.trim() === "" ? null : label.trim(),
        dueDate: dueDate === "" ? null : dueDate,
        statusIndex: kindToStatusIndex(kind),
      });
      setResults(res.results);
      // Clear only the projects that actually succeeded, so a retry re-submits
      // exactly the ones that failed and nothing else.
      const failed = res.results.filter((r) => !r.ok).map((r) => r.projectId);
      setSelected(failed);
      router.refresh();
    });
  };

  if (fundedProjects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No funded projects in this cycle yet — reports can be requested once
        funding decisions are recorded.
      </p>
    );
  }

  const succeeded = results?.filter((r) => r.ok) ?? [];
  const failures = results?.filter((r) => !r.ok) ?? [];

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="report_projects">
            Funded projects{" "}
            <span className="text-muted-foreground font-normal">
              ({selected.length} of {fundedProjects.length} selected)
            </span>
          </Label>
          <button
            type="button"
            className="text-xs underline underline-offset-4 text-muted-foreground"
            onClick={() => {
              setResults(null);
              setSelected(
                allSelected ? [] : fundedProjects.map((p) => p.projectId),
              );
            }}
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
        </div>
        {/* A scrolling checkbox list rather than a multi-select box: it stays
            readable at a dozen or so projects, shows the whole label, and needs
            no ctrl-click. Search can come later if the list ever grows. */}
        <ul
          id="report_projects"
          className="border rounded-md max-h-56 overflow-y-auto divide-y"
        >
          {fundedProjects.map((p) => {
            const already = (existingByProject[p.projectId] ?? []).includes(
              kindToType(kind),
            );
            return (
              <li key={p.projectId}>
                <label className="flex items-start gap-2 p-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.includes(p.projectId)}
                    onChange={() => toggle(p.projectId)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{p.projectTitle}</span>
                    {p.researcherName ? (
                      <span className="text-muted-foreground">
                        {" "}
                        — {p.researcherName}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground">
                      {" "}
                      (Year {p.yearNumber})
                    </span>
                    {already && (
                      <span className="block text-xs text-status-review">
                        Already has a {kindToType(kind)} report in this cycle
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="grid gap-2">
          <Label htmlFor="report_kind">Report</Label>
          <select
            id="report_kind"
            value={kind}
            onChange={(e) => onKindChange(e.target.value as RequestKind)}
            className="border rounded-md h-9 px-2 text-sm bg-background"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="report_due">Due date</Label>
          <Input
            id="report_due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="report_label">Label</Label>
        <Input
          id="report_label"
          type="text"
          placeholder="e.g. Mid-year progress"
          value={label}
          onChange={(e) => {
            setLabelAuto(false);
            setLabel(e.target.value);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Filled in from the report you picked, since both status reports
          otherwise read the same everywhere. Edit it freely — or clear it to
          store no label at all.
        </p>
      </div>

      {duplicateTitles.length > 0 && (
        <p className="text-sm text-status-review">
          {duplicateTitles.length === 1
            ? `${duplicateTitles[0]} already has a ${kindToType(kind)} report in this cycle.`
            : `${duplicateTitles.length} selected projects already have a ${kindToType(kind)} report in this cycle.`}{" "}
          Requesting another is allowed — this is only a heads-up.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results && (
        <div className="text-sm flex flex-col gap-1">
          {succeeded.length > 0 && (
            <p className="text-status-funded">
              Created {succeeded.length} report
              {succeeded.length === 1 ? "" : "s"}
              {failures.length === 0 ? "." : ":"}
            </p>
          )}
          {failures.length > 0 && (
            <div className="text-destructive">
              <p>
                {failures.length} failed and {failures.length === 1 ? "is" : "are"}{" "}
                still selected so you can retry:
              </p>
              <ul className="list-disc pl-5">
                {failures.map((f) => (
                  <li key={f.projectId}>
                    {f.projectTitle} — {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending
          ? "Creating…"
          : selected.length > 1
            ? `Request ${selected.length} reports`
            : "Request report"}
      </Button>
    </form>
  );
}
