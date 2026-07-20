import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUserAndProfile } from "@/lib/auth/profile";
import { ChangePasswordForm } from "./change-password-form";

// Reachable by any signed-in user; intentionally NOT gated by
// homePathForProfile, so a must_change_password user isn't redirected away.
export default async function ChangePasswordPage() {
  const { userId, email, profile } = await getUserAndProfile();
  if (!userId) {
    redirect("/auth/login");
  }

  const forced = profile?.must_change_password === true;

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-md p-5 flex flex-col gap-6 mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Set a new password</CardTitle>
            <CardDescription>
              {forced
                ? "Before you continue, choose a new password to replace your temporary one."
                : "Choose a new password for your account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
