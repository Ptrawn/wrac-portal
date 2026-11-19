"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setCycleReminderOffsets } from "../actions";

export type CycleReminder = {
  key: string;
  label: string;
  /** What the deadline is, in words, so the row says what it chases. */
  deadlineLabel: string;
  /** The portal-wide schedule this cycle falls back to. */
  defaultOffsets: number[];
  /** This cycle's override, or null when it follows the default. */
  cycleOffsets: number[] | null;
};

/**
 * Per-cycle reminder schedules.
 *
 * Each row is independent and saves on its own: these write a different table
 * from the cycle itself, so folding them into the cycle form's single Save
 * would mean one button performing two unrelated writes with two ways to fail.
 *
 * A row starts collapsed, showing the schedule in force and where it comes
 * from. Most cycles never need an override, and a screen of number boxes for
 * settings nobody is changing is a screen nobody reads.
 */
export function CycleReminders({
  cycleId,
  reminders,
}: {
  cycleId: string;
  reminders: CycleReminder[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        When each reminder goes out for this cycle. Whether a reminder is sent
        at all is set once for the whole portal, on the System Email page — a
        schedule here does nothing while its type is switched off.
      </p>
      <ul className="flex flex-col gap-2">
        {reminders.map((r) => (
          <li key={r.key} className="border rounded-md p-3">
            <ReminderRow cycleId={cycleId} reminder={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReminderRow({
  cycleId,
  reminder,
}: {
  cycleId: string;
  reminder: CycleReminder;
}) {
  const router = useRouter();
  const inForce = reminder.cycleOffsets ?? reminder.defaultOffsets;
  const isDefault = reminder.cycleOffsets === null;

  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(String(inForce[0] ?? ""));
  const [second, setSecond] = useState(
    inForce.length > 1 ? String(inForce[1]) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    const values: number[] = [];
    for (const raw of [first, second]) {
      const s = raw.trim();
      if (s === "") continue;
      if (!/^\d+$/.test(s)) {
        setError("Use whole numbers of days.");
        return;
      }
      values.push(Number(s));
    }
    if (values.length === 0) {
      setError("Enter at least one number of days.");
      return;
    }
    if (values.some((n) => n < 1 || n > 120)) {
      setError("Each value must be between 1 and 120 days.");
      return;
    }
    if (new Set(values).size !== values.length) {
      setError("The two values must be different.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await setCycleReminderOffsets(cycleId, reminder.key, values);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const clear = () => {
    setError(null);
    startTransition(async () => {
      const res = await setCycleReminderOffsets(cycleId, reminder.key, null);
      if (res?.error) {
        setError(res.error);
        return;
      }
      const back = reminder.defaultOffsets;
      setFirst(String(back[0] ?? ""));
      setSecond(back.length > 1 ? String(back[1]) : "");
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm min-w-0">
          <div className="font-medium">{reminder.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {reminder.deadlineLabel} ·{" "}
            {isDefault ? (
              <>Default ({describe(inForce)})</>
            ) : (
              <span className="font-medium text-foreground">
                This cycle: {describe(inForce)}
              </span>
            )}
          </div>
        </div>
        {!editing && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            {isDefault ? "Set for this cycle" : "Change"}
          </Button>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Input
            type="number"
            min={1}
            max={120}
            step={1}
            aria-label={`${reminder.label}: first reminder, days before`}
            className="w-28 num"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
          <Input
            type="number"
            min={1}
            max={120}
            step={1}
            placeholder="none"
            aria-label={`${reminder.label}: second reminder, days before (optional)`}
            className="w-28 num"
            value={second}
            onChange={(e) => setSecond(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">days before</span>
          <Button type="button" size="sm" onClick={save} disabled={isPending}>
            {isPending ? "Working…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={clear}
            disabled={isPending || isDefault}
            title={
              isDefault
                ? "This cycle already follows the default"
                : "Remove this cycle's schedule and follow the default"
            }
          >
            Use default
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setError(null);
              setFirst(String(inForce[0] ?? ""));
              setSecond(inForce.length > 1 ? String(inForce[1]) : "");
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** "30 and 7 days before", "7 days before", "1 day before". */
function describe(offsets: number[]): string {
  if (offsets.length === 0) return "not set";
  const list =
    offsets.length === 2 ? `${offsets[0]} and ${offsets[1]}` : `${offsets[0]}`;
  const unit = offsets.length === 1 && offsets[0] === 1 ? "day" : "days";
  return `${list} ${unit} before`;
}
