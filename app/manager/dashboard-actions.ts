"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Record a manager dashboard visit. Best-effort: a failed visit-record must not
 * break the dashboard, and the RPC throttles so rapid refreshes don't advance
 * the "since last login" window. Call this BEFORE reading manager_dashboard_stats
 * so previous_seen_at reflects the prior session (see the page for the rationale).
 */
export async function recordManagerVisit(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("touch_last_seen");
}
