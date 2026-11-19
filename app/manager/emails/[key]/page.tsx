import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireManager } from "@/lib/auth/profile";
import { catalogEntry } from "@/lib/email/catalog";
import { createClient } from "@/lib/supabase/server";
import { AUDIENCE_HEADINGS } from "../shared";
import { TemplateEditor } from "./template-editor";

type SettingsRow = {
  mode: string;
  subject_override: string | null;
  body_override: string | null;
};

export default async function EmailTypePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { email } = await requireManager();
  const { key } = await params;

  const entry = catalogEntry(key);
  // A key that is not in the catalog has no copy to edit and no switch to
  // flip -- there is nothing this page could truthfully show.
  if (!entry) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_settings")
    .select("mode, subject_override, body_override")
    .eq("key", key)
    .maybeSingle();
  const row = data as SettingsRow | null;

  const on = row?.mode === "auto";
  const customized = Boolean(row?.subject_override || row?.body_override);

  return (
    <main className="min-h-screen flex flex-col items-center">
      <AppHeader email={email} />
      <div className="w-full max-w-3xl p-5 flex flex-col gap-6 mt-8">
        <div>
          <Link
            href="/manager/emails"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← System Email
          </Link>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <h1 className="text-2xl font-bold">{entry.label}</h1>
            <Badge variant="outline">
              {AUDIENCE_HEADINGS[entry.audience]}
            </Badge>
            <Badge variant="outline">
              {entry.kind === "reminder" ? "Reminder" : "Event"}
            </Badge>
            {customized && <Badge variant="secondary">Customized</Badge>}
            <Badge variant={on ? "default" : "secondary"}>
              {on ? "On" : "Off"}
            </Badge>
          </div>
          {!on && (
            <p className="text-sm text-muted-foreground mt-1">
              This type is switched off, so it is not being sent. You can still
              edit the wording and send yourself a test.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive">
            Couldn&apos;t read the saved copy: {error.message}. The editor below
            is showing the default wording, which may not be what is stored.
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Wording</CardTitle>
            <CardDescription>
              Edit the subject and body. Saving wording identical to the default
              stores nothing, so later changes to the default still reach this
              type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateEditor
              emailKey={entry.key}
              allowedPlaceholders={entry.allowedPlaceholders}
              defaultSubject={entry.defaultSubject}
              defaultBody={entry.defaultBody}
              savedSubject={row?.subject_override ?? null}
              savedBody={row?.body_override ?? null}
              testAddress={email}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
