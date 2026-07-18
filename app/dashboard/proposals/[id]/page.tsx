import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedResearcher } from "@/lib/auth/profile";
import { formatDate } from "@/lib/cycles";
import type { DocumentRequirement } from "@/lib/cycles";
import {
  isProposalEditable,
  proposalStateLabel,
  proposalTypeLabel,
  type Project,
  type Proposal,
  type ProposalDocument,
} from "@/lib/proposals";
import { ProposalWorkspace } from "./workspace";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email, userId } = await requireApprovedResearcher();
  const { id } = await params;

  const supabase = await createClient();

  // RLS restricts this to the owner; a non-owner (or missing) id yields null.
  const { data: proposalData } = await supabase
    .from("proposals")
    .select("*")
    .eq("id", id)
    .single();

  if (!proposalData || (proposalData as Proposal).researcher_id !== userId) {
    return (
      <main className="min-h-screen flex flex-col items-center">
        <AppHeader email={email} />
        <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Dashboard
          </Link>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Proposal not found</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This proposal doesn&apos;t exist or isn&apos;t yours.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const proposal = proposalData as Proposal;

  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("id", proposal.project_id)
    .single();
  const project = projectData as Project | null;

  const { data: cycleData } = await supabase
    .from("cycles")
    .select("id, name, year, status, pre_proposal_closes_at")
    .eq("id", proposal.cycle_id)
    .single();

  const { data: requirementData } = await supabase
    .from("document_requirements")
    .select("*")
    .eq("cycle_id", proposal.cycle_id)
    .eq("stage", "pre")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const requirements = (requirementData as DocumentRequirement[] | null) ?? [];

  const { data: documentData } = await supabase
    .from("proposal_documents")
    .select("*")
    .eq("proposal_id", id);
  const documents = (documentData as ProposalDocument[] | null) ?? [];

  const { data: profileData } = await supabase
    .from("profiles")
    .select("cv_path")
    .eq("id", userId)
    .single();
  const hasCv = Boolean((profileData as { cv_path: string | null } | null)?.cv_path);

  const editable = isProposalEditable(proposal.state);

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Dashboard
        </Link>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">{proposal.title}</CardTitle>
              <Badge variant="secondary">
                {proposalStateLabel(proposal.state)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {cycleData
                ? `${cycleData.name} (${cycleData.year})`
                : "Cycle unavailable"}{" "}
              · {proposalTypeLabel(proposal.type)} · Deadline{" "}
              {formatDate(cycleData?.pre_proposal_closes_at ?? null)}
            </p>
          </CardHeader>
          <CardContent>
            <ProposalWorkspace
              proposalId={proposal.id}
              projectId={proposal.project_id}
              state={proposal.state}
              editable={editable}
              hasCv={hasCv}
              initialTitle={proposal.title}
              initialAmount={
                proposal.requested_amount == null
                  ? ""
                  : String(proposal.requested_amount)
              }
              initialPlannedYears={String(project?.planned_years ?? 1)}
              requirements={requirements}
              documents={documents}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
