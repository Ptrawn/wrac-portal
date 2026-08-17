import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUserAndProfile, homePathForProfile } from "@/lib/auth/profile";
import { GUIDES_MAY_BE_STALE, guideForRole } from "@/lib/guides";

/**
 * Role-appropriate user guide. Any signed-in user can reach it (it's linked
 * from the header on every page); each role is served their own document.
 */
export default async function HelpPage() {
  const { userId, email, profile } = await getUserAndProfile();
  if (!userId) {
    redirect("/auth/login");
  }

  const guide = guideForRole(profile);

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <Link
            href={homePathForProfile(profile)}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Back
          </Link>
          <h1 className="text-2xl font-bold mt-1">Help &amp; user guide</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Written for your role: the {guide.audience} guide.
          </p>
        </div>

        {GUIDES_MAY_BE_STALE && (
          <div className="rounded-md border border-status-review/40 bg-status-review/5 p-3 text-sm">
            <span className="font-medium text-status-review">
              This guide is being updated.
            </span>{" "}
            It was written before some recent additions to the portal — fiscal
            years and proposal serial numbers, the WSU ARC fund, choosing whether
            to review a proposal, and the report dashboard. Use it for the
            general workflow, and expect those newer screens to look different. A
            revised guide is on the way.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{guide.label}</CardTitle>
            <CardDescription>
              Opens as a PDF. You can read it in the browser or download it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <a href={guide.href} target="_blank" rel="noopener noreferrer">
                Open the {guide.label}
              </a>
            </Button>
            <a
              href={guide.href}
              download
              className="text-sm underline underline-offset-4"
            >
              Download
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Need something else?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              If the guide doesn&apos;t answer your question, contact the program
              manager — they can help directly and pass on anything the guide
              should cover.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
