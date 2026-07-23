import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedResearcher } from "@/lib/auth/profile";
import {
  cycleStagePhrase,
  formatBudget,
  formatDate,
  formatLongDate,
  pacificDateToday,
} from "@/lib/cycles";
import {
  computeSubmissionEligibility,
  isProposalEditable,
  proposalStateLabel,
  proposalTypeLabel,
  type Proposal,
} from "@/lib/proposals";
import { reportStateLabel, reportTypeLabel } from "@/lib/reviews";

type ReportRow = {
  id: string;
  type: string;
  label: string | null;
  due_date: string | null;
  state: string;
  project: { title: string } | null;
};

function reportStateBadgeVariant(
  state: string,
): "default" | "secondary" | "outline" {
  switch (state) {
    case "submitted":
      return "default";
    case "reopened":
      return "outline";
    default:
      return "secondary";
  }
}

type OpenCycle = {
  id: string;
  name: string;
  year: number;
  pre_proposal_closes_at: string | null;
};

type ProposalWithCycle = Proposal & {
  cycle: {
    name: string;
    year: number;
    status: string;
    pre_proposal_closes_at: string | null;
    full_proposal_due_at: string | null;
  } | null;
  project: {
    status: string;
    planned_years: number;
    final_report_required: boolean;
  } | null;
};

function stateBadgeVariant(
  state: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (state) {
    case "submitted":
      return "default";
    case "rescinded":
      return "destructive";
    case "reopened":
      return "outline";
    default:
      return "secondary";
  }
}

export default async function DashboardPage() {
  const { email, profile } = await requireApprovedResearcher();

  const supabase = await createClient();

  const { data: openData } = await supabase
    .from("cycles")
    .select("id, name, year, pre_proposal_closes_at")
    .eq("status", "pre_proposal_open")
    .order("year", { ascending: false });
  const openCycles = (openData as OpenCycle[] | null) ?? [];

  const { data: proposalData } = await supabase
    .from("proposals")
    .select(
      "*, cycle:cycles(name, year, status, pre_proposal_closes_at, full_proposal_due_at), project:projects(status, planned_years, final_report_required)",
    )
    .order("created_at", { ascending: false });
  const proposals = (proposalData as ProposalWithCycle[] | null) ?? [];
  const pacificToday = pacificDateToday();

  // Reports the researcher owns (RLS scopes to their own projects).
  const { data: reportData } = await supabase
    .from("reports")
    .select("id, type, label, due_date, state, project:projects(title)")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  const reports = (reportData as unknown as ReportRow[] | null) ?? [];
  const reportOverdue = (r: ReportRow): boolean =>
    r.state === "pending" && r.due_date != null && r.due_date < pacificToday;

  // A draft/reopened proposal whose stage/deadline no longer allows submission
  // (and without a manager override) is flagged so the researcher isn't
  // surprised when they open it.
  const submissionClosed = (p: ProposalWithCycle): boolean => {
    if (!isProposalEditable(p.state) || !p.cycle) return false;
    return !computeSubmissionEligibility({
      type: p.type,
      cycleStatus: p.cycle.status,
      preProposalClosesAt: p.cycle.pre_proposal_closes_at,
      fullProposalDueAt: p.cycle.full_proposal_due_at,
      lateSubmissionAllowed: p.late_submission_allowed,
      stagePhrase: cycleStagePhrase,
      formatLongDate,
      pacificToday,
    }).canSubmit;
  };

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-3xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <h1 className="text-2xl font-bold">
            Welcome{profile.full_name ? `, ${profile.full_name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">{profile.institution}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Open for submission</CardTitle>
            <CardDescription>
              Cycles currently accepting pre-proposals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {openCycles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cycles are open for submission right now.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {openCycles.map((cycle) => (
                  <li
                    key={cycle.id}
                    className="border rounded-md p-3 flex items-center justify-between gap-3"
                  >
                    <div className="text-sm">
                      <div className="font-medium">
                        {cycle.name}{" "}
                        <span className="text-muted-foreground font-normal">
                          ({cycle.year})
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        Pre-proposal deadline:{" "}
                        {formatDate(cycle.pre_proposal_closes_at)}
                      </div>
                    </div>
                    <Button asChild size="sm">
                      <Link href={`/dashboard/proposals/new?cycle=${cycle.id}`}>
                        Start a pre-proposal
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Reports due</CardTitle>
            <CardDescription>
              Status and final reports on your funded projects.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You have no reports to submit right now.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {reports.map((r) => (
                  <li key={r.id}>
                    <Link href={`/dashboard/reports/${r.id}`}>
                      <div className="border rounded-md p-3 hover:border-foreground/30 transition-colors flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-sm">
                            {r.project?.title ?? "Report"}{" "}
                            <span className="text-muted-foreground font-normal">
                              — {reportTypeLabel(r.type)} report
                              {r.label ? ` · ${r.label}` : ""}
                            </span>
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {reportOverdue(r) && (
                              <Badge
                                variant="outline"
                                className="text-destructive border-destructive/40"
                              >
                                Overdue
                              </Badge>
                            )}
                            <Badge variant={reportStateBadgeVariant(r.state)}>
                              {reportStateLabel(r.state)}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Due {formatDate(r.due_date)}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">My proposals</CardTitle>
          </CardHeader>
          <CardContent>
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You haven&apos;t started any proposals yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {proposals.map((p) => (
                  <li key={p.id}>
                    <Link href={`/dashboard/proposals/${p.id}`}>
                      <div className="border rounded-md p-3 hover:border-foreground/30 transition-colors flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-sm">{p.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {p.project?.final_report_required && (
                              <Badge
                                variant="outline"
                                className="text-destructive border-destructive/40"
                              >
                                Final report required
                              </Badge>
                            )}
                            {p.project?.status === "ended" && (
                              <Badge variant="outline">Project ended</Badge>
                            )}
                            {submissionClosed(p) && (
                              <Badge variant="outline" className="text-destructive border-destructive/40">
                                Submission closed
                              </Badge>
                            )}
                            <Badge variant={stateBadgeVariant(p.state)}>
                              {proposalStateLabel(p.state)}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>
                            {p.cycle
                              ? `${p.cycle.name} (${p.cycle.year})`
                              : "—"}
                          </span>
                          <span>{proposalTypeLabel(p.type)}</span>
                          {p.type === "continuation" && p.project && (
                            <span>
                              Year {p.year_number} of {p.project.planned_years}
                            </span>
                          )}
                          {p.requested_amount != null && (
                            <span>Requested {formatBudget(p.requested_amount)}</span>
                          )}
                          {p.submitted_at && (
                            <span>
                              Submitted {formatDate(p.submitted_at.slice(0, 10))}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
