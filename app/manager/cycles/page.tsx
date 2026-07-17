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
  formatBudget,
  formatDate,
  statusLabel,
  type Cycle,
} from "@/lib/cycles";

export default async function CyclesPage() {
  const { email } = await requireManager();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cycles")
    .select("*")
    .order("year", { ascending: false })
    .order("created_at", { ascending: false });
  const cycles = (data as Cycle[] | null) ?? [];

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-3xl p-5 flex flex-col gap-6 mt-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link
              href="/manager"
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              ← Manager
            </Link>
            <h1 className="text-2xl font-bold mt-1">Research cycles</h1>
          </div>
          <Button asChild>
            <Link href="/manager/cycles/new">New cycle</Link>
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-red-500">
            Couldn&apos;t load cycles: {error.message}
          </p>
        ) : cycles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cycles yet — create one to get started.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {cycles.map((cycle) => (
              <Link key={cycle.id} href={`/manager/cycles/${cycle.id}`}>
                <Card className="hover:border-foreground/30 transition-colors">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-lg">
                        {cycle.name}{" "}
                        <span className="text-muted-foreground font-normal">
                          ({cycle.year})
                        </span>
                      </CardTitle>
                      <Badge variant="secondary">
                        {statusLabel(cycle.status)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
                      <span className="text-muted-foreground">Total budget</span>
                      <span>{formatBudget(cycle.total_budget)}</span>
                      <span className="text-muted-foreground">
                        Pre-proposal
                      </span>
                      <span>
                        {formatDate(cycle.pre_proposal_opens_at)} →{" "}
                        {formatDate(cycle.pre_proposal_closes_at)}
                      </span>
                      <span className="text-muted-foreground">
                        Full proposal due
                      </span>
                      <span>{formatDate(cycle.full_proposal_due_at)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
