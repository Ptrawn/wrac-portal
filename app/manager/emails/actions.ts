"use server";

import { revalidatePath } from "next/cache";

import { getUserAndProfile, homePathForProfile } from "@/lib/auth/profile";
import { catalogEntry } from "@/lib/email/catalog";
import { renderTemplate } from "@/lib/email/render";
import { sendEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { LogPage } from "./log-types";
import { fetchLogPage } from "./shared";

/**
 * Every action here is manager-only.
 *
 * For the three email tables RLS is the real enforcement -- a non-manager's
 * write is refused by Postgres whatever this file does. The guard exists for
 * the one action RLS CANNOT cover: sendTestEmail reaches sendEmail, which uses
 * the service-role client and therefore bypasses RLS entirely. Without this
 * check, any signed-in user could make the portal send mail.
 *
 * It returns a message rather than redirecting, so a stale tab gets a readable
 * refusal instead of being thrown somewhere unexpected mid-edit.
 */
async function requireManagerSession(): Promise<
  { ok: true; userId: string; email: string | null } | { ok: false; error: string }
> {
  const { userId, email, profile } = await getUserAndProfile();
  // homePathForProfile is the app's single source of truth for "where does this
  // profile belong"; only a manager profile maps to /manager.
  if (!userId || homePathForProfile(profile) !== "/manager") {
    return { ok: false, error: "Only the program manager can do that." };
  }
  return { ok: true, userId, email };
}

type Result = { error?: string; ok?: boolean };

// A deliberately loose check: enough to catch a typo or a pasted name, without
// pretending to validate deliverability. The address is the manager's own and
// they can see what they typed.
const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** email_config.manager_notification_address -- replies and manager notices. */
export async function saveManagerAddress(address: string): Promise<Result> {
  const guard = await requireManagerSession();
  if (!guard.ok) return { error: guard.error };

  const trimmed = address.trim();
  if (!PLAUSIBLE_EMAIL.test(trimmed)) {
    return { error: "That doesn't look like an email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("email_config")
    .update({
      manager_notification_address: trimmed,
      updated_by: guard.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) return { error: error.message };

  revalidatePath("/manager/emails");
  return { ok: true };
}

/**
 * Turn one type on or off.
 *
 * Update-then-insert rather than upsert, because a missing row means "off": the
 * first time a type is switched on there is nothing to update. Doing it in this
 * order also means an existing row keeps its subject/body overrides -- the
 * switch must never quietly discard the manager's edited copy.
 */
export async function setEmailMode(key: string, on: boolean): Promise<Result> {
  const guard = await requireManagerSession();
  if (!guard.ok) return { error: guard.error };
  if (!catalogEntry(key)) return { error: `Unknown email type "${key}".` };

  const supabase = await createClient();
  const mode = on ? "auto" : "off";
  const stamp = { updated_by: guard.userId, updated_at: new Date().toISOString() };

  const { data: updated, error: updateError } = await supabase
    .from("email_settings")
    .update({ mode, ...stamp })
    .eq("key", key)
    .select("key");
  if (updateError) return { error: updateError.message };

  if (!updated || updated.length === 0) {
    const { error: insertError } = await supabase
      .from("email_settings")
      .insert({ key, mode, ...stamp });
    if (insertError) return { error: insertError.message };
  }

  revalidatePath("/manager/emails");
  revalidatePath(`/manager/emails/${key}`);
  return { ok: true };
}

export type PreviewResult =
  | { ok: true; subject: string; bodyText: string; bodyHtml: string }
  | { ok: false; error: string };

/**
 * Render the copy currently in the editor against the type's sample values.
 *
 * This is the SAME renderTemplate the send path uses, with the same allowed
 * placeholder list, which is the point: if the preview renders, the real send
 * renders. A failure here is shown instead of a preview and blocks Save.
 */
export async function previewTemplate(
  key: string,
  subject: string,
  body: string,
): Promise<PreviewResult> {
  const guard = await requireManagerSession();
  if (!guard.ok) return { ok: false, error: guard.error };

  const entry = catalogEntry(key);
  if (!entry) return { ok: false, error: `Unknown email type "${key}".` };

  const s = renderTemplate(subject, entry.sampleVars, entry.allowedPlaceholders);
  if (!s.ok) return { ok: false, error: `Subject: ${s.error}` };
  const b = renderTemplate(body, entry.sampleVars, entry.allowedPlaceholders);
  if (!b.ok) return { ok: false, error: `Body: ${b.error}` };

  return { ok: true, subject: s.text, bodyText: b.text, bodyHtml: b.html };
}

/**
 * Save edited copy for one type.
 *
 * Two rules worth knowing:
 *   1. It is validated server-side with renderTemplate, not just in the editor.
 *      A client that skipped the preview still cannot store copy that would
 *      fail at send time.
 *   2. Text identical to the default is stored as NULL, not as a copy. That is
 *      what lets a later change to the default copy in catalog.ts reach every
 *      type the manager has not actually customised.
 */
export async function saveTemplate(
  key: string,
  subject: string,
  body: string,
): Promise<Result> {
  const guard = await requireManagerSession();
  if (!guard.ok) return { error: guard.error };

  const entry = catalogEntry(key);
  if (!entry) return { error: `Unknown email type "${key}".` };

  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  if (trimmedSubject.length === 0) return { error: "The subject can't be empty." };
  if (trimmedBody.length === 0) return { error: "The body can't be empty." };

  const s = renderTemplate(
    trimmedSubject,
    entry.sampleVars,
    entry.allowedPlaceholders,
  );
  if (!s.ok) return { error: `Subject: ${s.error}` };
  const b = renderTemplate(trimmedBody, entry.sampleVars, entry.allowedPlaceholders);
  if (!b.ok) return { error: `Body: ${b.error}` };

  const subjectOverride =
    trimmedSubject === entry.defaultSubject.trim() ? null : trimmedSubject;
  const bodyOverride =
    trimmedBody === entry.defaultBody.trim() ? null : trimmedBody;

  const error = await writeOverrides(key, subjectOverride, bodyOverride, guard.userId);
  if (error) return { error };

  revalidatePath("/manager/emails");
  revalidatePath(`/manager/emails/${key}`);
  return { ok: true };
}

/** Drop both overrides, so the type falls back to the catalog's default copy. */
export async function resetTemplate(key: string): Promise<Result> {
  const guard = await requireManagerSession();
  if (!guard.ok) return { error: guard.error };
  if (!catalogEntry(key)) return { error: `Unknown email type "${key}".` };

  const error = await writeOverrides(key, null, null, guard.userId);
  if (error) return { error };

  revalidatePath("/manager/emails");
  revalidatePath(`/manager/emails/${key}`);
  return { ok: true };
}

/**
 * Store (or clear) the two override columns, creating the settings row if this
 * type has never been touched. A row created here is 'off' by default: editing
 * the wording must not switch a type on behind the manager's back.
 */
async function writeOverrides(
  key: string,
  subjectOverride: string | null,
  bodyOverride: string | null,
  userId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const payload = {
    subject_override: subjectOverride,
    body_override: bodyOverride,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await supabase
    .from("email_settings")
    .update(payload)
    .eq("key", key)
    .select("key");
  if (updateError) return updateError.message;
  if (updated && updated.length > 0) return null;

  const { error: insertError } = await supabase
    .from("email_settings")
    .insert({ key, mode: "off", ...payload });
  return insertError?.message ?? null;
}

export type TestSendResult = {
  outcome?: string;
  to?: string;
  error?: string;
};

/**
 * Send one test of the CURRENTLY SAVED copy to the manager's own address.
 *
 * sendEmail reads email_settings itself, so this deliberately sends what is
 * stored rather than what is in the editor -- a test confirms what a researcher
 * would actually receive. `test: true` bypasses the on/off switch and the
 * dedupe key; EMAIL_DELIVERY still decides whether it leaves the building.
 */
export async function sendTestEmail(key: string): Promise<TestSendResult> {
  const guard = await requireManagerSession();
  if (!guard.ok) return { error: guard.error };
  if (!guard.email) {
    return { error: "Your account has no email address to send a test to." };
  }

  const entry = catalogEntry(key);
  if (!entry) return { error: `Unknown email type "${key}".` };

  const result = await sendEmail({
    key,
    to: guard.email,
    recipientUserId: guard.userId,
    vars: entry.sampleVars,
    test: true,
  });

  // sendEmail never throws and never returns the reason -- it records it. Read
  // the row it just wrote so the manager sees WHY a test failed, not just that
  // it did. Service-role, because email_log has no insert/update policy and the
  // row may be a render failure the manager's own select would still see; this
  // is a single read by primary key.
  if (result.outcome === "failed") {
    let reason: string | null = null;
    if (result.logId) {
      try {
        const admin = createAdminClient();
        const { data } = await admin
          .from("email_log")
          .select("error")
          .eq("id", result.logId)
          .maybeSingle();
        reason = (data as { error: string | null } | null)?.error ?? null;
      } catch {
        reason = null;
      }
    }
    revalidatePath("/manager/emails");
    return {
      outcome: "failed",
      to: guard.email,
      error: reason ?? "The send failed and left no reason in the log.",
    };
  }

  revalidatePath("/manager/emails");
  return { outcome: result.outcome, to: guard.email };
}

/** One more page of the send log, for the "Load more" button and the filters. */
export async function fetchMoreLog(filters: {
  emailKey?: string | null;
  status?: string | null;
  offset?: number;
}): Promise<LogPage> {
  const guard = await requireManagerSession();
  if (!guard.ok) return { rows: [], hasMore: false, error: guard.error };

  const supabase = await createClient();
  return await fetchLogPage(supabase, filters);
}
