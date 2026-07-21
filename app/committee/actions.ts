"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { stageForProposalType } from "@/lib/reviews";

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("locked")) {
    return "This review is locked and can no longer be edited.";
  }
  if (m.includes("row-level security") || m.includes("row level security")) {
    return "You don't have permission to do that.";
  }
  return message;
}

async function currentUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}

/**
 * Idempotently create the caller's review for a proposal. The unique
 * (proposal_id, reviewer_id) constraint protects against races; a conflict is
 * treated as success. Stage is derived from the proposal type.
 */
export async function ensureReview(
  proposalId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const uid = await currentUserId(supabase);
  if (!uid) return { error: "You're not signed in." };

  const { data: existing } = await supabase
    .from("reviews")
    .select("id")
    .eq("proposal_id", proposalId)
    .eq("reviewer_id", uid)
    .maybeSingle();
  if (existing) return { ok: true };

  const { data: proposal } = await supabase
    .from("proposals")
    .select("type")
    .eq("id", proposalId)
    .single();
  if (!proposal) return { error: "This proposal isn't available to review." };

  const { error } = await supabase.from("reviews").insert({
    proposal_id: proposalId,
    reviewer_id: uid,
    stage: stageForProposalType(proposal.type),
  });
  if (error) {
    // A concurrent create hit the unique constraint -- that's fine.
    if (/duplicate|unique/i.test(error.message)) return { ok: true };
    return { error: friendly(error.message) };
  }

  revalidatePath(`/committee/proposals/${proposalId}`);
  revalidatePath("/committee");
  return { ok: true };
}

/** Upsert the caller's answers (save progress without submitting). */
export async function saveReviewAnswers(
  reviewId: string,
  proposalId: string,
  answers: { questionId: string; score: number | null; comment: string | null }[],
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const rows = answers.map((a) => ({
    review_id: reviewId,
    question_id: a.questionId,
    score: a.score,
    comment: a.comment,
  }));
  const { error } = await supabase
    .from("review_answers")
    .upsert(rows, { onConflict: "review_id,question_id" });
  if (error) return { error: friendly(error.message) };

  revalidatePath(`/committee/proposals/${proposalId}`);
  revalidatePath("/committee");
  return { ok: true };
}

/** Submit the review via the RPC (requires every active question scored). */
export async function submitReview(
  reviewId: string,
  proposalId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_review", { r_id: reviewId });
  if (error) return { error: friendly(error.message) };

  revalidatePath(`/committee/proposals/${proposalId}`);
  revalidatePath("/committee");
  return { ok: true };
}

/** Short-lived signed URL for a file in the private 'proposals' bucket. */
export async function getProposalFileUrl(
  path: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("proposals")
    .createSignedUrl(path, 60);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
