"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveReminderOffsets } from "../actions";

/**
 * When a reminder goes out, portal-wide.
 *
 * TWO SEPARATE NUMBER FIELDS rather than one comma-separated box: a manager
 * typing "30, 7" into a text field can produce half a dozen malformed shapes,
 * all of which have to be explained back to them. Two boxes can only be empty
 * or a number, and the second being optional is visible rather than a rule.
 *
 * "Use default" clears the stored value instead of writing the default's
 * numbers in. A type following the default keeps following it when the default
 * changes; a type that has 30 and 7 written in has 30 and 7 forever.
 */
export function ReminderSchedule({
  emailKey,
  /** The schedule in force now, furthest-out first. */
  current,
  /** True when `current` is the catalog default rather than a stored value. */
  isDefault,
  /** report_overdue: one value, counting forward from the due date. */
  daysAfter,
}: {
  emailKey: string;
  current: number[];
  isDefault: boolean;
  daysAfter: boolean;
}) {
  const router = useRouter();
  const [first, setFirst] = useState(String(current[0] ?? ""));
  const [second, setSecond] = useState(
    current.length > 1 ? String(current[1]) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const direction = daysAfter ? "after" : "before";

  const parse = (): number[] | string => {
    const raw = daysAfter ? [first] : [first, second];
    const values: number[] = [];
    for (const v of raw) {
      const s = v.trim();
      if (s === "") continue;
      // Reject "7.5" and "7 days" here rather than letting Number() round or
      // the server bounce it: the manager is standing in front of the field.
      if (!/^\d+$/.test(s)) return "Use whole numbers of days.";
      values.push(Number(s));
    }
    if (values.length === 0) return "Enter at least one number of days.";
    if (values.some((n) => n < 1 || n > 120)) {
      return "Each value must be between 1 and 120 days.";
    }
    if (new Set(values).size !== values.length) {
      return "The two values must be different.";
    }
    return values;
  };

  const save = () => {
    const parsed = parse();
    if (typeof parsed === "string") {
      setError(parsed);
      setSaved(null);
      return;
    }
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await saveReminderOffsets(emailKey, parsed);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setSaved("Schedule saved.");
      router.refresh();
    });
  };

  const useDefault = () => {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await saveReminderOffsets(emailKey, null);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setSaved("Back to the default schedule.");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Send reminders</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {daysAfter
            ? "How long after the due date to chase an overdue report."
            : "How many days before the deadline this goes out. A second reminder is optional."}{" "}
          {isDefault ? (
            <>
              Currently the default: <strong>{describe(current, direction)}</strong>.
            </>
          ) : (
            <>
              Currently <strong>{describe(current, direction)}</strong>.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="offset-first" className="text-xs">
            {daysAfter ? "Days after" : "First reminder (days before)"}
          </Label>
          <Input
            id="offset-first"
            type="number"
            min={1}
            max={120}
            step={1}
            className="w-40 num"
            value={first}
            onChange={(e) => {
              setFirst(e.target.value);
              setSaved(null);
            }}
          />
        </div>
        {!daysAfter && (
          <div className="grid gap-1.5">
            <Label htmlFor="offset-second" className="text-xs">
              Second reminder (optional)
            </Label>
            <Input
              id="offset-second"
              type="number"
              min={1}
              max={120}
              step={1}
              className="w-40 num"
              placeholder="none"
              value={second}
              onChange={(e) => {
                setSecond(e.target.value);
                setSaved(null);
              }}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={save} disabled={isPending}>
            {isPending ? "Working…" : "Save schedule"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={useDefault}
            disabled={isPending || isDefault}
            title={
              isDefault
                ? "This type is already on the default schedule"
                : "Clear the stored schedule and follow the default"
            }
          >
            Use default
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && (
        <p className="text-sm text-muted-foreground">{saved}</p>
      )}
    </div>
  );
}

/** "30 and 7 days before", "2 days after", "1 day before". */
function describe(offsets: number[], direction: string): string {
  if (offsets.length === 0) return "not set";
  const list =
    offsets.length === 2 ? `${offsets[0]} and ${offsets[1]}` : `${offsets[0]}`;
  const unit = offsets.length === 1 && offsets[0] === 1 ? "day" : "days";
  return `${list} ${unit} ${direction}`;
}
