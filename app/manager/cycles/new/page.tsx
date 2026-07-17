import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireManager } from "@/lib/auth/profile";
import { CreateCycleForm } from "../create-form";

export default async function NewCyclePage() {
  const { email } = await requireManager();

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
            <CardTitle className="text-2xl">New cycle</CardTitle>
            <CardDescription>
              Create the cycle, then set its calendar on the next screen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateCycleForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
