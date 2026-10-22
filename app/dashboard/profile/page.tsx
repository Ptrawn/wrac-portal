import Link from "next/link";

import { CvUpload } from "@/app/pending/cv-upload";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireApprovedResearcher } from "@/lib/auth/profile";
import { MANAGER_EMAIL, MANAGER_MAILTO } from "@/lib/contact";
import { formatLongDate } from "@/lib/cycles";
import { createClient } from "@/lib/supabase/server";

/**
 * A storage timestamp (UTC, e.g. "2026-10-22T01:14:09Z") as the Pacific
 * calendar date it fell on, so an evening upload doesn't display as tomorrow.
 * Matches how the rest of the portal treats dates — see pacificDateToday.
 */
function pacificDateOf(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

/**
 * The researcher's own profile. It exists chiefly so an approved researcher can
 * upload or replace their CV: the only other CV control lives on /pending, and
 * approval itself redirects them away from that page permanently — so a
 * researcher approved without a CV had no way to add one, while every proposal
 * submission is gated on having one.
 *
 * Name, institution and email are deliberately read-only. Letting a researcher
 * edit them (and letting the manager edit them) is separate, larger work —
 * see the backlog in CLAUDE.md.
 */
export default async function ResearcherProfilePage() {
  const { userId, email, profile } = await requireApprovedResearcher();

  const hasCv = Boolean(profile.cv_path);

  // When the CV was last uploaded, which the storage object knows. Listing
  // one's own folder in the `cvs` bucket is already permitted by the
  // cvs_select_own policy, so this needs no new policy and no service role.
  let uploadedAt: string | null = null;
  let fileMissing = false;
  if (profile.cv_path) {
    const supabase = await createClient();
    const { data: files, error } = await supabase.storage
      .from("cvs")
      .list(userId);
    const file = (files ?? []).find((f) => f.name === "cv.pdf");
    // `upsert: true` on replacement keeps created_at from the first upload, so
    // updated_at is the one that answers "when did I last upload this?".
    uploadedAt = file?.updated_at ?? null;
    // Only claim the file is gone when the lookup actually succeeded — a failed
    // list must not be reported to the researcher as a missing CV.
    fileMissing = !error && !file;
  }

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-1">Your profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your registration details and the CV attached to your proposals.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Your details</CardTitle>
            <CardDescription>
              These came from your registration and can&apos;t be edited here.
              Ask the program manager to change any of them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <span className="text-muted-foreground">Full name</span>
              <span>{profile.full_name ?? "—"}</span>
              <span className="text-muted-foreground">Institution</span>
              <span>{profile.institution ?? "—"}</span>
              <span className="text-muted-foreground">Email</span>
              <span>{email ?? "—"}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {/* The address is the link text so it stays readable and copyable
                  on a machine with no mail client configured. */}
              Email the program manager at{" "}
              <a href={MANAGER_MAILTO} className="underline underline-offset-4">
                {MANAGER_EMAIL}
              </a>
              .
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-xl">Curriculum vitae</CardTitle>
              {/* `default` is NOT used for the good state: --primary and
                  --destructive are the same red in this theme, so the two
                  states would look identical. Same pairing as /pending. */}
              <Badge variant={hasCv ? "secondary" : "destructive"}>
                {hasCv ? "On file" : "Not on file"}
              </Badge>
            </div>
            <CardDescription>
              A PDF. A copy is attached to each proposal when you submit it, so
              the committee always sees the version you had on file that day.
              Replacing it here doesn&apos;t change proposals already submitted.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Says plainly why this matters: the submit button in every
                proposal stays disabled until a CV is here. */}
            {!hasCv ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex flex-col gap-1">
                <p className="font-medium">
                  You need a CV on file before you can submit a proposal.
                </p>
                <p>
                  Until you upload one, the <strong>Review &amp; submit</strong>{" "}
                  button stays disabled on every proposal — pre-proposals, full
                  proposals and continuation requests alike. You can still write
                  and save a draft and upload its documents.
                </p>
              </div>
            ) : fileMissing ? (
              // cv_path recorded but no file behind it. Submission would fail
              // when it tries to copy the CV, so say so instead of letting it
              // surface as an error at the worst moment.
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex flex-col gap-1">
                <p className="font-medium">
                  Your CV file couldn&apos;t be found.
                </p>
                <p>
                  A CV is recorded on your account but the file isn&apos;t
                  there. Please upload it again below, otherwise submitting a
                  proposal will fail.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {uploadedAt
                  ? `Last uploaded ${formatLongDate(pacificDateOf(uploadedAt))}.`
                  : "A CV is on file."}
              </p>
            )}

            <CvUpload userId={userId} initialCvPath={profile.cv_path} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
