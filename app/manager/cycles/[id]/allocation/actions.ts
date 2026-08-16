"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { stageForProposalType } from "@/lib/reviews";

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("row-level security") || m.includes("row level security")) {
    return "You don't have permission to do that.";
  }
  return message;
}

function revalidate(cycleId: string): void {
  revalidatePath(`/manager/cycles/${cycleId}/allocation`);
  revalidatePath(`/manager/cycles/${cycleId}/proposals`);
}

export async function setFundingDecision(
  cycleId: string,
  proposalId: string,
  funded: boolean,
  amount: number | null,
  // Portion of the award covered by the WSU ARC fund. Ignored/forced null by
  // the RPC for non-WSU proposals; the RPC raises if it exceeds the ARC-eligible
  // ceiling or the funded amount. Defaults to 0 (no ARC) when omitted.
  arcAmount: number | null = 0,
  // Manager's reasoning for the decision -- especially why an award came in
  // below the request. Stored when funding, nulled when not funded.
  fundingNote: string | null = null,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_funding_decision", {
    p_id: proposalId,
    p_funded: funded,
    p_amount: amount,
    p_arc_amount: arcAmount ?? 0,
    p_funding_note: fundingNote,
  });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId);
  return { ok: true };
}

/**
 * Set (or clear) the cycle's WSU ARC fund total. Editable any time before
 * funding is finalised. Pass null to unset it (ARC tally then reads "not
 * configured"). Manager RLS on cycles permits this update.
 */
export async function setArcFundTotal(
  cycleId: string,
  total: number | null,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cycles")
    .update({ arc_fund_total: total })
    .eq("id", cycleId);
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId);
  return { ok: true };
}

export async function clearFundingDecision(
  cycleId: string,
  proposalId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_funding_decision", {
    p_id: proposalId,
  });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId);
  return { ok: true };
}

export type CommentReview = {
  reviewerName: string;
  state: string | null;
  total: number;
  answers: {
    prompt: string;
    score: number | null;
    comment: string | null;
    min: number;
    max: number;
  }[];
};

/**
 * Load every reviewer's comments for a proposal (manager reads all via RLS).
 * Called lazily when the comments modal opens.
 */
export async function getProposalReviews(
  proposalId: string,
): Promise<{ error?: string; reviews?: CommentReview[] }> {
  const supabase = await createClient();

  const { data: proposal, error: propError } = await supabase
    .from("proposals")
    .select("cycle_id, type")
    .eq("id", proposalId)
    .single();
  if (propError || !proposal) {
    return { error: "Proposal not available." };
  }

  const stage = stageForProposalType(proposal.type);
  const { data: questionData } = await supabase
    .from("review_questions")
    .select("id, prompt, score_min, score_max")
    .eq("cycle_id", proposal.cycle_id)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const questions =
    (questionData as {
      id: string;
      prompt: string;
      score_min: number;
      score_max: number;
    }[] | null) ?? [];

  const { data: memberData } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "committee")
    .order("full_name", { ascending: true });
  const members =
    (memberData as { id: string; full_name: string | null }[] | null) ?? [];

  const { data: reviewData } = await supabase
    .from("reviews")
    .select(
      "reviewer_id, state, review_answers(question_id, score, comment)",
    )
    .eq("proposal_id", proposalId);
  const reviews =
    (reviewData as {
      reviewer_id: string;
      state: string;
      review_answers: {
        question_id: string;
        score: number | null;
        comment: string | null;
      }[];
    }[] | null) ?? [];
  const byReviewer = new Map(reviews.map((r) => [r.reviewer_id, r]));

  const result: CommentReview[] = members.map((member) => {
    const review = byReviewer.get(member.id) ?? null;
    const answers = new Map(
      (review?.review_answers ?? []).map((a) => [a.question_id, a]),
    );
    const total = (review?.review_answers ?? []).reduce(
      (sum, a) => sum + (a.score ?? 0),
      0,
    );
    return {
      reviewerName: member.full_name ?? "(no name)",
      state: review?.state ?? null,
      total,
      answers: questions.map((q) => {
        const a = answers.get(q.id);
        return {
          prompt: q.prompt,
          score: a?.score ?? null,
          comment: a?.comment ?? null,
          min: q.score_min,
          max: q.score_max,
        };
      }),
    };
  });

  return { reviews: result };
}
