import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/profile";
import { formatDate } from "@/lib/cycles";
import { InviteCommitteeForm } from "./invite-form";

type CommitteeMember = {
  id: string;
  full_name: string | null;
  email: string | null;
  invited_at: string | null;
  must_change_password: boolean;
};

export default async function CommitteePage() {
  const { email } = await requireManager();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_committee_members");
  const members = (data as CommitteeMember[] | null) ?? [];

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <Link
            href="/manager"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Manager
          </Link>
          <h1 className="text-2xl font-bold mt-1">Committee members</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Invite a member</CardTitle>
            <CardDescription>
              Creates the account and shows a one-time temporary password to
              deliver out-of-band.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteCommitteeForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Members</CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="text-sm text-red-500">
                Couldn&apos;t load committee members: {error.message}
              </p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No committee members yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="border rounded-md p-3 flex items-center justify-between gap-3"
                  >
                    <div className="text-sm">
                      <div className="font-medium">
                        {m.full_name ?? "(no name)"}
                      </div>
                      <div className="text-muted-foreground">{m.email}</div>
                      <div className="text-xs text-muted-foreground">
                        Invited {formatDate(m.invited_at?.slice(0, 10) ?? null)}
                      </div>
                    </div>
                    {m.must_change_password && (
                      <Badge variant="outline">Password reset pending</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
