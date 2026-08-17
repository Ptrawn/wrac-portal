"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";
import { createClient } from "@/lib/supabase/client";

export function ChangePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      const { error: rpcError } = await supabase.rpc(
        "clear_must_change_password",
      );
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      // Root dispatcher routes to the (now-unblocked) role home.
      router.replace("/");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <PasswordInput
          id="confirm"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
