"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type CycleInput = {
  name: string;
  year: number;
  total_budget: string | null;
  pre_proposal_opens_at: string | null;
  pre_proposal_closes_at: string | null;
  pre_review_due_at: string | null;
  full_proposal_due_at: string | null;
  full_review_due_at: string | null;
};

/** Turn known DB constraint failures into human-readable messages. */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("cycles_pre_close_after_open")) {
    return "Pre-proposal close date must be on or after the open date.";
  }
  if (m.includes("cycles_pre_review_after_pre_close")) {
    return "Pre-review due date must be on or after the pre-proposal close date.";
  }
  if (m.includes("cycles_full_due_after_pre_close")) {
    return "Full-proposal due date must be on or after the pre-proposal close date.";
  }
  if (m.includes("cycles_full_review_after_full_due")) {
    return "Full-review due date must be on or after the full-proposal due date.";
  }
  if (m.includes("total_budget")) {
    return "Total budget must be zero or greater.";
  }
  if (m.includes("row-level security") || m.includes("row level security")) {
    return "You don't have permission to do that.";
  }
  return message;
}

export async function createCycle(input: {
  name: string;
  year: number;
  total_budget: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cycles")
    .insert({
      name: input.name,
      year: input.year,
      total_budget: input.total_budget,
    })
    .select("id")
    .single();

  if (error) return { error: friendlyError(error.message) };

  revalidatePath("/manager/cycles");
  redirect(`/manager/cycles/${data.id}`);
}

export async function updateCycle(
  id: string,
  input: CycleInput,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cycles")
    .update({
      name: input.name,
      year: input.year,
      total_budget: input.total_budget,
      pre_proposal_opens_at: input.pre_proposal_opens_at,
      pre_proposal_closes_at: input.pre_proposal_closes_at,
      pre_review_due_at: input.pre_review_due_at,
      full_proposal_due_at: input.full_proposal_due_at,
      full_review_due_at: input.full_review_due_at,
    })
    .eq("id", id);

  if (error) return { error: friendlyError(error.message) };

  revalidatePath(`/manager/cycles/${id}`);
  revalidatePath("/manager/cycles");
  return { ok: true };
}
