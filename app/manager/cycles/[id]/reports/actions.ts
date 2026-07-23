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
  });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId);
  return { newReportId: data as string };
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
