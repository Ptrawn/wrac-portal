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
import { statusLabel, type Cycle } from "@/lib/cycles";
import { EditCycleForm } from "../edit-form";

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
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">Edit cycle</CardTitle>
              <Badge variant="secondary">{statusLabel(cycle.status)}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <EditCycleForm cycle={cycle} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
