import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedResearcher } from "@/lib/auth/profile";
import {
  formatLongDate,
  pacificDateToday,
  type DocumentRequirement,
} from "@/lib/cycles";
import { reportStateLabel, reportTypeLabel, stageForReportType } from "@/lib/reviews";
import { ReportWorkspace, type ReportDoc } from "./workspace";

type ReportDetail = {
  id: string;
  type: string;
  label: string | null;
  due_date: string | null;
  state: string;
  narrative: string | null;
  cycle_id: string;
  project_id: string;
  project: { title: string } | null;
  cycle: { name: string; year: number } | null;
};

function stateBadgeVariant(
  state: string,
): "default" | "secondary" | "outline" {
  switch (state) {
    case "submitted":
      return "default";
    case "reopened":
      return "outline";
    default:
      return "secondary";
  }
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await requireApprovedResearcher();
  const { id } = await params;

  const supabase = await createClient();

  // RLS restricts this to the owner; a non-owner (or missing) id yields null.
  const { data: reportData } = await supabase
    .from("reports")
    .select(
      "id, type, label, due_date, state, narrative, cycle_id, project_id, project:projects(title), cycle:cycles(name, year)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!reportData) {
    return (
      <main className="min-h-screen flex flex-col items-center">
        <AppHeader email={email} />
        <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Dashboard
          </Link>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Report not found</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This report doesn&apos;t exist or isn&apos;t yours.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const report = reportData as unknown as ReportDetail;
  const stage = stageForReportType(report.type);

  const { data: requirementData } = await supabase
    .from("document_requirements")
    .select("*")
    .eq("cycle_id", report.cycle_id)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const requirements = (requirementData as DocumentRequirement[] | null) ?? [];

  const { data: documentData } = await supabase
    .from("report_documents")
    .select("id, requirement_id, file_path, file_name")
    .eq("report_id", id);
  const documents = (documentData as ReportDoc[] | null) ?? [];

  const editable = report.state === "pending" || report.state === "reopened";
  const overdue =
    report.state === "pending" &&
    report.due_date != null &&
    report.due_date < pacificDateToday();

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Dashboard
        </Link>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">
                {report.project?.title ?? "Report"}
              </CardTitle>
              <div className="flex items-center gap-2 shrink-0">
                {overdue && (
                  <Badge
                    variant="outline"
                    className="border-destructive/40 text-destructive"
                  >
                    Overdue
                  </Badge>
                )}
                <Badge variant={stateBadgeVariant(report.state)}>
                  {reportStateLabel(report.state)}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {reportTypeLabel(report.type)} report
              {report.label ? ` · ${report.label}` : ""}
              {report.cycle ? ` · ${report.cycle.name} (${report.cycle.year})` : ""}{" "}
              · Due {formatLongDate(report.due_date)}
            </p>
            {report.state === "reopened" && (
              <p className="text-sm mt-1 rounded-md border bg-accent p-2">
                The program manager reopened this report for changes. Update it
                and resubmit.
              </p>
            )}
          </CardHeader>
          <CardContent>
            <ReportWorkspace
              reportId={report.id}
              state={report.state}
              editable={editable}
              initialNarrative={report.narrative ?? ""}
              requirements={requirements}
              documents={documents}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
