"use client";

import { useState } from "react";

/**
 * Opens a cycle's proposal template via a short-lived signed URL. The signing
 * action is passed in so each area uses its own server action (and therefore its
 * own session/role) -- the storage policy allows managers, committee members and
 * approved researchers to read.
 *
 * Renders nothing when the cycle has no template, so no empty affordance is left
 * behind.
 */
export function TemplateLink({
  path,
  name,
  signUrl,
  compact = false,
}: {
  path: string | null;
  name: string | null;
  signUrl: (path: string) => Promise<{ url?: string; error?: string }>;
  compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!path) return null;

  const open = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await signUrl(path);
      if (res.error) setError(res.error);
      else if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <span className="text-sm flex flex-wrap items-center gap-x-2">
        <span className="text-muted-foreground">Proposal template:</span>
        <button
          type="button"
          onClick={open}
          disabled={busy}
          className="underline underline-offset-4 disabled:opacity-50"
        >
          {busy ? "Opening…" : (name ?? "View template")}
        </button>
        {error && <span className="text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <div className="rounded-md border border-status-review/40 bg-status-review/5 p-3 flex flex-col gap-1">
      <div className="text-sm font-medium">Proposal template / guidance</div>
      <p className="text-xs text-muted-foreground">
        The program manager&apos;s template for this cycle — read it before
        preparing your documents.
      </p>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="text-sm underline underline-offset-4 w-fit disabled:opacity-50"
      >
        {busy ? "Opening…" : `Open ${name ?? "template"}`}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
