"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fetchMoreLog } from "./actions";
import { LOG_STATUSES, type LogPage, type LogRow } from "./log-types";

const STATUS_LABELS: Record<string, string> = {
  sent: "Sent",
  logged: "Logged",
  failed: "Failed",
  sending: "Sending",
};

/**
 * Four states, three meanings. 'sent' and 'logged' both mean nothing went
 * wrong, so neither is coloured as a problem -- but they are visually distinct,
 * because "recorded, not delivered" is the single most misreadable thing on
 * this page.
 */
function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  if (status === "failed") return <Badge variant="destructive">{label}</Badge>;
  if (status === "sent")
    return (
      <Badge variant="outline" className="text-status-funded border-status-funded">
        {label}
      </Badge>
    );
  if (status === "sending")
    return (
      <Badge variant="outline" className="text-status-review border-status-review">
        {label}
      </Badge>
    );
  return <Badge variant="secondary">{label}</Badge>;
}

export function SendLog({
  initial,
  typeOptions,
}: {
  initial: LogPage;
  typeOptions: { key: string; label: string }[];
}) {
  const [rows, setRows] = useState<LogRow[]>(initial.rows);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [error, setError] = useState<string | null>(initial.error);
  const [emailKey, setEmailKey] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * Re-query on every filter change rather than filtering `rows` in the
   * browser. Filtering what is already loaded would answer "no failures" from a
   * page of 50 recent rows while the failures sit on page two -- exactly the
   * question this log exists to answer honestly.
   */
  const applyFilters = (nextKey: string, nextStatus: string) => {
    setEmailKey(nextKey);
    setStatus(nextStatus);
    setExpanded(null);
    startTransition(async () => {
      const page = await fetchMoreLog({
        emailKey: nextKey || null,
        status: nextStatus || null,
        offset: 0,
      });
      setRows(page.rows);
      setHasMore(page.hasMore);
      setError(page.error);
    });
  };

  const loadMore = () => {
    startTransition(async () => {
      const page = await fetchMoreLog({
        emailKey: emailKey || null,
        status: status || null,
        offset: rows.length,
      });
      setRows((prev) => [...prev, ...page.rows]);
      setHasMore(page.hasMore);
      setError(page.error);
    });
  };

  const filtering = emailKey !== "" || status !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1">
          <Label htmlFor="log-type" className="text-xs">
            Email type
          </Label>
          <select
            id="log-type"
            value={emailKey}
            onChange={(e) => applyFilters(e.target.value, status)}
            className="border rounded-md h-9 px-2 text-sm bg-background"
          >
            <option value="">All types</option>
            {typeOptions.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="log-status" className="text-xs">
            Status
          </Label>
          <select
            id="log-status"
            value={status}
            onChange={(e) => applyFilters(emailKey, e.target.value)}
            className="border rounded-md h-9 px-2 text-sm bg-background"
          >
            <option value="">Any status</option>
            {LOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {filtering && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyFilters("", "")}
          >
            Clear filters
          </Button>
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t read the send log: {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filtering
            ? "No messages match those filters."
            : "Nothing has been sent or logged yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => {
            const open = expanded === row.id;
            return (
              <li key={row.id} className="border rounded-md">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : row.id)}
                  className="w-full text-left p-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-accent/50 rounded-md"
                >
                  <span className="text-xs text-muted-foreground tabular-nums w-44 shrink-0">
                    {row.time}
                  </span>
                  <span className="text-sm font-medium min-w-0 flex-1 truncate">
                    {row.subject}
                  </span>
                  <span className="text-xs text-muted-foreground min-w-0 truncate">
                    {row.typeLabel} → {row.recipient}
                  </span>
                  <StatusBadge status={row.status} />
                </button>
                {row.status === "failed" && row.error && (
                  <p className="px-3 pb-2 -mt-1 text-xs text-destructive break-words">
                    {row.error}
                  </p>
                )}
                {open && (
                  <div className="border-t p-3 flex flex-col gap-2">
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">To:</span> {row.recipient}
                      {" · "}
                      <span className="font-medium">Type:</span> {row.typeLabel}
                    </div>
                    <div className="text-sm font-medium">{row.subject}</div>
                    <pre className="text-sm whitespace-pre-wrap font-sans bg-sunken border rounded-md p-3">
                      {row.body}
                    </pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && !error && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={loadMore}
          disabled={isPending}
        >
          {isPending ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
