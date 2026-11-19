"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { portalUrl } from "@/lib/email/format";
import { getUserContact } from "@/lib/email/recipients";
import { sendEmail } from "@/lib/email/send";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string };

export async function approveResearcher(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_researcher", { target: id });
  if (error) return { error: error.message };

  // Approved. Tell the researcher their account is live, after the response is
  // sent -- the manager's click must not wait on an email, and a failure here
  // must not undo an approval that has already happened.
  after(async () => {
    const contact = await getUserContact(id);
    if (!contact) return;
    await sendEmail({
      key: "researcher_approved",
      to: contact.email,
      recipientUserId: id,
      vars: {
        researcher_name: contact.fullName ?? contact.email,
        portal_url: portalUrl(),
      },
      dedupeKey: `researcher_approved:${id}`,
    });
  });

  revalidatePath("/manager");
  revalidatePath("/manager/researchers");
  return {};
}

export async function rejectResearcher(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_researcher", { target: id });
  if (error) return { error: error.message };
  revalidatePath("/manager");
  revalidatePath("/manager/researchers");
  return {};
}

/**
 * Short-lived signed URL for a private CV. The manager's session can read any
 * object in the 'cvs' bucket via the cvs_select_manager storage policy, so the
 * bucket stays private.
 */
export async function getCvUrl(
  cvPath: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("cvs")
    .createSignedUrl(cvPath, 60);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
