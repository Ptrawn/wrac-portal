import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Where /auth/confirm sends a failed email-link verification. Supabase's raw
 * message ("Email link is invalid or has expired", "Token has expired or is
 * invalid", ...) is not something to show a program manager, so the common
 * cases are translated and every case offers a way forward.
 */
function humanize(raw: string | undefined): {
  title: string;
  description: string;
  expired: boolean;
} {
  const m = (raw ?? "").toLowerCase();
  if (
    m.includes("expired") ||
    m.includes("invalid") ||
    m.includes("already") ||
    m.includes("no token hash or type")
  ) {
    return {
      title: "This link has expired",
      description:
        "Email links can only be used once, and they expire after a short time. Request a new one and we'll email you another.",
      expired: true,
    };
  }
  return {
    title: "Something went wrong",
    description:
      "We couldn't complete that request. Try again, or request a new email link.",
    expired: false,
  };
}

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { title, description, expired } = humanize(params?.error);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button asChild className="w-full">
          <Link href="/auth/forgot-password">
            {expired ? "Request a new reset link" : "Reset my password"}
          </Link>
        </Button>
        <Link
          href="/auth/login"
          className="text-sm text-center underline underline-offset-4"
        >
          Back to login
        </Link>
        {params?.error && (
          // Kept for support, de-emphasised so it isn't the headline.
          <p className="text-xs text-muted-foreground text-center">
            Details: {params.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <div className="topo-dark flex min-h-svh w-full flex-col items-center justify-center gap-8 bg-wa-black p-6 md:p-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-white.png"
        alt="Washington State Wine"
        className="h-24 w-auto"
      />
      <div className="w-full max-w-sm">
        <Suspense>
          <ErrorContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
