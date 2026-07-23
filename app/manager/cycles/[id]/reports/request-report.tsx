"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createReport } from "./actions";

export type FundedProject = {
  proposalId: string;
  projectId: string;
  projectTitle: string;
  researcherName: string | null;
  yearNumber: number;
};

export function RequestReport({
  cycleId,
  fundedProjects,
  defaultStatusDue,
  defaultFinalDue,
}: {
  cycleId: string;
  fundedProjects: FundedProject[];
  defaultStatusDue: string | null;
  defaultFinalDue: string | null;
}) {
  const router = useRouter();
  const [proposalId, setProposalId] = useState("");
  const [type, setType] = useState("status");
  const [label, setLabel] = useState("");
  const [dueDate, setDueDate] = useState(defaultStatusDue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Switching the type re-seeds the due date from that type's cycle default.
  const onTypeChange = (next: string) => {
    setType(next);
    setDueDate((next === "final" ? defaultFinalDue : defaultStatusDue) ?? "");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const proj = fundedProjects.find((p) => p.proposalId === proposalId);
    if (!proj) {
      setError("Pick a funded project.");
      return;
    }
    startTransition(async () => {
      const res = await createReport(cycleId, {
        projectId: proj.projectId,
        proposalId: proj.proposalId,
        type,
        label: label.trim() === "" ? null : label.trim(),
        dueDate: dueDate === "" ? null : dueDate,
      });
      if (res.error) setError(res.error);
      else {
        setMessage("Report created.");
        setLabel("");
        setProposalId("");
        router.refresh();
      }
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="report_project">Funded project</Label>
        <select
          id="report_project"
          value={proposalId}
          onChange={(e) => setProposalId(e.target.value)}
          className="border rounded-md h-9 px-2 text-sm bg-background"
          required
        >
          <option value="">Select a funded project…</option>
          {fundedProjects.map((p) => (
            <option key={p.proposalId} value={p.proposalId}>
              {p.projectTitle}
              {p.researcherName ? ` — ${p.researcherName}` : ""} (Year{" "}
              {p.yearNumber})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="grid gap-2">
          <Label htmlFor="report_type">Type</Label>
          <select
            id="report_type"
            value={type}
            onChange={(e) => onTypeChange(e.target.value)}
            className="border rounded-md h-9 px-2 text-sm bg-background"
          >
            <option value="status">Status</option>
            <option value="final">Final</option>
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
        <Label htmlFor="report_label">Label (optional)</Label>
        <Input
          id="report_label"
          type="text"
          placeholder="e.g. Mid-year progress"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {message && !error && (
        <p className="text-sm text-green-600">{message}</p>
      )}
      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Creating…" : "Request report"}
      </Button>
    </form>
  );
}
