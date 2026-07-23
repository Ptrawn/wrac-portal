import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedResearcher } from "@/lib/auth/profile";
import {
  cycleStagePhrase,
  formatLongDate,
  pacificDateToday,
} from "@/lib/cycles";
import type { DocumentRequirement } from "@/lib/cycles";
import {
  computeSubmissionEligibility,
  isProposalEditable,
  proposalStateLabel,
  proposalTypeLabel,
  type Project,
  type Proposal,
  type ProposalDocument,
} from "@/lib/proposals";
import { stageForProposalType, type PlanContextRow } from "@/lib/reviews";
import { ProposalWorkspace } from "./workspace";

type BudgetYear = { year_number: number; planned_amount: number | string };

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email, userId } = await requireApprovedResearcher();
  const { id } = await params;

  const supabase = await createClient();

  // RLS restricts this to the owner; a non-owner (or missing) id yields null.
  const { data: proposalData } = await supabase
    .from("proposals")
    .select("*")
    .eq("id", id)
    .single();

  if (!proposalData || (proposalData as Proposal).researcher_id !== userId) {
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
              <CardTitle className="text-xl">Proposal not found</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This proposal doesn&apos;t exist or isn&apos;t yours.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const proposal = proposalData as Proposal;

  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("id", proposal.project_id)
    .single();
  const project = projectData as Project | null;

  const stage = stageForProposalType(proposal.type);

  const { data: cycleData } = await supabase
    .from("cycles")
    .select(
      "id, name, year, status, pre_proposal_closes_at, full_proposal_due_at",
    )
    .eq("id", proposal.cycle_id)
    .single();
  const deadline =
    stage === "pre"
      ? (cycleData?.pre_proposal_closes_at ?? null)
      : (cycleData?.full_proposal_due_at ?? null);

  // Client-visible mirror of submit_proposal's stage + deadline enforcement.
  const eligibility = computeSubmissionEligibility({
    type: proposal.type,
    cycleStatus: cycleData?.status ?? "setup",
    preProposalClosesAt: cycleData?.pre_proposal_closes_at ?? null,
    fullProposalDueAt: cycleData?.full_proposal_due_at ?? null,
    lateSubmissionAllowed: proposal.late_submission_allowed,
    stagePhrase: cycleStagePhrase,
    formatLongDate,
    pacificToday: pacificDateToday(),
  });

  const { data: requirementData } = await supabase
    .from("document_requirements")
    .select("*")
    .eq("cycle_id", proposal.cycle_id)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const requirements = (requirementData as DocumentRequirement[] | null) ?? [];

  const { data: documentData } = await supabase
    .from("proposal_documents")
    .select("*")
    .eq("proposal_id", id);
  const documents = (documentData as ProposalDocument[] | null) ?? [];

  const { data: budgetData } = await supabase
    .from("proposal_budget_years")
    .select("year_number, planned_amount")
    .eq("proposal_id", id)
    .order("year_number", { ascending: true });
  const budgetYears = (budgetData as BudgetYear[] | null) ?? [];

  let parent: { id: string; title: string } | null = null;
  if (proposal.parent_proposal_id) {
    const { data: parentData } = await supabase
      .from("proposals")
      .select("id, title")
      .eq("id", proposal.parent_proposal_id)
      .maybeSingle();
    parent = (parentData as { id: string; title: string } | null) ?? null;
  }

  // Continuation context: the ORIGINAL multi-year plan to compare the new ask
  // against. Zero rows for anything without a parent.
  const isContinuation = proposal.type === "continuation";
  let continuation: {
    yearNumber: number;
    projectedThisYear: string | null;
    originalPlan: {
      year_number: number;
      planned_amount: string;
      source_cycle_name: string;
    }[];
    parentId: string | null;
    parentTitle: string | null;
  } | null = null;
  if (isContinuation) {
    const { data: planData } = await supabase.rpc("proposal_plan_context", {
      p_id: id,
    });
    const planRows = (planData as PlanContextRow[] | null) ?? [];
    const thisYear = planRows.find(
      (r) => r.year_number === proposal.year_number,
    );
    continuation = {
      yearNumber: proposal.year_number,
      projectedThisYear:
        thisYear?.planned_amount == null
          ? null
          : String(thisYear.planned_amount),
      originalPlan: planRows.map((r) => ({
        year_number: r.year_number,
        planned_amount:
          r.planned_amount == null ? "" : String(r.planned_amount),
        source_cycle_name: r.source_cycle_name,
      })),
      parentId: parent?.id ?? null,
      parentTitle: parent?.title ?? null,
    };
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("cv_path")
    .eq("id", userId)
    .single();
  const hasCv = Boolean((profileData as { cv_path: string | null } | null)?.cv_path);

  const editable = isProposalEditable(proposal.state);

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
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">{proposal.title}</CardTitle>
              <Badge variant="secondary">
                {proposalStateLabel(proposal.state)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {cycleData
                ? `${cycleData.name} (${cycleData.year})`
                : "Cycle unavailable"}{" "}
              · {proposalTypeLabel(proposal.type)} · Deadline{" "}
              {formatLongDate(deadline)}
            </p>
            {parent && (
              <p className="text-sm mt-1">
                <Link
                  href={`/dashboard/proposals/${parent.id}`}
                  className="underline underline-offset-4"
                >
                  {isContinuation
                    ? `View the funded proposal you're continuing (${parent.title})`
                    : `View your original pre-proposal (${parent.title})`}
                </Link>
              </p>
            )}
          </CardHeader>
          <CardContent>
            <ProposalWorkspace
              proposalId={proposal.id}
              projectId={proposal.project_id}
              type={proposal.type}
              state={proposal.state}
              editable={editable}
              hasCv={hasCv}
              submission={{
                canSubmit: eligibility.canSubmit,
                blockedReason: eligibility.blockedReason,
                message: eligibility.message,
                overrideActive: eligibility.overrideActive,
                deadlineLong: eligibility.deadline
                  ? formatLongDate(eligibility.deadline)
                  : null,
              }}
              initialTitle={proposal.title}
              initialAmount={
                proposal.requested_amount == null
                  ? ""
                  : String(proposal.requested_amount)
              }
              initialPlannedYears={String(project?.planned_years ?? 1)}
              requirements={requirements}
              documents={documents}
              budgetYears={budgetYears.map((b) => ({
                year_number: b.year_number,
                planned_amount:
                  b.planned_amount == null ? "" : String(b.planned_amount),
              }))}
              projectStatus={project?.status ?? "proposed"}
              continuation={continuation}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
