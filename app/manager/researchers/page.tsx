import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import { ResearchersList, type ResearcherRow } from "./researchers-list";

type ProfileRow = {
  id: string;
  full_name: string | null;
  institution: string | null;
  status: string;
  cv_path: string | null;
  created_at: string;
};

type PendingRow = { id: string; email: string | null };

/**
 * Every registered researcher, not just the pending queue.
 *
 * Emails live in auth.users, which PostgREST doesn't expose -- only a SECURITY
 * DEFINER RPC can reach them. list_pending_researchers() supplies them for the
 * PENDING rows; approved/rejected rows show no email until an equivalent
 * list_researchers() RPC exists (see the note handed to the manager).
 */
export default async function ManagerResearchersPage() {
  const { email } = await requireManager();
  const supabase = await createClient();

  const { data: profileData, error } = await supabase
    .from("profiles")
    .select("id, full_name, institution, status, cv_path, created_at")
    .eq("role", "researcher")
    .order("created_at", { ascending: false });
  const profiles = (profileData as ProfileRow[] | null) ?? [];

  const { data: pendingData } = await supabase.rpc("list_pending_researchers");
  const emailById = new Map<string, string | null>(
    ((pendingData as PendingRow[] | null) ?? []).map((p) => [p.id, p.email]),
  );

  const researchers: ResearcherRow[] = profiles.map((p) => ({
    id: p.id,
    full_name: p.full_name,
    institution: p.institution,
    email: emailById.get(p.id) ?? null,
    status: p.status,
    cv_path: p.cv_path,
    created_at: p.created_at,
  }));

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
