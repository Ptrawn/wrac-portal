"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { ReviewStage } from "@/lib/cycles";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type QuestionInput = {
  prompt: string;
  score_min: number;
  score_max: number;
};

/** Turn known DB constraint / RLS failures into human-readable messages. */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("review_questions_score_range")) {
    return "Maximum score must be greater than minimum score.";
  }
  if (m.includes("row-level security") || m.includes("row level security")) {
    return "You don't have permission to do that.";
  }
  return message;
}

/** Next sort_order = (max active sort_order in this cycle+stage) + 1, else 0. */
async function nextSortOrder(
  supabase: Supabase,
  cycleId: string,
  stage: ReviewStage,
): Promise<number> {
  const { data } = await supabase
    .from("review_questions")
    .select("sort_order")
    .eq("cycle_id", cycleId)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? data.sort_order + 1 : 0;
}

export async function addQuestion(
  cycleId: string,
  stage: ReviewStage,
  input: QuestionInput,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sort_order = await nextSortOrder(supabase, cycleId, stage);
  const { error } = await supabase.from("review_questions").insert({
    cycle_id: cycleId,
    stage,
    prompt: input.prompt,
    score_min: input.score_min,
    score_max: input.score_max,
    sort_order,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

export async function updateQuestion(
  id: string,
  cycleId: string,
  input: QuestionInput,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("review_questions")
    .update({
      prompt: input.prompt,
      score_min: input.score_min,
      score_max: input.score_max,
    })
    .eq("id", id);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

/** Swap this question's sort_order with the adjacent active one in its stage. */
export async function moveQuestion(
  id: string,
  cycleId: string,
  stage: ReviewStage,
  direction: "up" | "down",
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_questions")
    .select("id, sort_order")
    .eq("cycle_id", cycleId)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) return { error: friendlyError(error.message) };

  const list = data ?? [];
  const idx = list.findIndex((q) => q.id === id);
  if (idx === -1) return {};
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return {}; // already at edge

  const a = list[idx];
  const b = list[swapIdx];
  const { error: e1 } = await supabase
    .from("review_questions")
    .update({ sort_order: b.sort_order })
    .eq("id", a.id);
  if (e1) return { error: friendlyError(e1.message) };
  const { error: e2 } = await supabase
    .from("review_questions")
    .update({ sort_order: a.sort_order })
    .eq("id", b.id);
  if (e2) return { error: friendlyError(e2.message) };

  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

/** Soft-delete: deactivate rather than hard-delete so scoring history survives. */
export async function deactivateQuestion(
  id: string,
  cycleId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("review_questions")
    .update({ is_active: false })
    .eq("id", id);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

/** Copy another cycle's ACTIVE questions (both stages) into this cycle as new rows. */
export async function copyQuestionsFromCycle(
  targetCycleId: string,
  sourceCycleId: string,
): Promise<{ error?: string; copied?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_questions")
    .select("stage, prompt, score_min, score_max, sort_order")
    .eq("cycle_id", sourceCycleId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) return { error: friendlyError(error.message) };

  const source = data ?? [];
  if (source.length === 0) return { copied: 0 };

  // Append: start each stage's copied questions after the current max
  // sort_order for that stage in the destination, so nothing ties.
  const { data: existing, error: existingErr } = await supabase
    .from("review_questions")
    .select("stage, sort_order")
    .eq("cycle_id", targetCycleId)
    .eq("is_active", true);
  if (existingErr) return { error: friendlyError(existingErr.message) };

  const nextByStage = new Map<string, number>();
  for (const q of existing ?? []) {
    const current = nextByStage.get(q.stage) ?? -1;
    if (q.sort_order > current) nextByStage.set(q.stage, q.sort_order);
  }

  // source is already ordered by sort_order asc, preserving relative order.
  const rows = source.map((q) => {
    const next = (nextByStage.get(q.stage) ?? -1) + 1;
    nextByStage.set(q.stage, next);
    return {
      cycle_id: targetCycleId,
      stage: q.stage,
      prompt: q.prompt,
      score_min: q.score_min,
      score_max: q.score_max,
      sort_order: next,
      is_active: true,
    };
  });

  const { error: insErr } = await supabase
    .from("review_questions")
    .insert(rows);
  if (insErr) return { error: friendlyError(insErr.message) };

  revalidatePath(`/manager/cycles/${targetCycleId}`);
  return { copied: rows.length };
}
