"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCycle } from "./actions";

export function CreateCycleForm() {
  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [totalBudget, setTotalBudget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCycle({
        name: name.trim(),
        year: Number(year),
        total_budget: totalBudget.trim() === "" ? null : totalBudget.trim(),
      });
      // On success the action redirects; we only get here on error.
      if (res?.error) setError(res.error);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          type="text"
          placeholder="2026 Research Cycle"
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
          placeholder="2026"
          required
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="total_budget">Total budget (optional)</Label>
        <Input
          id="total_budget"
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g. 500000"
          value={totalBudget}
          onChange={(e) => setTotalBudget(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Creating…" : "Create cycle"}
      </Button>
    </form>
  );
}
