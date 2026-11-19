"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { portalUrl } from "@/lib/email/format";
import {
  getManagerNotificationAddress,
  getUserContact,
} from "@/lib/email/recipients";
import { sendEmail } from "@/lib/email/send";
import { reportTypeLabel } from "@/lib/reviews";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Submitted. Let the manager know a report is waiting, after the response.
  // Service-role reads: there is no session inside after(), and the researcher
  // could not read the manager's notification address anyway.
  after(async () => {
    const to = await getManagerNotificationAddress();
    if (!to) return;

    const admin = createAdminClient();
    const { data: reportRow } = await admin
      .from("reports")
      .select("type, project_id")
      .eq("id", reportId)
      .single();
    if (!reportRow) return;
    const report = reportRow as { type: string; project_id: string };

    const { data: projectRow } = await admin
      .from("projects")
      .select("title, researcher_id")
      .eq("id", report.project_id)
      .single();
    if (!projectRow) return;
    const project = projectRow as { title: string; researcher_id: string };

    const contact = await getUserContact(project.researcher_id);
    await sendEmail({
      key: "report_submitted",
      to,
      vars: {
        researcher_name: contact?.fullName ?? contact?.email ?? "A researcher",
        project_title: project.title,
        // Lower-cased: the label reads mid-sentence ("a status report").
        report_type: reportTypeLabel(report.type).toLowerCase(),
        portal_url: portalUrl(),
      },
      dedupeKey: `report_submitted:${reportId}`,
      entity: { type: "report", id: reportId },
    });
  });

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
