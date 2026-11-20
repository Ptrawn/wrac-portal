"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  deleteCommitteeMember,
  reissueTemporaryPassword,
  setCommitteeMemberStatus,
} from "./actions";

/**
 * Per-member actions on the committee screen.
 *
 * Confirmation is an INLINE panel rather than window.confirm, matching the
 * house pattern (see reopen-review-button.tsx). It is not decoration: both
 * confirmed actions need a sentence explaining what survives them, and a native
 * confirm box can only show one unformatted line that the manager will learn to
 * click through.
 *
 * Delete is simply ABSENT above zero reviews rather than present-and-disabled.
 * A greyed button invites the manager to go looking for the way to enable it;
 * the review count beside the name already says why there is nothing to click.
 */
export function MemberActions({
  memberId,
  name,
  email,
  isActive,
  reviewsTotal,
}: {
  memberId: string;
  name: string;
  email: string | null;
  isActive: boolean;
  reviewsTotal: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<null | "deactivate" | "delete">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  };

  const deactivate = () =>
    run(() => setCommitteeMemberStatus(memberId, "inactive"));
  const reactivate = () =>
    run(() => setCommitteeMemberStatus(memberId, "approved"));
  const remove = () => run(() => deleteCommitteeMember(memberId));

  const reissue = () => {
    setError(null);
    setTempPassword(null);
    setCopied(false);
    startTransition(async () => {
      const res = await reissueTemporaryPassword(memberId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.tempPassword) {
        setTempPassword(res.tempPassword);
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
    <div className="flex flex-col items-stretch gap-2">
      {tempPassword && (
        <div className="border rounded-md p-3 bg-accent flex flex-col gap-2">
          <p className="text-sm font-medium">
            New temporary password for {email ?? name}
          </p>
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono px-2 py-1 rounded border bg-background break-all">
              {tempPassword}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-destructive">
            This is shown only once. Copy it now and deliver it securely — you
            won&apos;t be able to see it again. Their previous password no
            longer works, and they&apos;ll be asked to set a new one on sign-in.
          </p>
        </div>
      )}

      {confirming === "deactivate" && (
        <div className="border rounded-md p-3 flex flex-col gap-2">
          <p className="text-sm">
            Deactivate <strong>{name}</strong>?
          </p>
          <p className="text-xs text-muted-foreground">
            They lose access immediately and will see a message explaining that
            their committee access has ended. Reviews they already submitted
            stay with their proposals and keep counting toward every score — no
            proposal&apos;s total or average changes. You can reactivate them at
            any time.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={isPending} onClick={deactivate}>
              {isPending ? "Deactivating…" : "Confirm deactivate"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {confirming === "delete" && (
        <div className="border rounded-md p-3 flex flex-col gap-2">
          <p className="text-sm">
            Permanently delete <strong>{name}</strong>
            {email ? ` (${email})` : ""}?
          </p>
          <p className="text-xs text-muted-foreground">
            This removes the account entirely and frees the email address to be
            invited again. It cannot be undone. Only offered because this member
            has no reviews on record — nothing is lost.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={remove}
            >
              {isPending ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {confirming === null && (
        <div className="flex flex-wrap gap-2 justify-end">
          {isActive ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirming("deactivate")}
            >
              Deactivate
            </Button>
          ) : (
            <Button size="sm" disabled={isPending} onClick={reactivate}>
              {isPending ? "Reactivating…" : "Reactivate"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={reissue}
          >
            {isPending ? "Working…" : "Reissue password"}
          </Button>
          {reviewsTotal === 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirming("delete")}
            >
              Delete
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive text-right">{error}</p>}
    </div>
  );
}
