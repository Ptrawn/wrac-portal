import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getUserAndProfile, homePathForProfile } from "@/lib/auth/profile";
import { PendingList, type PendingResearcher } from "./pending-list";

export default async function ManagerPage() {
  const { userId, email, profile } = await getUserAndProfile();

  if (!userId) {
    redirect("/auth/login");
  }

  const home = homePathForProfile(profile);
  if (home !== "/manager") {
    redirect(home);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_pending_researchers");
  const researchers = (data as PendingResearcher[] | null) ?? [];

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Pending registrations</CardTitle>
            <CardDescription>
              Approve or reject researchers who have requested access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="text-sm text-red-500">
                Couldn&apos;t load the queue: {error.message}
              </p>
            ) : (
              <PendingList researchers={researchers} />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
