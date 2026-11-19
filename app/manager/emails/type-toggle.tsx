"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setEmailMode } from "./actions";

/**
 * On/off for one email type.
 *
 * role="switch" + aria-checked rather than a styled checkbox, so a screen
 * reader announces the state rather than the word next to it. The written
 * "On"/"Off" stays visible too: a bare track tells a manager nothing about
 * which end is which.
 *
 * aria-label is the TYPE'S NAME, not "turn this on": six switches that all
 * announce the same sentence are six switches a screen reader user cannot tell
 * apart. The role and aria-checked already supply "switch, on" -- what the name
 * has to add is WHICH email this is.
 *
 * The state is optimistic so the switch moves under the cursor, and is rolled
 * back if the write is refused -- a switch that stays on after a failed save is
 * a switch that lies about whether researchers are being emailed.
 */
export function TypeToggle({
  emailKey,
  label,
  on,
}: {
  emailKey: string;
  /** The type's name, so the switch is distinguishable from the other five. */
  label: string;
  on: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const next = !checked;
    setChecked(next);
    setError(null);
    startTransition(async () => {
      const res = await setEmailMode(emailKey, next);
      if (res?.error) {
        setChecked(!next);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-destructive max-w-[16rem]">{error}</span>
      )}
      <span
        className={
          "text-xs font-semibold uppercase tracking-wide w-7 text-right " +
          (checked ? "text-primary" : "text-muted-foreground")
        }
        aria-hidden="true"
      >
        {checked ? "On" : "Off"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={isPending}
        onClick={toggle}
        className={
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
          "disabled:opacity-50 " +
          (checked
            ? "border-transparent bg-primary"
            : "border-input bg-secondary")
        }
      >
        <span
          className={
            "inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform " +
            (checked ? "translate-x-[1.1rem]" : "translate-x-[0.15rem]")
          }
        />
      </button>
    </div>
  );
}
