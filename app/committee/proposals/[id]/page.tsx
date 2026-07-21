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
import { requireCommittee } from "@/lib/auth/profile";
import { formatBudget, formatDate, type ReviewQuestion } from "@/lib/cycles";
import { proposalTypeLabel, type ProposalDocument } from "@/lib/proposals";
import {
  isReviewEditable,
  stageForProposalType,
  type Review,
  type ReviewAnswer,
} from "@/lib/reviews";
import { ProposalContextDocs } from "./context-docs";
import { ReviewForm } from "./review-form";

type WorkspaceProposal = {
  id: string;
  title: string;
  type: string;
  cycle_id: string;
  year_number: number;
  requested_amount: number | string | null;
  parent_proposal_id: string | null;
  cv_snapshot_path: string | null;
  cycle: { name: string; year: number; status: string } | null;
  researcher: { full_name: string | null; institution: string | null } | null;
  project: { title: string; planned_years: number } | null;
};

type BudgetYear = { year_number: number; planned_amount: number | string };

export default async function ReviewWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email, userId } = await requireCommittee();
  const { id } = await params;

  const supabase = await createClient();

  const { data: proposalData } = await supabase
    .from("proposals")
    .select(
      "id, title, type, cycle_id, year_number, requested_amount, parent_proposal_id, cv_snapshot_path, cycle:cycles(name, year, status), researcher:profiles!researcher_id(full_name, institution), project:projects(title, planned_years)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!proposalData) {
    return (
      <main className="min-h-screen flex flex-col items-center">
        <AppHeader email={email} />
        <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
          <Link
            href="/committee"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Review queue
          </Link>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                Proposal not available
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This proposal doesn&apos;t exist, isn&apos;t submitted, or
                isn&apos;t in a cycle you can review.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  // Supabase types infer to-one embeds as arrays; at runtime they're objects.
  const proposal = proposalData as unknown as WorkspaceProposal;
  const stage = stageForProposalType(proposal.type);

  const { data: questionData } = await supabase
    .from("review_questions")
    .select("*")
    .eq("cycle_id", proposal.cycle_id)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const questions = (questionData as ReviewQuestion[] | null) ?? [];

  const { data: reviewData } = await supabase
    .from("reviews")
    .select("*")
    .eq("proposal_id", id)
    .eq("reviewer_id", userId)
    .maybeSingle();
  const review = (reviewData as Review | null) ?? null;

  let answers: ReviewAnswer[] = [];
  if (review) {
    const { data: answerData } = await supabase
      .from("review_answers")
      .select("*")
      .eq("review_id", review.id);
    answers = (answerData as ReviewAnswer[] | null) ?? [];
  }

  const { data: budgetData } = await supabase
    .from("proposal_budget_years")
    .select("year_number, planned_amount")
    .eq("proposal_id", id)
    .order("year_number", { ascending: true });
  const budgetYears = (budgetData as BudgetYear[] | null) ?? [];

  const { data: documentData } = await supabase
    .from("proposal_documents")
    .select("*")
    .eq("proposal_id", id);
  const documents = (documentData as ProposalDocument[] | null) ?? [];

  // Parent link only if the parent is also visible to this member.
  let parent: { id: string; title: string } | null = null;
  if (proposal.parent_proposal_id) {
    const { data: parentData } = await supabase
      .from("proposals")
      .select("id, title")
      .eq("id", proposal.parent_proposal_id)
      .maybeSingle();
    parent = (parentData as { id: string; title: string } | null) ?? null;
  }

  const editable = isReviewEditable(review?.state);

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Link
          href="/committee"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Review queue
        </Link>

        {/* Proposal context (read-only) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">{proposal.title}</CardTitle>
              <Badge variant="secondary">
                {proposalTypeLabel(proposal.type)}
              </Badge>
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

            <ProposalContextDocs
              documents={documents.map((d) => ({
                id: d.id,
                file_name: d.file_name,
                file_path: d.file_path,
              }))}
              cvSnapshotPath={proposal.cv_snapshot_path}
            />

            {proposal.parent_proposal_id && parent && (
              <Link
                href={`/committee/proposals/${parent.id}`}
                className="text-sm underline underline-offset-4"
              >
                View the original application ({parent.title})
              </Link>
            )}
          </CardContent>
        </Card>

        {/* My review */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">My review</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewForm
              proposalId={proposal.id}
              stage={stage}
              reviewId={review?.id ?? null}
              reviewState={review?.state ?? null}
              submittedAt={review?.submitted_at ?? null}
              editable={editable}
              questions={questions.map((q) => ({
                id: q.id,
                prompt: q.prompt,
                score_min: q.score_min,
                score_max: q.score_max,
              }))}
              initialAnswers={answers.map((a) => ({
                question_id: a.question_id,
                score: a.score,
                comment: a.comment,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
