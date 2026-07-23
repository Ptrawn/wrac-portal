"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Short-lived signed URL for a file in the private 'reports' bucket. Runs as the
 * calling user, so committee and manager access are governed by the bucket's
 * own RLS policies (owner / manager / committee-visible).
 */
export async function getReportFileSignedUrl(
  path: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("reports")
    .createSignedUrl(path, 60);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
