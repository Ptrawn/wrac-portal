"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startPreProposal } from "./actions";

export function CreatePreProposalForm({ cycleId }: { cycleId: string }) {
  const [title, setTitle] = useState("");
  const [plannedYears, setPlannedYears] = useState("1");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await startPreProposal({
        cycleId,
        projectTitle: title.trim(),
        plannedYears: Number(plannedYears),
        requestedAmount: amount.trim() === "" ? null : amount.trim(),
      });
      // On success the action redirects; we only reach here on error.
      if (res?.error) setError(res.error);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="title">Project title</Label>
        <Input
          id="title"
          type="text"
          required
          placeholder="e.g. Powdery mildew resistance in Cabernet"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="planned_years">Planned years (1–10)</Label>
        <Input
          id="planned_years"
          type="number"
          min="1"
          max="10"
          required
          className="w-28"
          value={plannedYears}
          onChange={(e) => setPlannedYears(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="amount">Estimated request this year (optional)</Label>
        <Input
          id="amount"
          type="number"
          min="0"
          step="0.01"
          className="w-40"
          placeholder="e.g. 40000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Creating…" : "Create pre-proposal"}
      </Button>
    </form>
  );
}
