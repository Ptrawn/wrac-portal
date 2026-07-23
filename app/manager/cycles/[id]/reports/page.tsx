import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import { pacificDateToday, statusLabel, type Cycle } from "@/lib/cycles";
import { RequestReport, type FundedProject } from "./request-report";
import { ReportsList, type ReportItem } from "./reports-list";

type RawReport = {
  id: string;
  type: string;
  label: string | null;
  due_date: string | null;
  state: string;
  narrative: string | null;
  submitted_at: string | null;
  project_id: string;
  proposal_id: string | null;
  project: {
    title: string;
    researcher: { full_name: string | null; institution: string | null } | null;
  } | null;
  proposal: { year_number: number } | null;
};

type RawFunded = {
  id: string;
  year_number: number;
  project_id: string;
  project: { title: string } | null;
  researcher: { full_name: string | null } | null;
};

export default async function ManagerReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await requireManager();
  const { id: cycleId } = await params;

  const supabase = await createClient();

  const { data: cycleData } = await supabase
    .from("cycles")
    .select("*")
    .eq("id", cycleId)
    .single();
  if (!cycleData) notFound();
  const cycle = cycleData as Cycle;

  const { data: reportData } = await supabase
    .from("reports")
    .select(
      "id, type, label, due_date, state, narrative, submitted_at, project_id, proposal_id, project:projects(title, researcher:profiles!researcher_id(full_name, institution)), proposal:proposals(year_number)",
    )
    .eq("cycle_id", cycleId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  const rawReports = (reportData as unknown as RawReport[] | null) ?? [];

  const reportIds = rawReports.map((r) => r.id);
  const docsByReport = new Map<
    string,
    { id: string; file_name: string; file_path: string }[]
  >();
  if (reportIds.length > 0) {
    const { data: docData } = await supabase
      .from("report_documents")
      .select("id, report_id, file_name, file_path")
      .in("report_id", reportIds);
    for (const d of (docData as
      | { id: string; report_id: string; file_name: string; file_path: string }[]
      | null) ?? []) {
      const list = docsByReport.get(d.report_id) ?? [];
      list.push({ id: d.id, file_name: d.file_name, file_path: d.file_path });
      docsByReport.set(d.report_id, list);
    }
  }

  const pacificToday = pacificDateToday();
  const reports: ReportItem[] = rawReports.map((r) => ({
    id: r.id,
    type: r.type,
    label: r.label,
    due_date: r.due_date,
    state: r.state,
    narrative: r.narrative,
    submitted_at: r.submitted_at,
    year_number: r.proposal?.year_number ?? null,
    project_title: r.project?.title ?? "Unknown project",
    researcher_name: r.project?.researcher?.full_name ?? null,
    researcher_institution: r.project?.researcher?.institution ?? null,
    overdue:
      r.state === "pending" && r.due_date != null && r.due_date < pacificToday,
    documents: docsByReport.get(r.id) ?? [],
  }));

  const { data: fundedData } = await supabase
    .from("proposals")
    .select(
      "id, year_number, project_id, project:projects(title), researcher:profiles!researcher_id(full_name)",
    )
    .eq("cycle_id", cycleId)
    .eq("outcome", "funded")
    .order("title", { ascending: true });
  const fundedProjects: FundedProject[] = (
    (fundedData as unknown as RawFunded[] | null) ?? []
  ).map((f) => ({
    proposalId: f.id,
    projectId: f.project_id,
    projectTitle: f.project?.title ?? "Untitled project",
    researcherName: f.researcher?.full_name ?? null,
    yearNumber: f.year_number,
  }));

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-4xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <Link
            href={`/manager/cycles/${cycleId}`}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Cycle
          </Link>
          <h1 className="text-2xl font-bold mt-1">
            {cycle.name} ({cycle.year}) — reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {statusLabel(cycle.status)} · {reports.length} report
            {reports.length === 1 ? "" : "s"}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Request a report</CardTitle>
          </CardHeader>
          <CardContent>
            <RequestReport
              cycleId={cycleId}
              fundedProjects={fundedProjects}
              defaultStatusDue={cycle.default_status_report_due_at}
              defaultFinalDue={cycle.default_final_report_due_at}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">All reports</CardTitle>
          </CardHeader>
          <CardContent>
            <ReportsList cycleId={cycleId} reports={reports} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
