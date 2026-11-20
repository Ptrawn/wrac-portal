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
import { formatLongDate } from "@/lib/cycles";
import { InviteCommitteeForm } from "./invite-form";
import { MemberActions } from "./member-actions";

type CommitteeMember = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string;
  invited_at: string | null;
  last_sign_in_at: string | null;
  must_change_password: boolean;
  reviews_total: number;
  reviews_submitted: number;
};

export default async function CommitteePage() {
  const { email } = await requireManager();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_committee_members");
  const members = (data as CommitteeMember[] | null) ?? [];

  // 'approved' is the only active state; anything else (today, 'inactive') is a
  // former member. Written as "not approved" rather than "=== 'inactive'" so a
  // row that somehow carries another status still lands on the safe side.
  const active = members.filter((m) => m.status === "approved");
  const former = members.filter((m) => m.status !== "approved");

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
            <CardDescription>
              Active members can open the review workspace and are counted in
              review progress and reminder emails.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="text-sm text-destructive">
                Couldn&apos;t load committee members: {error.message}
              </p>
            ) : active.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active committee members.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {active.map((m) => (
                  <MemberRow key={m.id} member={m} isActive />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {former.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Former members</CardTitle>
              <CardDescription>
                No access to the portal. Their submitted reviews are kept and
                still count toward the proposals they scored.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {former.map((m) => (
                  <MemberRow key={m.id} member={m} isActive={false} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

function MemberRow({
  member,
  isActive,
}: {
  member: CommitteeMember;
  isActive: boolean;
}) {
  const name = member.full_name ?? "(no name)";

  return (
    <li className="border rounded-md p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="text-sm min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          <Badge variant={isActive ? "secondary" : "outline"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
          {member.must_change_password && (
            <Badge variant="outline">Password reset pending</Badge>
          )}
        </div>
        <div className="text-muted-foreground break-all">{member.email}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Invited {formatLongDate(member.invited_at)}
          {" · "}
          {member.last_sign_in_at
            ? `Last signed in ${formatLongDate(member.last_sign_in_at)}`
            : "Never signed in"}
          {" · "}
          {member.reviews_submitted === 1
            ? "1 review submitted"
            : `${member.reviews_submitted} reviews submitted`}
        </div>
      </div>
      <div className="sm:shrink-0 sm:max-w-sm w-full sm:w-auto">
        <MemberActions
          memberId={member.id}
          name={name}
          email={member.email}
          isActive={isActive}
          reviewsTotal={member.reviews_total}
        />
      </div>
    </li>
  );
}
