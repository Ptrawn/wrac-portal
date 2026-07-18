import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import {
  statusLabel,
  type Cycle,
  type DocumentRequirement,
  type ReviewQuestion,
} from "@/lib/cycles";
import { EditCycleForm } from "../edit-form";
import { CycleStatusControl } from "./cycle-status";
import { QuestionSets } from "./question-sets";
import { DocumentRequirements } from "./document-requirements";

export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await requireManager();
  const { id } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("cycles")
    .select("*")
    .eq("id", id)
    .single();

  if (!data) {
    notFound();
  }
  const cycle = data as Cycle;

  const { data: questionData } = await supabase
    .from("review_questions")
    .select("*")
    .eq("cycle_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const questions = (questionData as ReviewQuestion[] | null) ?? [];
  const preQuestions = questions.filter((q) => q.stage === "pre");
  const fullQuestions = questions.filter((q) => q.stage === "full");

  const { data: requirementData } = await supabase
    .from("document_requirements")
    .select("*")
    .eq("cycle_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const requirements = (requirementData as DocumentRequirement[] | null) ?? [];

  const { data: otherData } = await supabase
    .from("cycles")
    .select("id, name, year")
    .neq("id", id)
    .order("year", { ascending: false });
  const otherCycles = (otherData as
    | { id: string; name: string; year: number }[]
    | null) ?? [];

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Link
          href="/manager/cycles"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Cycles
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Cycle Status</CardTitle>
          </CardHeader>
          <CardContent>
            <CycleStatusControl cycleId={id} status={cycle.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">Edit cycle</CardTitle>
              <Badge variant="secondary">{statusLabel(cycle.status)}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <EditCycleForm cycle={cycle} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Review Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <QuestionSets
              cycleId={id}
              preQuestions={preQuestions}
              fullQuestions={fullQuestions}
              otherCycles={otherCycles}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Document Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentRequirements
              cycleId={id}
              requirements={requirements}
              otherCycles={otherCycles}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
