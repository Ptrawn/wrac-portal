import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireManager } from "@/lib/auth/profile";
import { EMAIL_CATALOG, type EmailAudience } from "@/lib/email/catalog";
import { formatPacificDateTime } from "@/lib/email/format";
import { createClient } from "@/lib/supabase/server";
import { ManagerAddressForm } from "./manager-address-form";
import { SendLog } from "./send-log";
import {
  AUDIENCE_HEADINGS,
  AUDIENCE_ORDER,
  HIDDEN_KEYS,
  fetchLogPage,
} from "./shared";
import { TypeToggle } from "./type-toggle";

/** A row stuck here this long means the provider call never came back. */
const STALLED_MINUTES = 10;
/** Older than this, a failure is history rather than something to act on. */
const FAILURE_WINDOW_DAYS = 7;

type SettingsRow = {
  key: string;
  mode: string;
  subject_override: string | null;
  body_override: string | null;
};

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 text-sm " +
        (tone === "warning"
          ? "border-destructive/50 bg-destructive/5 text-foreground"
          : "border-line bg-sunken text-foreground")
      }
    >
      {children}
    </div>
  );
}

export default async function SystemEmailPage() {
  const { email } = await requireManager();
  const supabase = await createClient();

  const managedEntries = EMAIL_CATALOG.filter(
    (e) => !HIDDEN_KEYS.includes(e.key),
  );

  // --- settings + config -----------------------------------------------------
  const { data: configData, error: configError } = await supabase
    .from("email_config")
    .select("manager_notification_address")
    .eq("id", true)
    .maybeSingle();
  const managerAddress =
    (configData as { manager_notification_address: string } | null)
      ?.manager_notification_address ?? "";

  const { data: settingsData, error: settingsError } = await supabase
    .from("email_settings")
    .select("key, mode, subject_override, body_override");
  const settingsByKey = new Map<string, SettingsRow>(
    ((settingsData as SettingsRow[] | null) ?? []).map((r) => [r.key, r]),
  );

  // --- banner reads ----------------------------------------------------------
  const deliveryIsLive = process.env.EMAIL_DELIVERY === "live";
  const stalledSince = new Date(
    Date.now() - STALLED_MINUTES * 60 * 1000,
  ).toISOString();

  const [lastFailedRes, lastSentRes, stalledRes] = await Promise.all([
    supabase
      .from("email_log")
      .select("created_at, error, email_key, recipient_email")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("email_log")
      .select("created_at")
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("email_log")
      .select("id", { count: "exact", head: true })
      .eq("status", "sending")
      .lt("created_at", stalledSince),
  ]);

  const lastFailed = lastFailedRes.data as {
    created_at: string;
    error: string | null;
    email_key: string;
    recipient_email: string;
  } | null;
  const lastSentAt =
    (lastSentRes.data as { created_at: string } | null)?.created_at ?? null;
  const stalledCount = stalledRes.count ?? 0;

  // A failure matters when nothing has succeeded since it, and it is recent
  // enough to still be the current state of affairs.
  const failureIsCurrent =
    lastFailed != null &&
    (lastSentAt == null || lastFailed.created_at > lastSentAt) &&
    Date.now() - new Date(lastFailed.created_at).getTime() <
      FAILURE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // --- per-type last activity ------------------------------------------------
  // One indexed read per type rather than scanning a window of the log: a type
  // that last fired 200 rows ago would otherwise show "never", which is a
  // different and wrong claim.
  const lastActivity = new Map<string, string>();
  await Promise.all(
    managedEntries.map(async (entry) => {
      const { data } = await supabase
        .from("email_log")
        .select("created_at")
        .eq("email_key", entry.key)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const at = (data as { created_at: string } | null)?.created_at;
      if (at) lastActivity.set(entry.key, formatPacificDateTime(at));
    }),
  );

  // --- first page of the log -------------------------------------------------
  const firstPage = await fetchLogPage(supabase);

  const typeLabels: Record<string, string> = {};
  for (const e of EMAIL_CATALOG) typeLabels[e.key] = e.label;

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-4xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <Link
            href="/manager"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← Manager
          </Link>
          <h1 className="text-2xl font-bold mt-1">System Email</h1>
          <p className="text-sm text-muted-foreground">
            Which messages the portal sends, what they say, and what has gone
            out.
          </p>
        </div>

        {/* 1. Delivery status */}
        <div className="flex flex-col gap-2">
          {!deliveryIsLive && (
            <Notice tone="info">
              <strong>Email is in log-only mode.</strong> Messages are recorded
              in the log below but not delivered. (Set{" "}
              <code className="font-mono text-xs">EMAIL_DELIVERY=live</code> in
              Vercel to send.)
            </Notice>
          )}
          {failureIsCurrent && lastFailed && (
            <Notice tone="warning">
              <strong>The most recent send failed.</strong>{" "}
              {formatPacificDateTime(lastFailed.created_at)} —{" "}
              {typeLabels[lastFailed.email_key] ?? lastFailed.email_key} to{" "}
              {lastFailed.recipient_email}.
              <div className="mt-1 font-mono text-xs break-words">
                {lastFailed.error ?? "No reason recorded."}
              </div>
            </Notice>
          )}
          {stalledCount > 0 && (
            <Notice tone="warning">
              <strong>
                {stalledCount} send{stalledCount === 1 ? "" : "s"} may have
                stalled.
              </strong>{" "}
              {stalledCount === 1 ? "A row has" : "Rows have"} been in{" "}
              <em>Sending</em> for more than {STALLED_MINUTES} minutes, which
              means the provider call never came back. Check the log below.
            </Notice>
          )}
        </div>

        {/* 2. Manager address */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Manager address</CardTitle>
            <CardDescription>
              Manager notifications go here, and replies to every portal email
              come here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {configError ? (
              <p className="text-sm text-destructive">
                Couldn&apos;t read the current address: {configError.message}
              </p>
            ) : (
              <ManagerAddressForm current={managerAddress} />
            )}
          </CardContent>
        </Card>

        {/* 3. Email types */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Email types</CardTitle>
            <CardDescription>
              Every type starts off. Turn one on and the portal sends it on the
              triggering action.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {settingsError && (
              <p className="text-sm text-destructive">
                Couldn&apos;t read the on/off settings: {settingsError.message}.
                The switches below may not reflect what is actually stored.
              </p>
            )}
            {AUDIENCE_ORDER.map((audience: EmailAudience) => {
              const entries = managedEntries.filter(
                (e) => e.audience === audience,
              );
              if (entries.length === 0) return null;
              return (
                <section key={audience} className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {AUDIENCE_HEADINGS[audience]}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {entries.map((entry) => {
                      const row = settingsByKey.get(entry.key);
                      const on = row?.mode === "auto";
                      const customized = Boolean(
                        row?.subject_override || row?.body_override,
                      );
                      const last = lastActivity.get(entry.key);
                      return (
                        <li
                          key={entry.key}
                          className="border rounded-md p-3 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="text-sm min-w-0">
                            <div className="font-medium flex flex-wrap items-center gap-2">
                              {entry.label}
                              <Badge variant="outline">
                                {entry.kind === "reminder"
                                  ? "Reminder"
                                  : "Event"}
                              </Badge>
                              {customized && (
                                <Badge variant="secondary">Customized</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {last ? `Last activity ${last}` : "Never sent"}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <TypeToggle
                              emailKey={entry.key}
                              label={entry.label}
                              on={on}
                            />
                            <Button asChild variant="outline" size="sm">
                              {/* The visible word stays "Edit"; the accessible
                                  name carries the type, so six Edit links are
                                  not six identical announcements. It still
                                  STARTS with "Edit", so voice control that
                                  matches the visible label keeps working. */}
                              <Link
                                href={`/manager/emails/${entry.key}`}
                                aria-label={`Edit ${entry.label}`}
                              >
                                Edit
                              </Link>
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </CardContent>
        </Card>

        {/* 4. Send log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Send log</CardTitle>
            <CardDescription>
              Every message the portal has rendered, newest first. Click a row
              to read what was sent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SendLog
              initial={firstPage}
              typeOptions={managedEntries.map((e) => ({
                key: e.key,
                label: e.label,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
