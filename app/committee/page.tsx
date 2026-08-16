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
import {
  daysRemainingText,
  daysUntilDate,
  formatBudget,
  formatDate,
  formatLongDate,
  pacificDateToday,
  statusLabel,
} from "@/lib/cycles";
import { proposalTypeLabel } from "@/lib/proposals";
import { reviewStatusLabel } from "@/lib/reviews";
import { SerialTag } from "@/components/serial-tag";

type QueueProposal = {
  id: string;
  title: string;
  type: string;
  requested_amount: number | string | null;
  submitted_at: string | null;
  serial_number: string | null;
  outcome: string | null;
  cycle: { id: string } | null;
  researcher: { full_name: string | null; institution: string | null } | null;
};

type CommitteeDashboardRow = {
  cycle_id: string;
  name: string;
  status: string;
  review_deadline: string | null;
  review_deadline_label: string | null;
  proposals_to_review: number;
  my_reviews_submitted: number;
  my_reviews_outstanding: number;
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

  const { data: dashData } = await supabase.rpc("committee_dashboard");
  const dashboard = (dashData as CommitteeDashboardRow[] | null) ?? [];

  const { data: proposalData } = await supabase
    .from("proposals")
    .select(
      "id, title, type, requested_amount, submitted_at, serial_number, outcome, cycle:cycles(id), researcher:profiles!researcher_id(full_name, institution)",
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

  // Group proposals by cycle id for lookup against the dashboard rows.
  const byCycle = new Map<string, QueueProposal[]>();
  for (const p of proposals) {
    const key = p.cycle?.id ?? "none";
    const list = byCycle.get(key) ?? [];
    list.push(p);
    byCycle.set(key, list);
  }

  const today = pacificDateToday();

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-3xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <h1 className="text-2xl font-bold">Review dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Proposals awaiting your review, by cycle.
          </p>
        </div>

        {dashboard.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is awaiting your review right now.
          </p>
        ) : (
          dashboard.map((c) => {
            const items = byCycle.get(c.cycle_id) ?? [];
            const days = daysUntilDate(c.review_deadline, today);
            const overdue =
              days != null && days < 0 && c.my_reviews_outstanding > 0;
            const soon =
              days != null &&
              days >= 0 &&
              days <= 7 &&
              c.my_reviews_outstanding > 0;
            return (
              <Card key={c.cycle_id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-xl">{c.name}</CardTitle>
                    <Badge variant="secondary">{statusLabel(c.status)}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm">
                    {c.review_deadline && c.review_deadline_label ? (
                      <span
                        className={
                          overdue
                            ? "text-destructive font-medium"
                            : soon
                              ? "text-status-review"
                              : "text-muted-foreground"
                        }
                      >
                        {c.review_deadline_label} {daysRemainingText(days)}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          ({formatLongDate(c.review_deadline)})
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        No review deadline set
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {c.my_reviews_submitted} of {c.proposals_to_review} reviews
                      submitted
                    </span>
                    {c.my_reviews_outstanding > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-status-review text-status-review"
                      >
                        {c.my_reviews_outstanding} outstanding
                      </Badge>
                    ) : (
                      <Badge variant="secondary">All in</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-2">
                    {items.map((p) => {
                      const state = myReviewState.get(p.id);
                      return (
                        <li key={p.id}>
                          <Link href={`/committee/proposals/${p.id}`}>
                            <div className="border rounded-md p-3 hover:border-foreground/30 transition-colors flex flex-col gap-1">
                              <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-2 min-w-0">
                                  {p.serial_number && (
                                    <SerialTag
                                      serialNumber={p.serial_number}
                                      outcome={p.outcome}
                                    />
                                  )}
                                  <span className="font-medium text-sm truncate">
                                    {p.title}
                                  </span>
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
