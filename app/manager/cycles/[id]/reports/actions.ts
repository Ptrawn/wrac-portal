"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("row-level security") || m.includes("row level security")) {
    return "You don't have permission to do that.";
  }
  return message;
}

function revalidate(cycleId: string): void {
  revalidatePath(`/manager/cycles/${cycleId}/reports`);
}

export async function createReport(
  cycleId: string,
  input: {
    projectId: string;
    proposalId: string | null;
    type: string;
    label: string | null;
    dueDate: string | null;
    // Which status default seeds the due date: 1 = first status report,
    // 2 = second. Ignored by the RPC for a final report. Defaults to 1, so an
    // omitted value behaves exactly as before.
    statusIndex?: number;
  },
): Promise<{ error?: string; newReportId?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_report", {
    p_project_id: input.projectId,
    p_cycle_id: cycleId,
    p_type: input.type,
    p_label: input.label,
    p_due_date: input.dueDate,
    p_proposal_id: input.proposalId,
    p_status_index: input.statusIndex ?? 1,
  });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId);
  return { newReportId: data as string };
}

/** One project's outcome within a batch request. */
export type BatchReportResult = {
  projectId: string;
  projectTitle: string;
  ok: boolean;
  error?: string;
};

/**
 * Request the SAME report for several funded projects in one action. Type,
 * status index, label and due date are shared across the batch; only the
 * project (and its proposal) differ.
 *
 * There is no batch RPC and we are not adding one, so this loops and calls
 * create_report once per project. That means the batch is NOT atomic, which is
 * the right trade here: each report is independent, and a failure on one
 * project is no reason to withhold the other seven. Every project is attempted
 * regardless of earlier failures, and each outcome is returned so the caller can
 * show exactly what succeeded and what did not — nothing is rolled back and
 * nothing is swallowed.
 */
export async function createReportsForProjects(
  cycleId: string,
  input: {
    projects: { projectId: string; proposalId: string | null; title: string }[];
    type: string;
    label: string | null;
    dueDate: string | null;
    statusIndex?: number;
  },
): Promise<{ results: BatchReportResult[] }> {
  const supabase = await createClient();
  const results: BatchReportResult[] = [];

  for (const project of input.projects) {
    const { error } = await supabase.rpc("create_report", {
      p_project_id: project.projectId,
      p_cycle_id: cycleId,
      p_type: input.type,
      p_label: input.label,
      p_due_date: input.dueDate,
      p_proposal_id: project.proposalId,
      p_status_index: input.statusIndex ?? 1,
    });
    results.push({
      projectId: project.projectId,
      projectTitle: project.title,
      ok: !error,
      error: error ? friendly(error.message) : undefined,
    });
  }

  // Revalidate once, not per project — even a partial batch changed the list.
  revalidate(cycleId);
  return { results };
}

export async function updateReportSchedule(
  cycleId: string,
  reportId: string,
  label: string | null,
  dueDate: string | null,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_report_schedule", {
    p_id: reportId,
    p_label: label,
    p_due_date: dueDate,
  });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId);
  return { ok: true };
}

export async function deleteReport(
  cycleId: string,
  reportId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_report", { p_id: reportId });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId);
  return { ok: true };
}

export async function reopenReport(
  cycleId: string,
  reportId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_report", { p_id: reportId });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId);
  return { ok: true };
}

/** Short-lived signed URL for a file in the private 'reports' bucket. */
export async function getReportFileUrl(
  path: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("reports")
    .createSignedUrl(path, 60);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
