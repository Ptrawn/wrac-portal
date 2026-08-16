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

/**
 * Move a report's due date from the cross-cycle dashboard (case-by-case grace).
 * Reuses the existing update_report_schedule RPC, which also carries the label —
 * we pass the current label through unchanged so only the date moves. Reports are
 * deliberately NOT deadline-enforced, so this never gates anything; it just
 * changes what the manager (and researcher) see as due.
 */
export async function updateReportDueDate(
  reportId: string,
  cycleId: string,
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

  revalidatePath("/manager/reports");
  revalidatePath("/manager");
  revalidatePath(`/manager/cycles/${cycleId}/reports`);
  revalidatePath(`/manager/cycles/${cycleId}`);
  return { ok: true };
}
