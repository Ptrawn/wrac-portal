import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import {
  CYCLE_STATUS_SEQUENCE,
  pacificDateToday,
  cycleYearsLine,
  formatLongDate,
  statusLabel,
  type Cycle,
  type DocumentRequirement,
  type ReviewQuestion,
} from "@/lib/cycles";
import {
  catalogEntry,
  CYCLE_SCOPED_REMINDER_KEYS,
} from "@/lib/email/catalog";
import { defaultOffsets, storedOffsets } from "@/lib/email/offsets";
import { type CycleFundingSummary } from "@/lib/reviews";
import { EditCycleForm } from "../edit-form";
import { CycleReminders, type CycleReminder } from "./cycle-reminders";
import { CycleStats } from "./cycle-stats";
import { CycleTemplate } from "./cycle-template";
import { CycleStatusControl } from "./cycle-status";
import { QuestionSets } from "./question-sets";
import { DocumentRequirements } from "./document-requirements";

function num(value: number | string | null): number {
  if (value === null || value === "") return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

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

  // Per-cycle stats. "Received" = submitted proposals; requested/awarded cover
  // the fundable types so a pre-proposal and its full aren't double-counted.
  const { data: statProposalData } = await supabase
    .from("proposals")
    .select("type, state, outcome, requested_amount")
    .eq("cycle_id", id);
  const statProposals =
    (statProposalData as
      | {
          type: string;
          state: string;
          outcome: string | null;
          requested_amount: number | string | null;
        }[]
      | null) ?? [];

  // Awarded figures come from the RPC, not a local reduce: it is the single
  // ARC-aware implementation of the pool draw, so the stats card and the
  // allocation screen agree structurally rather than by two sums being kept in
  // step. `allocated` is net of arc_amount and excludes off-cycle, which is
  // reported separately below.
  const { data: fundingSummaryData, error: fundingSummaryError } =
    await supabase.rpc("cycle_funding_summary", { p_cycle_id: id });
  const fundingSummary =
    (fundingSummaryData as CycleFundingSummary[] | null)?.[0] ?? null;

  const submittedOf = (type: string) =>
    statProposals.filter((p) => p.state === "submitted" && p.type === type)
      .length;
  const fundable = statProposals.filter(
    (p) => p.type === "full" || p.type === "continuation" || p.type === "off_cycle",
  );
  const proposalStats = {
    pre: submittedOf("pre"),
    full: submittedOf("full"),
    continuation: submittedOf("continuation"),
    offCycle: submittedOf("off_cycle"),
    funded: statProposals.filter((p) => p.outcome === "funded").length,
    totalRequested: fundable
      .filter((p) => p.state === "submitted")
      .reduce((s, p) => s + num(p.requested_amount), 0),
    // From the RPC — see the note above the call. null (not 0) when it failed,
    // so the card can render "—": a real zero and a failed read must not look
    // the same on a money figure.
    poolAwarded: fundingSummary ? num(fundingSummary.allocated) : null,
    offCycleAwarded: fundingSummary
      ? num(fundingSummary.offcycle_allocated)
      : null,
    awardedUnavailable: Boolean(fundingSummaryError) || fundingSummary == null,
  };

  const { data: statReportData } = await supabase
    .from("reports")
    .select("state, due_date")
    .eq("cycle_id", id);
  const statReports =
    (statReportData as { state: string; due_date: string | null }[] | null) ?? [];
  const today = pacificDateToday();
  const reportStats = {
    pending: statReports.filter(
      (r) => r.state === "pending" || r.state === "reopened",
    ).length,
    submitted: statReports.filter((r) => r.state === "submitted").length,
    pastDue: statReports.filter(
      (r) =>
        (r.state === "pending" || r.state === "reopened") &&
        r.due_date != null &&
        r.due_date < today,
    ).length,
  };

  // Per-cycle reminder schedules. A missing row means this cycle follows the
  // portal-wide schedule, which is what the component shows as "Default".
  const { data: offsetData } = await supabase
    .from("cycle_email_offsets")
    .select("email_key, offsets")
    .eq("cycle_id", id);
  const offsetsByKey = new Map<string, number[] | null>(
    ((offsetData as { email_key: string; offsets: number[] }[] | null) ?? []).map(
      (r) => [r.email_key, storedOffsets(r.offsets)],
    ),
  );

  // What "Default" means on this screen: the PORTAL-WIDE schedule this cycle
  // would fall back to, which is the email_settings override when the manager
  // has set one and the catalog's shipped value otherwise. Showing the catalog
  // value here regardless would tell the manager a number the jobs would not
  // actually use -- see resolveOffsets.
  const { data: globalOffsetData } = await supabase
    .from("email_settings")
    .select("key, reminder_offsets")
    .in("key", [...CYCLE_SCOPED_REMINDER_KEYS]);
  const globalByKey = new Map<string, number[] | null>(
    (
      (globalOffsetData as
        | { key: string; reminder_offsets: number[] | null }[]
        | null) ?? []
    ).map((r) => [r.key, storedOffsets(r.reminder_offsets)]),
  );

  // What each cycle-scoped reminder chases, so a row says which date it hangs
  // off rather than leaving the manager to infer it from the label.
  const REMINDER_DEADLINES: Record<string, string> = {
    full_proposal_due: "Full-proposal due date",
    review_due: "Pre-review and full-review due dates",
    funding_meeting: "Funding meeting date",
  };
  const cycleReminders: CycleReminder[] = CYCLE_SCOPED_REMINDER_KEYS.flatMap(
    (key) => {
      const entry = catalogEntry(key);
      if (!entry) return [];
      return [
        {
          key,
          label: entry.label,
          deadlineLabel: REMINDER_DEADLINES[key] ?? "Cycle deadline",
          defaultOffsets: globalByKey.get(key) ?? defaultOffsets(key),
          cycleOffsets: offsetsByKey.get(key) ?? null,
        },
      ];
    },
  );

  // Which stage the cycle is at, for the stepper on the fiscal-year row below.
  // cycle.status is already typed CycleStatus, so no cast is needed.
  const stageIdx = CYCLE_STATUS_SEQUENCE.indexOf(cycle.status);

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/manager/cycles"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Cycles
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/manager/cycles/${id}/proposals`}>Proposals</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/manager/cycles/${id}/allocation`}>Allocation</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/manager/cycles/${id}/reports`}>Reports</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/manager/cycles/${id}/report`}>Funding report</Link>
            </Button>
          </div>
        </div>

        {/* This page is the hub every other cycle-scoped screen launches from,
            and it had no heading at all — nothing on it said which cycle you
            were in. */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">{cycle.name}</h1>
            <Badge variant="secondary">{statusLabel(cycle.status)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {cycleYearsLine(cycle)}
          </p>
        </div>

        {cycle.fiscal_year == null && (
          <div className="border border-destructive/40 bg-destructive/10 text-sm p-3 rounded-none">
            <span className="font-semibold">No fiscal year set.</span>{" "}
            Proposals can&apos;t be submitted and this cycle can&apos;t open for
            pre-proposals until you set a fiscal year (used for serial numbers).
            Set it in <span className="font-medium">Edit cycle</span> below.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Cycle Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* Fiscal year left, stage stepper pushed right. ml-auto rather than
                justify-between, so when the row wraps the fiscal year keeps its
                natural width at the left instead of being stretched across. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="text-sm">
                <span className="text-muted-foreground">Fiscal year: </span>
                {cycle.fiscal_year != null ? (
                  <span className="num font-medium">{cycle.fiscal_year}</span>
                ) : (
                  <span className="text-destructive font-medium">not set</span>
                )}
              </div>

              {/* Stage stepper. shrink-0 and no flex-wrap keep the nine pips on a
                  single line, so the width cue still reads as a left-to-right
                  sequence; on a very narrow viewport the strip scrolls inside its
                  own box rather than overflowing the card. */}
              <div className="ml-auto flex max-w-full shrink-0 gap-1.5 overflow-x-auto">
                {CYCLE_STATUS_SEQUENCE.map((s, i) => (
                  <span
                    key={s}
                    title={statusLabel(s)}
                    className={
                      // The current pip is set apart by WIDTH, not just opacity — in a
                      // row of nine, an opacity step alone is hard to locate.
                      "h-1.5 shrink-0 rounded-full " +
                      (i < stageIdx
                        ? "w-7 bg-foreground/40"
                        : i === stageIdx
                          ? "w-12 bg-foreground"
                          : "w-7 bg-foreground/10")
                    }
                  />
                ))}
              </div>
            </div>
            {/* The funding meeting read-only, because it is the date someone
                opens this page to look up. Every other cycle date is only
                visible inside the edit form below, which is the right place to
                CHANGE one but a poor place to read one. formatLongDate rather
                than the raw column, so it reads the same here as in the
                emails. */}
            <div className="text-sm">
              <span className="text-muted-foreground">Funding meeting: </span>
              {cycle.funding_meeting_at ? (
                <span className="font-medium">
                  {formatLongDate(cycle.funding_meeting_at)}
                </span>
              ) : (
                <span className="text-muted-foreground">not set</span>
              )}
            </div>
            <CycleStatusControl cycleId={id} status={cycle.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Cycle stats</CardTitle>
          </CardHeader>
          <CardContent>
            <CycleStats
              cycleId={id}
              proposals={proposalStats}
              reports={reportStats}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">Edit cycle</CardTitle>
              <Badge variant="secondary">{statusLabel(cycle.status)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <EditCycleForm cycle={cycle} />
            {/* A section of the edit area, but NOT part of the form above: it
                writes cycle_email_offsets, so it keeps its own per-row saves
                rather than riding on the cycle's single Save button. */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-3">Reminder emails</h3>
              <CycleReminders cycleId={id} reminders={cycleReminders} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Proposal template / guidance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CycleTemplate
              cycleId={id}
              templatePath={cycle.template_path}
              templateName={cycle.template_name}
            />
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
