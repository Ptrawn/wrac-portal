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

type RescindedRow = {
  id: string;
  cycle_id: string;
  cycle: { name: string; status: string } | null;
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
  unavailable = false,
}: {
  href: string;
  label: string;
  value: number;
  hint: string;
  attention: boolean;
  // The read behind this tile failed. Show "—" instead of a number (0 is a
  // plausible real value, so rendering it on failure IS the bug), put the reason
  // in the hint, and never light the amber attention state — amber claims "you
  // have something to deal with", which is a different claim from "I don't
  // know". Each tile carries its own flag, so one failure can't affect another.
  unavailable?: boolean;
}) {
  const alert = attention && !unavailable;
  return (
    <Link href={href} className="block">
      <div
        className={
          "h-full rounded-lg border p-4 transition-colors hover:border-foreground/30 " +
          (alert ? "border-status-review" : "")
        }
      >
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={
            "text-3xl font-bold tabular-nums mt-1 " +
            (alert ? "text-status-review" : "")
          }
        >
          {unavailable ? "—" : value}
        </div>
        <div
          className={
            unavailable
              ? "text-sm text-destructive mt-1"
              : "text-sm text-muted-foreground mt-1"
          }
        >
          {hint}
        </div>
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

  const { data: statsData, error: statsError } = await supabase.rpc(
    "manager_dashboard_stats",
  );
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

  const { data: tilesData, error: tilesError } = await supabase.rpc(
    "cycle_tiles_for_manager",
  );
  const cycleTiles = (tilesData as CycleTile[] | null) ?? [];

  // The tile RPC doesn't carry fiscal_year; fetch it directly (manager RLS).
  // This read's failure mode is the INVERSE of the others on this page: an
  // empty map makes every cycle look like it has no fiscal year, so a broken
  // query would raise a red alarm on every tile rather than quietly reassure.
  // fyError is therefore tracked separately from "fetched and genuinely null".
  const { data: fyData, error: fyError } = await supabase
    .from("cycles")
    .select("id, fiscal_year");
  const fiscalByCycle = new Map<string, number | null>(
    ((fyData as { id: string; fiscal_year: number | null }[] | null) ?? []).map(
      (c) => [c.id, c.fiscal_year],
    ),
  );

  const { data: progressData, error: progressError } = await supabase.rpc(
    "committee_review_progress",
  );
  const progress = (progressData as ReviewProgress[] | null)?.[0] ?? {
    expected_reviews: 0,
    submitted_reviews: 0,
    outstanding_reviews: 0,
  };

  const { data: memberData, error: memberError } = await supabase.rpc(
    "committee_member_review_status",
  );
  const members = (memberData as MemberStatus[] | null) ?? [];

  // Outstanding reports across ALL cycles (closed included -- a closed cycle can
  // still owe reports), for the report-status tile.
  const { data: outstandingReportData, error: reportReadError } = await supabase
    .from("reports")
    .select("due_date")
    .in("state", ["pending", "reopened"]);
  const outstandingReports =
    (outstandingReportData as { due_date: string | null }[] | null) ?? [];

  // Proposals a researcher has withdrawn, in cycles that are still live (not
  // setup or closed). Nothing else tells the manager this happened — the state
  // just changes to a grey badge in a list — so a proposal can leave the review
  // pool while the committee keeps reviewing it.
  //
  // Deliberately NOT time-windowed: one rescinded three weeks ago in a cycle
  // still under review matters as much as one rescinded today, and a window
  // would hide it. Direct table read + page-side filter, matching the past-due
  // reports tile below rather than extending an RPC.
  const { data: rescindedData, error: rescindedError } = await supabase
    .from("proposals")
    .select("id, cycle_id, cycle:cycles(name, status)")
    .eq("state", "rescinded");
  const rescindedLive = (
    (rescindedData as unknown as RescindedRow[] | null) ?? []
  ).filter(
    (p) => p.cycle != null && !["setup", "closed"].includes(p.cycle.status),
  );
  const rescindedCycleIds = Array.from(
    new Set(rescindedLive.map((p) => p.cycle_id)),
  );
  // Deep-link when they're all in one cycle (the common case — usually one live
  // round), since landing on the cycle list and hunting for grey badges is what
  // the tile exists to avoid. Fall back to the cycle list when several cycles
  // are involved and no single destination is right.
  const rescindedHref =
    rescindedCycleIds.length === 1
      ? `/manager/cycles/${rescindedCycleIds[0]}/proposals`
      : "/manager/cycles";

  const today = pacificDateToday();

  const pastDueReports = outstandingReports.filter(
    (r) => r.due_date != null && r.due_date < today,
  ).length;
  // 60 days: report deadlines are seasonal (months apart), so a shorter window
  // would read 0 almost year-round and tell the manager nothing.
  const dueSoonReports = outstandingReports.filter((r) => {
    const d = daysUntilDate(r.due_date, today);
    return d != null && d >= 0 && d <= 60;
  }).length;

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-4xl p-5 flex flex-col gap-8 mt-8">
        <div>
          <h1 className="text-2xl font-bold">Manager dashboard</h1>
          {/* Counts, not a figure with a "—" slot — so on failure this says what
              broke instead of quietly reading "0 open cycles · 0 committee
              members", which is a sentence a real dashboard could print. */}
          {statsError ? (
            <p className="text-sm text-destructive">
              Couldn&apos;t load dashboard stats: {statsError.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {stats.open_cycle_count} open cycle
              {stats.open_cycle_count === 1 ? "" : "s"} ·{" "}
              {stats.committee_member_count} committee member
              {stats.committee_member_count === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {/* 1. Attention row */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Needs your attention
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <AttentionTile
              href="#pending"
              label="Pending registrations"
              value={stats.pending_registration_count}
              hint={
                statsError
                  ? `Couldn't load: ${statsError.message}`
                  : stats.pending_registration_count > 0
                    ? "Awaiting your approval"
                    : "All caught up"
              }
              attention={stats.pending_registration_count > 0}
              unavailable={Boolean(statsError)}
            />
            <AttentionTile
              href="/manager/cycles"
              label="New submissions since last login"
              value={stats.submissions_since_last_seen}
              hint={
                statsError
                  ? `Couldn't load: ${statsError.message}`
                  : stats.submissions_since_last_seen > 0
                    ? "Submitted while you were away"
                    : "No new submissions"
              }
              attention={stats.submissions_since_last_seen > 0}
              unavailable={Boolean(statsError)}
            />
            <AttentionTile
              href="#committee-status"
              label="Outstanding committee reviews"
              value={progress.outstanding_reviews}
              hint={
                progressError
                  ? `Couldn't load: ${progressError.message}`
                  : progress.outstanding_reviews > 0
                    ? "Reviews not yet submitted"
                    : "Committee is all caught up"
              }
              attention={progress.outstanding_reviews > 0}
              unavailable={Boolean(progressError)}
            />
            <AttentionTile
              href="/manager/reports"
              label="Past-due reports"
              value={pastDueReports}
              hint={
                reportReadError
                  ? `Couldn't load: ${reportReadError.message}`
                  : dueSoonReports > 0
                    ? `${dueSoonReports} more due in the next 60 days`
                    : "None due in the next 60 days"
              }
              attention={pastDueReports > 0}
              unavailable={Boolean(reportReadError)}
            />
            <AttentionTile
              href={rescindedHref}
              label="Withdrawn by researcher"
              value={rescindedLive.length}
              hint={
                rescindedError
                  ? `Couldn't load: ${rescindedError.message}`
                  : rescindedLive.length > 0
                    ? "Pulled from a live cycle — restore or tell the committee"
                    : "None withdrawn"
              }
              attention={rescindedLive.length > 0}
              unavailable={Boolean(rescindedError)}
            />
          </div>
        </section>

        {/* Pending registrations queue — the strong existing affordance */}
        <Card id="pending" className="scroll-mt-4">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-xl">Pending registrations</CardTitle>
              <Button asChild variant="outline" size="sm">
                <Link href="/manager/researchers">All researchers</Link>
              </Button>
            </div>
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
          {/* A list, not a figure — "—" would be meaningless here, so the
              failure replaces the empty-state sentence instead. "No active
              cycles" is a perfectly plausible thing for this page to say, which
              is exactly why a broken read must not say it. */}
          {tilesError ? (
            <p className="text-sm text-destructive">
              Couldn&apos;t load cycles: {tilesError.message}
            </p>
          ) : cycleTiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active cycles. Create one to get started.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {cycleTiles.map((c) => {
                const days = daysUntilDate(c.next_deadline, today);
                const overdue = days != null && days < 0;
                const soon = days != null && days >= 0 && days <= 7;
                const fy = fiscalByCycle.get(c.cycle_id);
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
                        {/* Three distinct states, not two: a real fiscal year,
                            a genuinely missing one (red — it blocks opening
                            pre-proposals), and one we simply couldn't read
                            (muted — no claim either way). */}
                        {fyError ? (
                          <span>FY unavailable</span>
                        ) : fy != null ? (
                          <span>FY {fy}</span>
                        ) : (
                          <span className="text-destructive">No fiscal year</span>
                        )}
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
        {/* Two reads feed this card; either failing makes its figures and its
            per-member list untrustworthy, so report whichever broke. */}
        <CommitteeReviewTile
          progress={progress}
          members={members}
          unavailable={
            progressError?.message ?? memberError?.message ?? null
          }
        />
      </div>
    </main>
  );
}
