import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import { ResearchersList, type ResearcherRow } from "./researchers-list";

/**
 * Every registered researcher, not just the pending queue.
 *
 * Sourced from the manager-only list_researchers() RPC: emails live in
 * auth.users, which PostgREST doesn't expose, so a SECURITY DEFINER RPC is the
 * only way to show them -- and it covers pending, approved and rejected alike.
 */
export default async function ManagerResearchersPage() {
  const { email } = await requireManager();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_researchers");
  const researchers = (data as ResearcherRow[] | null) ?? [];

  const pendingCount = researchers.filter((r) => r.status === "pending").length;

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-3xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <Link
            href="/manager"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-1">Researchers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everyone who has registered as a researcher.{" "}
            {pendingCount > 0
              ? `${pendingCount} awaiting approval — you can approve or reject them here.`
              : "No one is awaiting approval."}
          </p>
        </div>

        {error ? (
          <p className="text-sm text-destructive">
            Couldn&apos;t load researchers: {error.message}
          </p>
        ) : researchers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No researchers have registered yet.
          </p>
        ) : (
          <ResearchersList researchers={researchers} />
        )}
      </div>
    </main>
  );
}
