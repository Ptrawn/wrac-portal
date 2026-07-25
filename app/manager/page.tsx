import Link from "next/link";

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
  daysRemainingText,
  daysUntilDate,
  formatLongDate,
  pacificDateToday,
  statusLabel,
} from "@/lib/cycles";
import { PendingList, type PendingResearcher } from "./pending-list";
import {
  CommitteeReviewTile,
  type MemberStatus,
  type ReviewProgress,
} from "./committee-review-tile";
import { recordManagerVisit } from "./dashboard-actions";

type ManagerStats = {
  open_cycle_count: number;
  pending_registration_count: number;
  committee_member_count: number;
  submissions_since_last_seen: number;
  total_submitted_open: number;
};

type CycleTile = {
  cycle_id: string;
  name: string;
  year: number;
  status: string;
  next_deadline: string | null;
  next_deadline_label: string | null;
  submitted_count: number;
  funded_count: number;
};

function AttentionTile({
  href,
  label,
  value,
  hint,
  attention,
}: {
  href: string;
  label: string;
  value: number;
  hint: string;
  attention: boolean;
}) {
  return (
    <Link href={href} className="block">
      <div
        className={
          "h-full rounded-lg border p-4 transition-colors hover:border-foreground/30 " +
          (attention ? "border-status-review" : "")
        }
      >
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={
            "text-3xl font-bold tabular-nums mt-1 " +
            (attention ? "text-status-review" : "")
          }
        >
          {value}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{hint}</div>
      </div>
    </Link>
  );
}

export default async function ManagerPage() {
  const { email } = await requireManager();
  const supabase = await createClient();

  // Record the visit BEFORE reading stats: touch_last_seen copies last_seen_at
  // (the prior session) into previous_seen_at, which manager_dashboard_stats then
  // reads for the "since last login" window. Its 10-minute throttle keeps rapid
  // refreshes on the same window. (See the report notes on ordering.)
  await recordManagerVisit();

  const { data: statsData } = await supabase.rpc("manager_dashboard_stats");
  const stats = (statsData as ManagerStats[] | null)?.[0] ?? {
    open_cycle_count: 0,
    pending_registration_count: 0,
    committee_member_count: 0,
    submissions_since_last_seen: 0,
    total_submitted_open: 0,
  };

  const { data: pendingData, error: pendingError } = await supabase.rpc(
    "list_pending_researchers",
  );
  const researchers = (pendingData as PendingResearcher[] | null) ?? [];

  const { data: tilesData } = await supabase.rpc("cycle_tiles_for_manager");
  const cycleTiles = (tilesData as CycleTile[] | null) ?? [];

  const { data: progressData } = await supabase.rpc(
    "committee_review_progress",
  );
  const progress = (progressData as ReviewProgress[] | null)?.[0] ?? {
    expected_reviews: 0,
    submitted_reviews: 0,
    outstanding_reviews: 0,
  };

  const { data: memberData } = await supabase.rpc(
    "committee_member_review_status",
  );
  const members = (memberData as MemberStatus[] | null) ?? [];

  const today = pacificDateToday();

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-4xl p-5 flex flex-col gap-8 mt-8">
        <div>
          <h1 className="text-2xl font-bold">Manager dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {stats.open_cycle_count} open cycle
            {stats.open_cycle_count === 1 ? "" : "s"} ·{" "}
            {stats.committee_member_count} committee member
            {stats.committee_member_count === 1 ? "" : "s"}
          </p>
        </div>

        {/* 1. Attention row */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Needs your attention
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <AttentionTile
              href="#pending"
              label="Pending registrations"
              value={stats.pending_registration_count}
              hint={
                stats.pending_registration_count > 0
                  ? "Awaiting your approval"
                  : "All caught up"
              }
              attention={stats.pending_registration_count > 0}
            />
            <AttentionTile
              href="/manager/cycles"
              label="New submissions since last login"
              value={stats.submissions_since_last_seen}
              hint={
                stats.submissions_since_last_seen > 0
                  ? "Submitted while you were away"
                  : "No new submissions"
              }
              attention={stats.submissions_since_last_seen > 0}
            />
            <AttentionTile
              href="#committee-status"
              label="Outstanding committee reviews"
              value={progress.outstanding_reviews}
              hint={
                progress.outstanding_reviews > 0
                  ? "Reviews not yet submitted"
                  : "Committee is all caught up"
              }
              attention={progress.outstanding_reviews > 0}
            />
          </div>
        </section>

        {/* Pending registrations queue — the strong existing affordance */}
        <Card id="pending" className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="text-xl">Pending registrations</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingError ? (
              <p className="text-sm text-destructive">
                Couldn&apos;t load the queue: {pendingError.message}
              </p>
            ) : (
              <PendingList researchers={researchers} />
            )}
          </CardContent>
        </Card>

        {/* 2. Cycles */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Cycles</h2>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/manager/cycles">All cycles</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/manager/cycles/new">New cycle</Link>
              </Button>
            </div>
          </div>
          {cycleTiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active cycles. Create one to get started.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {cycleTiles.map((c) => {
                const days = daysUntilDate(c.next_deadline, today);
                const overdue = days != null && days < 0;
                const soon = days != null && days >= 0 && days <= 7;
                return (
                  <Link key={c.cycle_id} href={`/manager/cycles/${c.cycle_id}`}>
                    <div className="h-full rounded-lg border p-4 flex flex-col gap-2 transition-colors hover:border-foreground/30">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold">
                          {c.name}{" "}
                          <span className="text-muted-foreground font-normal">
                            ({c.year})
                          </span>
                        </span>
                        <Badge variant="secondary">
                          {statusLabel(c.status)}
                        </Badge>
                      </div>
                      <div className="text-sm">
                        {c.next_deadline_label && c.next_deadline ? (
                          <span
                            className={
                              overdue
                                ? "text-destructive font-medium"
                                : soon
                                  ? "text-status-review"
                                  : ""
                            }
                          >
                            {c.next_deadline_label} {daysRemainingText(days)}
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              ({formatLongDate(c.next_deadline)})
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            No upcoming deadline
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-4 mt-auto">
                        <span>{c.submitted_count} submitted</span>
                        <span>{c.funded_count} funded</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* 3. Committee */}
        <CommitteeReviewTile progress={progress} members={members} />
      </div>
    </main>
  );
}
