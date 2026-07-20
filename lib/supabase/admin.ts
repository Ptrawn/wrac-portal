// SERVER-ONLY. Uses the service-role key, which bypasses RLS. The `server-only`
// import makes any attempt to bundle this into client code fail at build time.
// Import this ONLY from server actions — never from a "use client" module.
import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Admin client backed by SUPABASE_SERVICE_ROLE_KEY. Never expose the key or this
 * client to the browser. No session is persisted; each call is a fresh client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase admin client is not configured.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
