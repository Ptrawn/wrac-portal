import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUserAndProfile, homePathForProfile } from "@/lib/auth/profile";

export default async function DashboardPage() {
  const { userId, email, profile } = await getUserAndProfile();

  if (!userId) {
    redirect("/auth/login");
  }

  const home = homePathForProfile(profile);
  if (home !== "/dashboard") {
    redirect(home);
  }

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}
            </CardTitle>
            <CardDescription>You&apos;re approved.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Proposal submission is coming soon.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
