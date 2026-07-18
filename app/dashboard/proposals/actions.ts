"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("locked")) {
    return "This proposal is locked and can no longer be edited.";
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
 * Create a project + a clean draft pre-proposal together, then open its
 * workspace. Inserts must be clean drafts (the DB insert guards require
 * state='draft' and null outcome/funded_amount).
 */
export async function startPreProposal(input: {
  cycleId: string;
  projectTitle: string;
  plannedYears: number;
  requestedAmount: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const uid = await currentUserId(supabase);
  if (!uid) return { error: "You're not signed in." };

  const { data: cycle } = await supabase
    .from("cycles")
    .select("id, status")
    .eq("id", input.cycleId)
    .single();
  if (!cycle) return { error: "That cycle isn't available." };
  if (cycle.status !== "pre_proposal_open") {
    return { error: "This cycle is not open for pre-proposals." };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      researcher_id: uid,
      title: input.projectTitle,
      planned_years: input.plannedYears,
    })
    .select("id")
    .single();
  if (projectError) return { error: friendly(projectError.message) };

  const { data: proposal, error: proposalError } = await supabase
    .from("proposals")
    .insert({
      project_id: project.id,
      cycle_id: input.cycleId,
      researcher_id: uid,
      type: "pre",
      title: input.projectTitle,
      year_number: 1,
      requested_amount: input.requestedAmount,
    })
    .select("id")
    .single();
  if (proposalError) return { error: friendly(proposalError.message) };

  revalidatePath("/dashboard");
  redirect(`/dashboard/proposals/${proposal.id}`);
}

/** Edit draft/reopened content: proposal title + requested amount, project planned years. */
export async function updateProposal(
  proposalId: string,
  projectId: string,
  input: { title: string; requestedAmount: string | null; plannedYears: number },
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();

  const { error: proposalError } = await supabase
    .from("proposals")
    .update({ title: input.title, requested_amount: input.requestedAmount })
    .eq("id", proposalId);
  if (proposalError) return { error: friendly(proposalError.message) };

  const { error: projectError } = await supabase
    .from("projects")
    .update({ planned_years: input.plannedYears })
    .eq("id", projectId);
  if (projectError) return { error: friendly(projectError.message) };

  revalidatePath(`/dashboard/proposals/${proposalId}`);
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

/**
 * Snapshot the researcher's profile CV into the proposal folder (while still
 * editable, since storage writes require it), then flip state via the RPC.
 * All required pre-stage documents must be uploaded, and a profile CV must
 * exist.
 */
export async function submitPreProposal(
  proposalId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const uid = await currentUserId(supabase);
  if (!uid) return { error: "You're not signed in." };

  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, cycle_id, researcher_id, state")
    .eq("id", proposalId)
    .single();
  if (!proposal) return { error: "Proposal not found." };
  if (proposal.researcher_id !== uid) return { error: "This isn't your proposal." };
  if (proposal.state !== "draft" && proposal.state !== "reopened") {
    return { error: "This proposal can no longer be submitted." };
  }

  // Re-check required documents server-side.
  const { data: reqs } = await supabase
    .from("document_requirements")
    .select("id, is_required")
    .eq("cycle_id", proposal.cycle_id)
    .eq("stage", "pre")
    .eq("is_active", true);
  const requiredIds = (reqs ?? [])
    .filter((r) => r.is_required)
    .map((r) => r.id);
  const { data: docs } = await supabase
    .from("proposal_documents")
    .select("requirement_id")
    .eq("proposal_id", proposalId);
  const uploaded = new Set((docs ?? []).map((d) => d.requirement_id));
  const missing = requiredIds.filter((id) => !uploaded.has(id));
  if (missing.length > 0) {
    return {
      error: `Upload all required documents before submitting (${missing.length} still missing).`,
    };
  }

  // Snapshot CV (point-in-time record).
  const { data: profile } = await supabase
    .from("profiles")
    .select("cv_path")
    .eq("id", uid)
    .single();
  if (!profile?.cv_path) {
    return {
      error:
        "You need a CV on file before submitting. Upload one on your profile, then try again.",
    };
  }

  const { data: cvBlob, error: downloadError } = await supabase.storage
    .from("cvs")
    .download(profile.cv_path);
  if (downloadError || !cvBlob) {
    return {
      error: `Couldn't read your profile CV: ${downloadError?.message ?? "unknown error"}`,
    };
  }

  const snapshotPath = `${proposalId}/cv-snapshot.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("proposals")
    .upload(snapshotPath, cvBlob, {
      upsert: true,
      contentType: "application/pdf",
    });
  if (uploadError) {
    return { error: `Couldn't snapshot your CV: ${uploadError.message}` };
  }

  const { error: pathError } = await supabase
    .from("proposals")
    .update({ cv_snapshot_path: snapshotPath })
    .eq("id", proposalId);
  if (pathError) return { error: friendly(pathError.message) };

  const { error: rpcError } = await supabase.rpc("submit_proposal", {
    p_id: proposalId,
  });
  if (rpcError) return { error: friendly(rpcError.message) };

  revalidatePath(`/dashboard/proposals/${proposalId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Withdraw a proposal (preserves history) via the RPC. */
export async function rescindProposal(
  proposalId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rescind_proposal", { p_id: proposalId });
  if (error) return { error: friendly(error.message) };

  revalidatePath(`/dashboard/proposals/${proposalId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
