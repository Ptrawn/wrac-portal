import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { LogoutButton } from "@/components/logout-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUserAndProfile, homePathForProfile } from "@/lib/auth/profile";
import { MANAGER_EMAIL, MANAGER_MAILTO } from "@/lib/contact";

/**
 * Where a former committee member lands.
 *
 * It exists so that losing access is a SENTENCE rather than an empty screen.
 * Before this page, a deactivated member was still routed to /committee, where
 * every query returned nothing and committee_dashboard() raised an error the
 * page discarded -- they saw a blank review dashboard and no reason for it.
 *
 * The guard is the same one every other page uses: ask homePathForProfile where
 * this person belongs, and if it isn't here, send them there. That keeps the
 * rule in one place, so an account that is reactivated walks straight back out
 * of this page on the next request with nothing to clear.
 */
export default async function InactivePage() {
  const { userId, email, profile } = await getUserAndProfile();

  if (!userId) {
    redirect("/auth/login");
  }

  const home = homePathForProfile(profile);
  if (home !== "/inactive") {
    redirect(home);
  }

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Committee access ended</CardTitle>
            <CardDescription>
              Your committee access has ended. If you think this is a mistake,
              contact the program manager.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Reviews you already submitted are kept with their proposals and
              are unaffected.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={MANAGER_MAILTO}
                className="text-sm underline underline-offset-4"
                title={`Email the program manager at ${MANAGER_EMAIL}`}
              >
                Contact the program manager
              </a>
            </div>
            <div>
              <LogoutButton />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
