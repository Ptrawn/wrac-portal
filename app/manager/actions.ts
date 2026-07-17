"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string };

export async function approveResearcher(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_researcher", { target: id });
  if (error) return { error: error.message };
  revalidatePath("/manager");
  return {};
}

export async function rejectResearcher(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_researcher", { target: id });
  if (error) return { error: error.message };
  revalidatePath("/manager");
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
