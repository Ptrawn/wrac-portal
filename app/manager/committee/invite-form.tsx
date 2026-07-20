"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteCommitteeMember } from "./actions";

export function InviteCommitteeForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTempPassword(null);
    startTransition(async () => {
      const res = await inviteCommitteeMember({
        fullName: fullName.trim(),
        email: email.trim(),
      });
      if (res?.error) {
        setError(res.error);
      } else if (res?.tempPassword) {
        setTempPassword(res.tempPassword);
        setInvitedEmail(email.trim());
        setFullName("");
        setEmail("");
        setCopied(false);
        router.refresh();
      }
    });
  };

  const copy = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {tempPassword && (
        <div className="border rounded-md p-3 bg-accent flex flex-col gap-2">
          <p className="text-sm font-medium">
            Temporary password for {invitedEmail}
          </p>
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono px-2 py-1 rounded border bg-background break-all">
              {tempPassword}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-red-500">
            This is shown only once. Copy it now and deliver it to the member
            securely — you won&apos;t be able to see it again. They&apos;ll be
            asked to set a new password on first sign-in.
          </p>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="full-name">Full name</Label>
          <Input
            id="full-name"
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            placeholder="member@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" size="sm" disabled={isPending} className="w-fit">
          {isPending ? "Inviting…" : "Invite committee member"}
        </Button>
      </form>
    </div>
  );
}
