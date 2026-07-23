"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Cycle } from "@/lib/cycles";
import { updateCycle } from "./actions";

// Coerce to a string for form state. numeric columns (total_budget) can come
// back from supabase-js as a number, so String() guards against .trim() blowing
// up on non-string values.
function orEmpty(v: string | number | null): string {
  return v === null || v === undefined ? "" : String(v);
}

export function EditCycleForm({ cycle }: { cycle: Cycle }) {
  const router = useRouter();
  const [name, setName] = useState(cycle.name);
  const [year, setYear] = useState(String(cycle.year));
  const [totalBudget, setTotalBudget] = useState(orEmpty(cycle.total_budget));
  const [preOpen, setPreOpen] = useState(orEmpty(cycle.pre_proposal_opens_at));
  const [preClose, setPreClose] = useState(
    orEmpty(cycle.pre_proposal_closes_at),
  );
  const [preReview, setPreReview] = useState(orEmpty(cycle.pre_review_due_at));
  const [fullDue, setFullDue] = useState(orEmpty(cycle.full_proposal_due_at));
  const [fullReview, setFullReview] = useState(
    orEmpty(cycle.full_review_due_at),
  );
  const [defaultStatusDue, setDefaultStatusDue] = useState(
    orEmpty(cycle.default_status_report_due_at),
  );
  const [defaultFinalDue, setDefaultFinalDue] = useState(
    orEmpty(cycle.default_final_report_due_at),
  );

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const nullIfEmpty = (v: string) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateCycle(cycle.id, {
        name: name.trim(),
        year: Number(year),
        total_budget: nullIfEmpty(totalBudget),
        pre_proposal_opens_at: nullIfEmpty(preOpen),
        pre_proposal_closes_at: nullIfEmpty(preClose),
        pre_review_due_at: nullIfEmpty(preReview),
        full_proposal_due_at: nullIfEmpty(fullDue),
        full_review_due_at: nullIfEmpty(fullReview),
        default_status_report_due_at: nullIfEmpty(defaultStatusDue),
        default_final_report_due_at: nullIfEmpty(defaultFinalDue),
      });
      if (res?.error) {
        setError(res.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="year">Year</Label>
        <Input
          id="year"
          type="number"
          required
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="total_budget">Total budget</Label>
        <Input
          id="total_budget"
          type="number"
          min="0"
          step="0.01"
          value={totalBudget}
          onChange={(e) => setTotalBudget(e.target.value)}
        />
      </div>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold mb-3">Calendar</h3>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pre_open">Pre-proposal opens</Label>
            <Input
              id="pre_open"
              type="date"
              value={preOpen}
              onChange={(e) => setPreOpen(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pre_close">Pre-proposal closes</Label>
            <Input
              id="pre_close"
              type="date"
              value={preClose}
              onChange={(e) => setPreClose(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pre_review">Pre-review due</Label>
            <Input
              id="pre_review"
              type="date"
              value={preReview}
              onChange={(e) => setPreReview(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="full_due">Full-proposal due</Label>
            <Input
              id="full_due"
              type="date"
              value={fullDue}
              onChange={(e) => setFullDue(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="full_review">Full-review due</Label>
            <Input
              id="full_review"
              type="date"
              value={fullReview}
              onChange={(e) => setFullReview(e.target.value)}
            />
          </div>
        </div>

        <h3 className="text-sm font-semibold mb-3 mt-4">
          Report deadline defaults
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          These seed the due date when you create a report for a funded project;
          each report keeps its own date.
        </p>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="default_status_report_due">
              Default status report due
            </Label>
            <Input
              id="default_status_report_due"
              type="date"
              value={defaultStatusDue}
              onChange={(e) => setDefaultStatusDue(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="default_final_report_due">
              Default final report due
            </Label>
            <Input
              id="default_final_report_due"
              type="date"
              value={defaultFinalDue}
              onChange={(e) => setDefaultFinalDue(e.target.value)}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && !error && (
        <p className="text-sm text-green-600">Saved.</p>
      )}
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
