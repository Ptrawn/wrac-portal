"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { QuestionType, ReviewStage } from "@/lib/cycles";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type QuestionInput = {
  prompt: string;
  question_type: QuestionType;
  score_min: number;
  score_max: number;
};

/** Turn known DB constraint / RLS failures into human-readable messages. */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("review_questions_yes_no_min_zero")) {
    return "A yes/no question must start at 0 (a “no” is worth 0).";
  }
  if (m.includes("review_questions_score_range")) {
    return "Maximum score must be greater than minimum score.";
  }
  if (m.includes("row-level security") || m.includes("row level security")) {
    return "You don't have permission to do that.";
  }
  return message;
}

/**
 * A yes/no question pins score_min to 0 (the DB constraint requires it) and uses
 * score_max as the points a "yes" is worth.
 */
function normalize(input: QuestionInput): QuestionInput {
  return input.question_type === "yes_no"
    ? { ...input, score_min: 0 }
    : input;
}

/** How many answers with a real score already exist for this question. */
async function answeredCount(
  supabase: Supabase,
  questionId: string,
): Promise<number> {
  const { count } = await supabase
    .from("review_answers")
    .select("id", { count: "exact", head: true })
    .eq("question_id", questionId)
    .not("score", "is", null);
  return count ?? 0;
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
  rawInput: QuestionInput,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const input = normalize(rawInput);
  const sort_order = await nextSortOrder(supabase, cycleId, stage);
  const { error } = await supabase.from("review_questions").insert({
    cycle_id: cycleId,
    stage,
    prompt: input.prompt,
    question_type: input.question_type,
    score_min: input.score_min,
    score_max: input.score_max,
    sort_order,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

/**
 * Edit a question. GUARD: once a question has scored answers, its scoring shape
 * is frozen -- changing a yes/no question's "points for a yes" (score_max) would
 * leave every stored "yes" no longer equal to the max, so it would silently read
 * as "no" and every total would shift retroactively. Switching a question
 * between numeric and yes/no is blocked for the same reason. The prompt stays
 * editable (fixing wording is safe); to change the scoring, deactivate the
 * question and add a new one, which preserves the existing review history.
 */
export async function updateQuestion(
  id: string,
  cycleId: string,
  rawInput: QuestionInput,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const input = normalize(rawInput);

  const { data: current, error: readError } = await supabase
    .from("review_questions")
    .select("question_type, score_min, score_max")
    .eq("id", id)
    .single();
  if (readError) return { error: friendlyError(readError.message) };

  const scoringChanged =
    current.question_type !== input.question_type ||
    current.score_min !== input.score_min ||
    current.score_max !== input.score_max;

  if (scoringChanged) {
    const answered = await answeredCount(supabase, id);
    if (answered > 0) {
      return {
        error:
          current.question_type === "yes_no"
            ? `This yes/no question already has ${answered} scored answer${answered === 1 ? "" : "s"}. Changing what a “yes” is worth would silently turn those answers into “no” and change past totals. Remove this question and add a new one instead — the existing reviews stay intact.`
            : `This question already has ${answered} scored answer${answered === 1 ? "" : "s"}, so its scoring can't be changed. Remove it and add a new one instead — the existing reviews stay intact.`,
      };
    }
  }

  const { error } = await supabase
    .from("review_questions")
    .update({
      prompt: input.prompt,
      question_type: input.question_type,
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
    .select("stage, prompt, question_type, score_min, score_max, sort_order")
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
      question_type: q.question_type,
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
