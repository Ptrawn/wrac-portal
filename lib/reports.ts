import { createClient } from "@/lib/supabase/server";
import type { ReportHistoryItem } from "@/components/reporting-history";

// Row shape from the project_reports RPC (numerics/dates arrive as strings).
type ProjectReportRpcRow = {
  report_id: string;
  type: string;
  label: string | null;
  due_date: string | null;
  state: string;
  narrative: string | null;
  submitted_at: string | null;
  cycle_name: string | null;
  year_number: number | null;
};

type ReportDocRow = {
  id: string;
  report_id: string;
  file_name: string;
  file_path: string;
};

/**
 * Load a project's full reporting history (all reports + their documents),
 * shaped for <ProjectReportingHistory>. Access is enforced by the project_reports
 * RPC and report_documents RLS for the calling role (owner / committee / manager).
 * Returns [] when the project has no reports (the component then renders nothing).
 */
export async function loadProjectReportingHistory(
  projectId: string,
): Promise<ReportHistoryItem[]> {
  const supabase = await createClient();

  const { data: rpcData } = await supabase.rpc("project_reports", {
    p_project_id: projectId,
  });
  const rows = (rpcData as ProjectReportRpcRow[] | null) ?? [];
  if (rows.length === 0) return [];

  const reportIds = rows.map((r) => r.report_id);
  const { data: docData } = await supabase
    .from("report_documents")
    .select("id, report_id, file_name, file_path")
    .in("report_id", reportIds);

  const docsByReport = new Map<
    string,
    { id: string; file_name: string; file_path: string }[]
  >();
  for (const d of (docData as ReportDocRow[] | null) ?? []) {
    const list = docsByReport.get(d.report_id) ?? [];
    list.push({ id: d.id, file_name: d.file_name, file_path: d.file_path });
    docsByReport.set(d.report_id, list);
  }

  return rows.map((r) => ({
    report_id: r.report_id,
    type: r.type,
    label: r.label,
    due_date: r.due_date,
    state: r.state,
    narrative: r.narrative,
    submitted_at: r.submitted_at,
    cycle_name: r.cycle_name,
    year_number: r.year_number,
    documents: docsByReport.get(r.report_id) ?? [],
  }));
}
