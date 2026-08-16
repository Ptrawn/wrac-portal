"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { daysRemainingText, daysUntilDate, formatDate } from "@/lib/cycles";
import { reportStateLabel, reportTypeLabel } from "@/lib/reviews";
import { updateReportDueDate } from "./actions";

export type DashboardReport = {
  id: string;
  type: string;
  label: string | null;
  due_date: string | null;
  state: string;
  submitted_at: string | null;
  cycle_id: string;
  cycle_name: string;
  cycle_year: number | null;
  cycle_closed: boolean;
  project_title: string;
  researcher_name: string | null;
  year_number: number | null;
};

function stateBadgeVariant(state: string): "default" | "secondary" | "outline" {
  if (state === "submitted") return "default";
  if (state === "reopened") return "outline";
  return "secondary";
}

/**
 * Cross-cycle report status dashboard. Reports outlive their cycle (a closed
 * cycle can still owe reports), so every row names its cycle and closed cycles
 * are deliberately included.
 */
export function ReportsDashboard({
  pastDue,
  upcoming,
  submitted,
  today,
}: {
  pastDue: DashboardReport[];
  upcoming: DashboardReport[];
  submitted: DashboardReport[];
  today: string;
}) {
  const [showSubmitted, setShowSubmitted] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <Group
        title="Past due"
        hint="Outstanding reports whose due date has passed — most overdue first."
        emptyText="Nothing is past due. "
        reports={pastDue}
        today={today}
        tone="destructive"
      />

      <Group
        title="Upcoming"
        hint="Outstanding reports due today or later, soonest first."
        emptyText="No outstanding reports are scheduled."
        reports={upcoming}
        today={today}
        tone="review"
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">
              Submitted{" "}
              <span className="text-muted-foreground font-normal text-base">
                ({submitted.length})
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Reports already handed in, most recent first.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSubmitted((v) => !v)}
          >
            {showSubmitted ? "Hide" : "Show"}
          </Button>
        </div>
        {showSubmitted &&
          (submitted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reports have been submitted yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {submitted.map((r) => (
                <ReportRow key={r.id} r={r} today={today} tone="none" />
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}

function Group({
  title,
  hint,
  emptyText,
  reports,
  today,
  tone,
}: {
  title: string;
  hint: string;
  emptyText: string;
  reports: DashboardReport[];
  today: string;
  tone: "destructive" | "review";
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">
          {title}{" "}
          <span
            className={
              "font-normal text-base " +
              (reports.length > 0 && tone === "destructive"
                ? "text-destructive"
                : "text-muted-foreground")
            }
          >
            ({reports.length})
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((r) => (
            <ReportRow key={r.id} r={r} today={today} tone={tone} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportRow({
  r,
  today,
  tone,
}: {
  r: DashboardReport;
  today: string;
  tone: "destructive" | "review" | "none";
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [dueDate, setDueDate] = useState(r.due_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const days = daysUntilDate(r.due_date, today);
  const overdue = tone === "destructive";

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateReportDueDate(
        r.id,
        r.cycle_id,
        r.label,
        dueDate.trim() === "" ? null : dueDate,
      );
      if (res?.error) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  return (
    <li
      className={
        "border rounded-md p-3 flex flex-col gap-2" +
        (overdue ? " border-destructive/40" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm min-w-0">
          <div className="font-medium">
            {r.project_title}{" "}
            <span className="text-muted-foreground font-normal">
              — {reportTypeLabel(r.type)} report
              {r.year_number != null ? ` · Year ${r.year_number}` : ""}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {r.researcher_name ?? "Unknown researcher"}
            {r.label ? ` · ${r.label}` : ""}
          </div>
          <div className="text-xs mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {/* The cycle is required context: reports span cycles. */}
            <Link
              href={`/manager/cycles/${r.cycle_id}/reports`}
              className="underline underline-offset-4"
            >
              {r.cycle_name}
              {r.cycle_year != null ? ` (${r.cycle_year})` : ""}
            </Link>
            {r.cycle_closed && (
              <Badge variant="secondary" className="text-[10px]">
                Cycle closed
              </Badge>
            )}
            <span
              className={
                overdue
                  ? "text-destructive font-medium"
                  : tone === "review"
                    ? "text-status-review"
                    : "text-muted-foreground"
              }
            >
              {r.due_date ? (
                <>
                  Due {formatDate(r.due_date)}
                  {r.state !== "submitted" &&
                    ` · ${
                      days != null && days < 0
                        ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
                        : daysRemainingText(days)
                    }`}
                </>
              ) : (
                "No due date set"
              )}
            </span>
            {r.submitted_at && (
              <span className="text-muted-foreground">
                Submitted {formatDate(r.submitted_at.slice(0, 10))}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={stateBadgeVariant(r.state)}>
            {reportStateLabel(r.state)}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            setDueDate(r.due_date ?? "");
            setEditing((v) => !v);
            setError(null);
          }}
        >
          {editing ? "Cancel" : "Change due date"}
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/manager/cycles/${r.cycle_id}/reports`}>
            Open in cycle
          </Link>
        </Button>
      </div>

      {editing && (
        <div className="flex flex-wrap items-end gap-2 border rounded-md p-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`due-${r.id}`}
              className="text-[10px] uppercase text-muted-foreground"
            >
              New due date
            </label>
            <Input
              id={`due-${r.id}`}
              type="date"
              className="w-48"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <Button size="sm" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Save due date"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Clearing the date leaves the report outstanding with no deadline.
          </span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}
