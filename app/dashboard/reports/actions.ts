"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("locked")) {
    return "This report is locked and can no longer be edited.";
  }
  if (m.includes("row-level security") || m.includes("row level security")) {
    return "You don't have permission to do that.";
  }
  return message;
}

/**
 * Save the report narrative -- the ONLY field the researcher may change. The DB
 * guard trigger blocks any other column, and RLS restricts this to the owner.
 */
export async function saveReportNarrative(
  reportId: string,
  narrative: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({ narrative })
    .eq("id", reportId);
  if (error) return { error: friendly(error.message) };

  revalidatePath(`/dashboard/reports/${reportId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Submit the report via the RPC (checks narrative + required documents). */
export async function submitReport(
  reportId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_report", { p_id: reportId });
  if (error) return { error: friendly(error.message) };

  revalidatePath(`/dashboard/reports/${reportId}`);
  revalidatePath("/dashboard");
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
