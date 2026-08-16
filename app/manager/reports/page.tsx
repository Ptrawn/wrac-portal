import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import { pacificDateToday } from "@/lib/cycles";
import { ReportsDashboard, type DashboardReport } from "./reports-dashboard";

type RawReport = {
  id: string;
  type: string;
  label: string | null;
  due_date: string | null;
  state: string;
  submitted_at: string | null;
  cycle_id: string;
  cycle: { name: string; year: number; status: string } | null;
  project: {
    title: string;
    researcher: { full_name: string | null } | null;
  } | null;
  proposal: { year_number: number } | null;
};

/**
 * Cross-cycle report status dashboard. Reports outlive the cycle that requested
 * them -- a CLOSED cycle can still owe reports -- so this deliberately spans all
 * cycles and never filters closed ones out. Reports are not deadline-enforced;
 * "past due" here is informational, and the manager grants grace by moving the
 * due date inline.
 */
export default async function ManagerReportsDashboardPage() {
  const { email } = await requireManager();
  const supabase = await createClient();

  const { data: reportData } = await supabase
    .from("reports")
    .select(
      "id, type, label, due_date, state, submitted_at, cycle_id, cycle:cycles(name, year, status), project:projects(title, researcher:profiles!researcher_id(full_name)), proposal:proposals(year_number)",
    );
  // Supabase types infer to-one embeds as arrays; at runtime they're objects.
  const raw = (reportData as unknown as RawReport[] | null) ?? [];

  const reports: DashboardReport[] = raw.map((r) => ({
    id: r.id,
    type: r.type,
    label: r.label,
    due_date: r.due_date,
    state: r.state,
    submitted_at: r.submitted_at,
    cycle_id: r.cycle_id,
    cycle_name: r.cycle?.name ?? "Unknown cycle",
    cycle_year: r.cycle?.year ?? null,
    cycle_closed: r.cycle?.status === "closed",
    project_title: r.project?.title ?? "Unknown project",
    researcher_name: r.project?.researcher?.full_name ?? null,
    year_number: r.proposal?.year_number ?? null,
  }));

  const today = pacificDateToday();
  const outstanding = reports.filter(
    (r) => r.state === "pending" || r.state === "reopened",
  );

  // Oldest due date first = most overdue first.
  const pastDue = outstanding
    .filter((r) => r.due_date != null && r.due_date < today)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));

  // Due today or later, soonest first; undated outstanding reports sort last.
  const upcoming = outstanding
    .filter((r) => r.due_date == null || r.due_date >= today)
    .sort((a, b) => {
      if (a.due_date == null) return b.due_date == null ? 0 : 1;
      if (b.due_date == null) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    });

  const submitted = reports
    .filter((r) => r.state === "submitted")
    .sort((a, b) => (a.submitted_at ?? "") < (b.submitted_at ?? "") ? 1 : -1);

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-4xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <Link
            href="/manager"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-1">Report status</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Status and final reports across every cycle, including closed ones.{" "}
            {pastDue.length > 0 ? (
              <span className="text-destructive font-medium">
                {pastDue.length} past due
              </span>
            ) : (
              <span>Nothing past due</span>
            )}{" "}
            · {upcoming.length} upcoming · {submitted.length} submitted
          </p>
        </div>

        <ReportsDashboard
          pastDue={pastDue}
          upcoming={upcoming}
          submitted={submitted}
          today={today}
        />
      </div>
    </main>
  );
}
