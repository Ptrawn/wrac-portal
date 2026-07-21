"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("row-level security") || m.includes("row level security")) {
    return "You don't have permission to do that.";
  }
  return message;
}

function revalidate(cycleId: string, proposalId: string): void {
  revalidatePath(`/manager/cycles/${cycleId}/proposals`);
  revalidatePath(`/manager/cycles/${cycleId}/proposals/${proposalId}`);
  // A researcher-facing draft/edit may result from these actions.
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/proposals/${proposalId}`);
}

export async function setProposalOutcome(
  cycleId: string,
  proposalId: string,
  outcome: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_proposal_outcome", {
    p_id: proposalId,
    p_outcome: outcome,
  });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId, proposalId);
  return { ok: true };
}

export async function inviteFullProposal(
  cycleId: string,
  proposalId: string,
): Promise<{ error?: string; newProposalId?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_full_proposal", {
    p_pre_proposal_id: proposalId,
  });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId, proposalId);
  return { newProposalId: data as string };
}

export async function reopenProposalAction(
  cycleId: string,
  proposalId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_proposal", { p_id: proposalId });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId, proposalId);
  return { ok: true };
}

export async function reopenReviewAction(
  cycleId: string,
  proposalId: string,
  reviewId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_review", { r_id: reviewId });
  if (error) return { error: friendly(error.message) };
  revalidate(cycleId, proposalId);
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
