import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedResearcher } from "@/lib/auth/profile";
import { formatDate } from "@/lib/cycles";
import { CreatePreProposalForm } from "../create-form";

export default async function NewPreProposalPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { email } = await requireApprovedResearcher();
  const { cycle: cycleId } = await searchParams;

  const supabase = await createClient();
  const { data: cycle } = cycleId
    ? await supabase
        .from("cycles")
        .select("id, name, year, status, pre_proposal_closes_at")
        .eq("id", cycleId)
        .single()
    : { data: null };

  const isOpen = cycle && cycle.status === "pre_proposal_open";

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Dashboard
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Start a pre-proposal</CardTitle>
            {isOpen ? (
              <CardDescription>
                {cycle.name} ({cycle.year}) — deadline{" "}
                {formatDate(cycle.pre_proposal_closes_at)}
              </CardDescription>
            ) : (
              <CardDescription>
                This cycle isn&apos;t open for pre-proposals.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {isOpen ? (
              <CreatePreProposalForm cycleId={cycle.id} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Head back to the{" "}
                <Link href="/dashboard" className="underline">
                  dashboard
                </Link>{" "}
                and pick an open cycle.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
