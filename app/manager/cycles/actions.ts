"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { CYCLE_STATUS_SEQUENCE, type Cycle, type CycleStatus } from "@/lib/cycles";

export type CycleInput = {
  name: string;
  year: number;
  total_budget: string | null;
  pre_proposal_opens_at: string | null;
  pre_proposal_closes_at: string | null;
  pre_review_due_at: string | null;
  full_proposal_due_at: string | null;
  full_review_due_at: string | null;
  default_status_report_due_at: string | null;
  default_final_report_due_at: string | null;
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
      default_status_report_due_at: input.default_status_report_due_at,
      default_final_report_due_at: input.default_final_report_due_at,
    })
    .eq("id", id);

  if (error) return { error: friendlyError(error.message) };

  revalidatePath(`/manager/cycles/${id}`);
  revalidatePath("/manager/cycles");
  return { ok: true };
}

/**
 * Field prerequisites for entering a given status. Returns a friendly message
 * naming what's missing, or null if the cycle may advance to `target`.
 */
function advanceBlockedReason(target: CycleStatus, cycle: Cycle): string | null {
  switch (target) {
    case "pre_proposal_open":
      if (!cycle.pre_proposal_opens_at || !cycle.pre_proposal_closes_at) {
        return "Set the pre-proposal open and close dates before opening pre-proposals.";
      }
      return null;
    case "pre_review":
      if (!cycle.pre_review_due_at) {
        return "Set the pre-review due date before moving to pre-review.";
      }
      return null;
    case "full_proposal_open":
      if (!cycle.full_proposal_due_at) {
        return "Set the full-proposal due date before opening full proposals.";
      }
      return null;
    case "full_review":
      if (!cycle.full_review_due_at) {
        return "Set the full-review due date before moving to full review.";
      }
      return null;
    case "deliberation":
      if (cycle.total_budget === null || cycle.total_budget === "") {
        return "Set the total budget before deliberation — the committee can't allocate against an unknown pool.";
      }
      return null;
    default:
      return null; // advance_decision, funding_decisions, closed: no field requirement
  }
}

/**
 * Advance or move a cycle back by exactly one step. The target is validated
 * server-side against the CURRENT status (must be the adjacent status), so a
 * value posted from the client can't skip or jump states.
 */
export async function setCycleStatus(
  id: string,
  target: string,
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();

  const { data, error: fetchError } = await supabase
    .from("cycles")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError || !data) return { error: "Cycle not found." };
  const cycle = data as Cycle;

  const currentIdx = CYCLE_STATUS_SEQUENCE.indexOf(cycle.status);
  const targetIdx = CYCLE_STATUS_SEQUENCE.indexOf(target as CycleStatus);
  if (currentIdx === -1 || targetIdx === -1) {
    return { error: "Unknown cycle status." };
  }

  // Only the immediately adjacent status (one step forward or back) is allowed.
  if (targetIdx !== currentIdx + 1 && targetIdx !== currentIdx - 1) {
    return { error: "That isn't a valid next or previous status for this cycle." };
  }

  // Field prerequisites apply only when advancing.
  if (targetIdx === currentIdx + 1) {
    const blocked = advanceBlockedReason(target as CycleStatus, cycle);
    if (blocked) return { error: blocked };
  }

  const { error } = await supabase
    .from("cycles")
    .update({ status: target })
    .eq("id", id);
  if (error) return { error: friendlyError(error.message) };

  revalidatePath(`/manager/cycles/${id}`);
  revalidatePath("/manager/cycles");
  return { ok: true };
}
