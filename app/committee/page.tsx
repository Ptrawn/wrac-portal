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
import { requireCommittee } from "@/lib/auth/profile";
import { formatBudget, formatDate, statusLabel } from "@/lib/cycles";
import { proposalTypeLabel } from "@/lib/proposals";
import { reviewStatusLabel } from "@/lib/reviews";

type QueueProposal = {
  id: string;
  title: string;
  type: string;
  requested_amount: number | string | null;
  submitted_at: string | null;
  cycle: { id: string; name: string; year: number; status: string } | null;
  researcher: { full_name: string | null; institution: string | null } | null;
};

function reviewBadgeVariant(
  state: string | undefined,
): "default" | "secondary" | "outline" {
  switch (state) {
    case "submitted":
      return "default";
    case "reopened":
      return "outline";
    case "draft":
      return "secondary";
    default:
      return "outline";
  }
}

export default async function CommitteeQueuePage() {
  const { email, userId } = await requireCommittee();

  const supabase = await createClient();

  const { data: proposalData } = await supabase
    .from("proposals")
    .select(
      "id, title, type, requested_amount, submitted_at, cycle:cycles(id, name, year, status), researcher:profiles!researcher_id(full_name, institution)",
    )
    .order("submitted_at", { ascending: true });
  // Supabase types infer to-one embeds as arrays; at runtime they're objects.
  const proposals = (proposalData as unknown as QueueProposal[] | null) ?? [];

  const { data: reviewData } = await supabase
    .from("reviews")
    .select("proposal_id, state")
    .eq("reviewer_id", userId);
  const myReviewState = new Map<string, string>(
    (reviewData ?? []).map((r) => [r.proposal_id, r.state]),
  );

  // Group by cycle, preserving first-seen order.
  const groups: {
    cycle: QueueProposal["cycle"];
    key: string;
    items: QueueProposal[];
  }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const p of proposals) {
    const key = p.cycle?.id ?? "none";
    let group = byKey.get(key);
    if (!group) {
      group = { cycle: p.cycle, key, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(p);
  }

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-3xl p-5 flex flex-col gap-6 mt-8">
        <h1 className="text-2xl font-bold">Review queue</h1>

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No proposals awaiting your review.
          </p>
        ) : (
          groups.map((group) => {
            const submittedCount = group.items.filter(
              (p) => myReviewState.get(p.id) === "submitted",
            ).length;
            return (
              <Card key={group.key}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-xl">
                      {group.cycle
                        ? `${group.cycle.name} (${group.cycle.year})`
                        : "Unknown cycle"}
                    </CardTitle>
                    {group.cycle && (
                      <Badge variant="secondary">
                        {statusLabel(group.cycle.status)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {submittedCount} of {group.items.length} reviews submitted
                  </p>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-2">
                    {group.items.map((p) => {
                      const state = myReviewState.get(p.id);
                      return (
                        <li key={p.id}>
                          <Link href={`/committee/proposals/${p.id}`}>
                            <div className="border rounded-md p-3 hover:border-foreground/30 transition-colors flex flex-col gap-1">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-sm">
                                  {p.title}
                                </span>
                                <Badge variant={reviewBadgeVariant(state)}>
                                  {reviewStatusLabel(state)}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                                <span>
                                  {p.researcher?.full_name ?? "Unknown"}
                                  {p.researcher?.institution
                                    ? ` · ${p.researcher.institution}`
                                    : ""}
                                </span>
                                <span>{proposalTypeLabel(p.type)}</span>
                                {p.requested_amount != null && (
                                  <span>
                                    Requested {formatBudget(p.requested_amount)}
                                  </span>
                                )}
                                {p.submitted_at && (
                                  <span>
                                    Submitted{" "}
                                    {formatDate(p.submitted_at.slice(0, 10))}
                                  </span>
                                )}
                              </div>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </main>
  );
}
