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
import { requireManager } from "@/lib/auth/profile";
import { formatBudget, type ReviewQuestion } from "@/lib/cycles";
import {
  proposalStateLabel,
  proposalTypeLabel,
  type ProposalDocument,
} from "@/lib/proposals";
import {
  outcomeLabel,
  reviewStatusLabel,
  stageForProposalType,
} from "@/lib/reviews";
import { ProjectReportingHistory } from "@/components/reporting-history";
import { loadProjectReportingHistory } from "@/lib/reports";
import { ProposalDecisions } from "./proposal-decisions";
import { ManagerDocs } from "./manager-docs";
import { ReopenReviewButton } from "./reopen-review-button";
import { LateSubmissionControl } from "./late-submission-control";

type DetailProposal = {
  id: string;
  title: string;
  type: string;
  state: string;
  outcome: string | null;
  cycle_id: string;
  project_id: string;
  year_number: number;
  requested_amount: number | string | null;
  funded_amount: number | string | null;
  parent_proposal_id: string | null;
  cv_snapshot_path: string | null;
  late_submission_allowed: boolean;
  researcher: { full_name: string | null; institution: string | null } | null;
  project: { title: string; planned_years: number } | null;
  cycle: { name: string; year: number } | null;
};

type BudgetYear = { year_number: number; planned_amount: number | string };
type Member = { id: string; full_name: string | null };
type ReviewRow = {
  id: string;
  reviewer_id: string;
  state: string;
  submitted_at: string | null;
  review_answers: { question_id: string; score: number | null; comment: string | null }[];
};

export default async function ManagerProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string; proposalId: string }>;
}) {
  const { email } = await requireManager();
  const { id: cycleId, proposalId } = await params;

  const supabase = await createClient();

  const { data: proposalData } = await supabase
    .from("proposals")
    .select(
      "id, title, type, state, outcome, cycle_id, project_id, year_number, requested_amount, funded_amount, parent_proposal_id, cv_snapshot_path, late_submission_allowed, researcher:profiles!researcher_id(full_name, institution), project:projects(title, planned_years), cycle:cycles(name, year)",
    )
    .eq("id", proposalId)
    .maybeSingle();

  if (!proposalData) {
    return (
      <main className="min-h-screen flex flex-col items-center">
        <AppHeader email={email} />
        <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
          <Link
            href={`/manager/cycles/${cycleId}/proposals`}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Proposals
          </Link>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Proposal not found</CardTitle>
            </CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  const proposal = proposalData as unknown as DetailProposal;
  const stage = stageForProposalType(proposal.type);

  const { data: budgetData } = await supabase
    .from("proposal_budget_years")
    .select("year_number, planned_amount")
    .eq("proposal_id", proposalId)
    .order("year_number", { ascending: true });
  const budgetYears = (budgetData as BudgetYear[] | null) ?? [];

  const { data: documentData } = await supabase
    .from("proposal_documents")
    .select("*")
    .eq("proposal_id", proposalId);
  const documents = (documentData as ProposalDocument[] | null) ?? [];

  const { data: questionData } = await supabase
    .from("review_questions")
    .select("*")
    .eq("cycle_id", proposal.cycle_id)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const questions = (questionData as ReviewQuestion[] | null) ?? [];

  const { data: memberData } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "committee")
    .order("full_name", { ascending: true });
  const members = (memberData as Member[] | null) ?? [];

  const { data: reviewData } = await supabase
    .from("reviews")
    .select(
      "id, reviewer_id, state, submitted_at, review_answers(question_id, score, comment)",
    )
    .eq("proposal_id", proposalId);
  const reviews = (reviewData as ReviewRow[] | null) ?? [];
  const reviewByReviewer = new Map<string, ReviewRow>(
    reviews.map((r) => [r.reviewer_id, r]),
  );

  // Child full proposal (if invited) for the "already created" link + gating.
  const { data: childData } = await supabase
    .from("proposals")
    .select("id")
    .eq("parent_proposal_id", proposalId)
    .maybeSingle();
  const childId = (childData as { id: string } | null)?.id ?? null;

  let parent: { id: string; title: string } | null = null;
  if (proposal.parent_proposal_id) {
    const { data: parentData } = await supabase
      .from("proposals")
      .select("id, title")
      .eq("id", proposal.parent_proposal_id)
      .maybeSingle();
    parent = (parentData as { id: string; title: string } | null) ?? null;
  }

  // Full reporting history for the project (all years), for deliberation context.
  const reportHistory = await loadProjectReportingHistory(proposal.project_id);

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Link
          href={`/manager/cycles/${cycleId}/proposals`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Proposals
        </Link>

        {/* Context */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">{proposal.title}</CardTitle>
              <div className="flex items-center gap-2 shrink-0">
                {proposal.outcome && (
                  <Badge>{outcomeLabel(proposal.outcome)}</Badge>
                )}
                <Badge variant="secondary">
                  {proposalStateLabel(proposal.state)}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {proposal.researcher?.full_name ?? "Unknown researcher"}
              {proposal.researcher?.institution
                ? ` · ${proposal.researcher.institution}`
                : ""}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <span className="text-muted-foreground">Type</span>
              <span>{proposalTypeLabel(proposal.type)}</span>
              <span className="text-muted-foreground">Cycle</span>
              <span>
                {proposal.cycle
                  ? `${proposal.cycle.name} (${proposal.cycle.year})`
                  : "—"}
              </span>
              <span className="text-muted-foreground">Project year</span>
              <span>
                Year {proposal.year_number}
                {proposal.project
                  ? ` of ${proposal.project.planned_years} planned`
                  : ""}
              </span>
              <span className="text-muted-foreground">Requested amount</span>
              <span>{formatBudget(proposal.requested_amount)}</span>
              {proposal.funded_amount != null && (
                <>
                  <span className="text-muted-foreground">Funded amount</span>
                  <span>{formatBudget(proposal.funded_amount)}</span>
                </>
              )}
            </div>

            {budgetYears.length > 0 && (
              <div className="text-sm">
                <div className="font-medium mb-1">Multi-year plan</div>
                <ul className="flex flex-col gap-0.5">
                  {budgetYears.map((b) => (
                    <li
                      key={b.year_number}
                      className="grid grid-cols-[6rem_1fr] text-muted-foreground"
                    >
                      <span>Year {b.year_number}</span>
                      <span>{formatBudget(b.planned_amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ManagerDocs
              documents={documents.map((d) => ({
                id: d.id,
                file_name: d.file_name,
                file_path: d.file_path,
              }))}
              cvSnapshotPath={proposal.cv_snapshot_path}
            />

            {parent && (
              <Link
                href={`/manager/cycles/${cycleId}/proposals/${parent.id}`}
                className="text-sm underline underline-offset-4"
              >
                View the original application ({parent.title})
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Project reporting history (all years) */}
        <ProjectReportingHistory reports={reportHistory} />

        {/* Submission window (stage/deadline override) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Submission window</CardTitle>
          </CardHeader>
          <CardContent>
            <LateSubmissionControl
              cycleId={cycleId}
              proposalId={proposal.id}
              allowed={proposal.late_submission_allowed}
              isOffCycle={proposal.type === "off_cycle"}
            />
          </CardContent>
        </Card>

        {/* Decisions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Decision</CardTitle>
          </CardHeader>
          <CardContent>
            <ProposalDecisions
              cycleId={cycleId}
              proposalId={proposal.id}
              type={proposal.type}
              state={proposal.state}
              outcome={proposal.outcome}
              hasFullProposal={Boolean(childId)}
              childId={childId}
            />
          </CardContent>
        </Card>

        {/* Reviews (manager sees all reviewers) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Committee reviews</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No committee members yet.
              </p>
            ) : (
              members.map((member) => {
                const review = reviewByReviewer.get(member.id) ?? null;
                const answers = new Map(
                  (review?.review_answers ?? []).map((a) => [a.question_id, a]),
                );
                const total = (review?.review_answers ?? []).reduce(
                  (sum, a) => sum + (a.score ?? 0),
                  0,
                );
                return (
                  <div
                    key={member.id}
                    className="border rounded-md p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-sm">
                        {member.full_name ?? "(no name)"}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary">
                          {reviewStatusLabel(review?.state)}
                        </Badge>
                        {review?.state === "submitted" && (
                          <ReopenReviewButton
                            cycleId={cycleId}
                            proposalId={proposal.id}
                            reviewId={review.id}
                          />
                        )}
                      </div>
                    </div>
                    {!review ? (
                      <p className="text-sm text-muted-foreground">
                        This reviewer hasn&apos;t started.
                      </p>
                    ) : (
                      <>
                        <ul className="flex flex-col gap-2 text-sm">
                          {questions.map((q) => {
                            const a = answers.get(q.id);
                            return (
                              <li key={q.id} className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">
                                  {q.prompt}
                                </span>
                                <span>
                                  Score: {a?.score ?? "—"}{" "}
                                  <span className="text-muted-foreground">
                                    ({q.score_min}–{q.score_max})
                                  </span>
                                </span>
                                {a?.comment && (
                                  <span className="whitespace-pre-wrap">
                                    {a.comment}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        <p className="text-sm">
                          Reviewer total: {total}
                          {review.submitted_at
                            ? ` · submitted ${review.submitted_at.slice(0, 10)}`
                            : ""}
                        </p>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
