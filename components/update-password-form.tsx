"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";

type LinkState = "checking" | "valid" | "invalid";

/**
 * Sets a new password at the end of the reset-by-email flow.
 *
 * The recovery link signs the user in before landing here, so an absent session
 * means the link expired or was already used -- we say so plainly and offer a
 * fresh reset instead of failing on submit with "Auth session missing!".
 *
 * On success we also clear must_change_password: someone who arrived with a
 * temporary password has just chosen a real one, so the forced-change gate is
 * satisfied and shouldn't ask them again. Routing then goes through the root
 * dispatcher (`/`), which sends each role to its own home.
 */
export function UpdatePasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const router = useRouter();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    (async () => {
      // A recovery link returns the session in the URL fragment. Apply it
      // EXPLICITLY: if this browser already holds a session for someone else,
      // that session would otherwise win and updateUser would change the WRONG
      // account's password. setSession replaces it with the link's account.
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const linkError = params.get("error_description") ?? params.get("error");

      if (linkError) {
        if (active) setLinkState("invalid");
        return;
      }

      if (accessToken && refreshToken) {
        const { data, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        // Don't leave the tokens sitting in the URL / browser history.
        window.history.replaceState(null, "", window.location.pathname);
        if (!active) return;
        if (sessionError || !data.user) {
          setLinkState("invalid");
          return;
        }
        setAccountEmail(data.user.email ?? null);
        setLinkState("valid");
        return;
      }

      // No fragment: either the token_hash flow already established the session
      // server-side via /auth/confirm, or there's no recovery session at all.
      const { data, error: userError } = await supabase.auth.getUser();
      if (!active) return;
      if (userError || !data?.user) {
        setLinkState("invalid");
        return;
      }
      setAccountEmail(data.user.email ?? null);
      setLinkState("valid");
    })();

    return () => {
      active = false;
    };
  }, []);

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
      // A completed reset also satisfies a forced temporary-password change.
      await supabase.rpc("clear_must_change_password");
      // Root dispatcher routes to the correct role home.
      router.replace("/");
      router.refresh();
    });
  };

  if (linkState === "checking") {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Set a new password</CardTitle>
            <CardDescription>Checking your reset link…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (linkState === "invalid") {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">This link has expired</CardTitle>
            <CardDescription>
              Password reset links can only be used once, and they expire after a
              short time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Request a new link and we&apos;ll email you another one.
            </p>
            <Button asChild className="w-full">
              <Link href="/auth/forgot-password">Request a new reset link</Link>
            </Button>
            <Link
              href="/auth/login"
              className="text-sm text-center underline underline-offset-4"
            >
              Back to login
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>
            {accountEmail ? (
              <>
                Setting a new password for{" "}
                <span className="font-medium">{accountEmail}</span>. You&apos;ll
                be signed in straight away.
              </>
            ) : (
              <>
                Choose a new password for your account. You&apos;ll be signed in
                straight away.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">New password</Label>
              <PasswordInput
                id="password"
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
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
                placeholder="Re-enter your new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Saving…" : "Save new password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
