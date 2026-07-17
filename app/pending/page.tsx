import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUserAndProfile, homePathForProfile } from "@/lib/auth/profile";
import { CvUpload } from "./cv-upload";

export default async function PendingPage() {
  const { userId, email, profile } = await getUserAndProfile();

  if (!userId) {
    redirect("/auth/login");
  }

  // Server-side routing: send anyone who doesn't belong here to their home.
  const home = homePathForProfile(profile);
  if (home !== "/pending") {
    redirect(home);
  }

  const rejected = profile?.status === "rejected";

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">Registration</CardTitle>
              <Badge variant={rejected ? "destructive" : "secondary"}>
                {rejected ? "Not approved" : "Pending approval"}
              </Badge>
            </div>
            <CardDescription>
              {rejected
                ? "Your registration was not approved. Contact the program manager if you believe this is a mistake."
                : "Your registration is awaiting manager approval. You'll gain access once it's approved."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <span className="text-muted-foreground">Full name</span>
              <span>{profile?.full_name ?? "—"}</span>
              <span className="text-muted-foreground">Institution</span>
              <span>{profile?.institution ?? "—"}</span>
              <span className="text-muted-foreground">Email</span>
              <span>{email ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Curriculum vitae</CardTitle>
            <CardDescription>
              Upload your current CV as a PDF. You can replace it any time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CvUpload userId={userId} initialCvPath={profile?.cv_path ?? null} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
