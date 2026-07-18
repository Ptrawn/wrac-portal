"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { DocumentStage } from "@/lib/cycles";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type RequirementInput = {
  label: string;
  description: string | null;
  is_required: boolean;
  accepted_file_types: string;
};

/** Turn known DB constraint / RLS failures into human-readable messages. */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("document_requirements_stage_check") || m.includes("stage")) {
    return "Invalid stage.";
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
  stage: DocumentStage,
): Promise<number> {
  const { data } = await supabase
    .from("document_requirements")
    .select("sort_order")
    .eq("cycle_id", cycleId)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? data.sort_order + 1 : 0;
}

export async function addRequirement(
  cycleId: string,
  stage: DocumentStage,
  input: RequirementInput,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sort_order = await nextSortOrder(supabase, cycleId, stage);
  const { error } = await supabase.from("document_requirements").insert({
    cycle_id: cycleId,
    stage,
    label: input.label,
    description: input.description,
    is_required: input.is_required,
    accepted_file_types: input.accepted_file_types,
    sort_order,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

export async function updateRequirement(
  id: string,
  cycleId: string,
  input: RequirementInput,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_requirements")
    .update({
      label: input.label,
      description: input.description,
      is_required: input.is_required,
      accepted_file_types: input.accepted_file_types,
    })
    .eq("id", id);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

/** Swap this requirement's sort_order with the adjacent active one in its stage. */
export async function moveRequirement(
  id: string,
  cycleId: string,
  stage: DocumentStage,
  direction: "up" | "down",
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_requirements")
    .select("id, sort_order")
    .eq("cycle_id", cycleId)
    .eq("stage", stage)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) return { error: friendlyError(error.message) };

  const list = data ?? [];
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return {};
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return {}; // already at edge

  const a = list[idx];
  const b = list[swapIdx];
  const { error: e1 } = await supabase
    .from("document_requirements")
    .update({ sort_order: b.sort_order })
    .eq("id", a.id);
  if (e1) return { error: friendlyError(e1.message) };
  const { error: e2 } = await supabase
    .from("document_requirements")
    .update({ sort_order: a.sort_order })
    .eq("id", b.id);
  if (e2) return { error: friendlyError(e2.message) };

  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

/** Soft-delete: deactivate rather than hard-delete so submission history survives. */
export async function deactivateRequirement(
  id: string,
  cycleId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_requirements")
    .update({ is_active: false })
    .eq("id", id);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/manager/cycles/${cycleId}`);
  return {};
}

/** Copy another cycle's ACTIVE requirements (all stages) into this cycle as new rows. */
export async function copyRequirementsFromCycle(
  targetCycleId: string,
  sourceCycleId: string,
): Promise<{ error?: string; copied?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_requirements")
    .select("stage, label, description, is_required, accepted_file_types, sort_order")
    .eq("cycle_id", sourceCycleId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) return { error: friendlyError(error.message) };

  const source = data ?? [];
  if (source.length === 0) return { copied: 0 };

  // Append: start each stage's copied requirements after the current max
  // sort_order for that stage in the destination, so nothing ties.
  const { data: existing, error: existingErr } = await supabase
    .from("document_requirements")
    .select("stage, sort_order")
    .eq("cycle_id", targetCycleId)
    .eq("is_active", true);
  if (existingErr) return { error: friendlyError(existingErr.message) };

  const nextByStage = new Map<string, number>();
  for (const r of existing ?? []) {
    const current = nextByStage.get(r.stage) ?? -1;
    if (r.sort_order > current) nextByStage.set(r.stage, r.sort_order);
  }

  // source is already ordered by sort_order asc, preserving relative order.
  const rows = source.map((r) => {
    const next = (nextByStage.get(r.stage) ?? -1) + 1;
    nextByStage.set(r.stage, next);
    return {
      cycle_id: targetCycleId,
      stage: r.stage,
      label: r.label,
      description: r.description,
      is_required: r.is_required,
      accepted_file_types: r.accepted_file_types,
      sort_order: next,
      is_active: true,
    };
  });

  const { error: insErr } = await supabase
    .from("document_requirements")
    .insert(rows);
  if (insErr) return { error: friendlyError(insErr.message) };

  revalidatePath(`/manager/cycles/${targetCycleId}`);
  return { copied: rows.length };
}
