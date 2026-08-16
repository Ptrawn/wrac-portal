import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import {
  pacificDateToday,
  statusLabel,
  type Cycle,
  type DocumentRequirement,
  type ReviewQuestion,
} from "@/lib/cycles";
import { EditCycleForm } from "../edit-form";
import { CycleStats } from "./cycle-stats";
import { CycleStatusControl } from "./cycle-status";
import { QuestionSets } from "./question-sets";
import { DocumentRequirements } from "./document-requirements";

function num(value: number | string | null): number {
  if (value === null || value === "") return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await requireManager();
  const { id } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("cycles")
    .select("*")
    .eq("id", id)
    .single();

  if (!data) {
    notFound();
  }
  const cycle = data as Cycle;

  const { data: questionData } = await supabase
    .from("review_questions")
    .select("*")
    .eq("cycle_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const questions = (questionData as ReviewQuestion[] | null) ?? [];
  const preQuestions = questions.filter((q) => q.stage === "pre");
  const fullQuestions = questions.filter((q) => q.stage === "full");

  const { data: requirementData } = await supabase
    .from("document_requirements")
    .select("*")
    .eq("cycle_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const requirements = (requirementData as DocumentRequirement[] | null) ?? [];

  const { data: otherData } = await supabase
    .from("cycles")
    .select("id, name, year")
    .neq("id", id)
    .order("year", { ascending: false });
  const otherCycles = (otherData as
    | { id: string; name: string; year: number }[]
    | null) ?? [];

  // Per-cycle stats. "Received" = submitted proposals; requested/awarded cover
  // the fundable types so a pre-proposal and its full aren't double-counted.
  const { data: statProposalData } = await supabase
    .from("proposals")
    .select("type, state, outcome, requested_amount, funded_amount")
    .eq("cycle_id", id);
  const statProposals =
    (statProposalData as
      | {
          type: string;
          state: string;
          outcome: string | null;
          requested_amount: number | string | null;
          funded_amount: number | string | null;
        }[]
      | null) ?? [];

  const submittedOf = (type: string) =>
    statProposals.filter((p) => p.state === "submitted" && p.type === type)
      .length;
  const fundable = statProposals.filter(
    (p) => p.type === "full" || p.type === "continuation" || p.type === "off_cycle",
  );
  const proposalStats = {
    pre: submittedOf("pre"),
    full: submittedOf("full"),
    continuation: submittedOf("continuation"),
    offCycle: submittedOf("off_cycle"),
    funded: statProposals.filter((p) => p.outcome === "funded").length,
    totalRequested: fundable
      .filter((p) => p.state === "submitted")
      .reduce((s, p) => s + num(p.requested_amount), 0),
    totalAwarded: fundable
      .filter((p) => p.outcome === "funded")
      .reduce((s, p) => s + num(p.funded_amount), 0),
  };

  const { data: statReportData } = await supabase
    .from("reports")
    .select("state, due_date")
    .eq("cycle_id", id);
  const statReports =
    (statReportData as { state: string; due_date: string | null }[] | null) ?? [];
  const today = pacificDateToday();
  const reportStats = {
    pending: statReports.filter(
      (r) => r.state === "pending" || r.state === "reopened",
    ).length,
    submitted: statReports.filter((r) => r.state === "submitted").length,
    pastDue: statReports.filter(
      (r) =>
        (r.state === "pending" || r.state === "reopened") &&
        r.due_date != null &&
        r.due_date < today,
    ).length,
  };

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/manager/cycles"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Cycles
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/manager/cycles/${id}/proposals`}>Proposals</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/manager/cycles/${id}/allocation`}>Allocation</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/manager/cycles/${id}/reports`}>Reports</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/manager/cycles/${id}/report`}>Funding report</Link>
            </Button>
          </div>
        </div>

        {cycle.fiscal_year == null && (
          <div className="border border-destructive/40 bg-destructive/10 text-sm p-3 rounded-none">
            <span className="font-semibold">No fiscal year set.</span>{" "}
            Proposals can&apos;t be submitted and this cycle can&apos;t open for
            pre-proposals until you set a fiscal year (used for serial numbers).
            Set it in <span className="font-medium">Edit cycle</span> below.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Cycle Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Fiscal year: </span>
              {cycle.fiscal_year != null ? (
                <span className="num font-medium">{cycle.fiscal_year}</span>
              ) : (
                <span className="text-destructive font-medium">not set</span>
              )}
            </div>
            <CycleStatusControl cycleId={id} status={cycle.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Cycle stats</CardTitle>
          </CardHeader>
          <CardContent>
            <CycleStats
              cycleId={id}
              proposals={proposalStats}
              reports={reportStats}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">Edit cycle</CardTitle>
              <Badge variant="secondary">{statusLabel(cycle.status)}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <EditCycleForm cycle={cycle} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Review Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <QuestionSets
              cycleId={id}
              preQuestions={preQuestions}
              fullQuestions={fullQuestions}
              otherCycles={otherCycles}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Document Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentRequirements
              cycleId={id}
              requirements={requirements}
              otherCycles={otherCycles}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
