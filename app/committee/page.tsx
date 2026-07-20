import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCommittee } from "@/lib/auth/profile";

export default async function CommitteeHomePage() {
  const { email, profile } = await requireCommittee();

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              Committee area
              {profile.full_name ? ` — ${profile.full_name}` : ""}
            </CardTitle>
            <CardDescription>Proposal review coming soon.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You&apos;ll review and score assigned proposals here once a cycle
              reaches its review stage.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
