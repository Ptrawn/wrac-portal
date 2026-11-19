// SERVER-ONLY. The one entry point the rest of the app uses to send email.
//
// Callers do not know or care which provider is behind this, whether the type
// is switched on, or whether this environment really delivers. They call
// sendEmail() and carry on.
//
// Every email type is either off or automatic -- there is no review queue and
// nothing waits for a human. The manager's only decision is made in advance,
// in email_settings.
//
// THIS FUNCTION NEVER THROWS. An email problem must never break the action that
// triggered it -- a researcher's proposal submits whether or not the
// confirmation goes out. Every failure path returns an outcome and, where it
// can, leaves a row in email_log explaining itself.
//
// All database access here uses the SERVICE-ROLE client: email_log has no
// insert/update policy by design, and a reminder job has no user session at all.
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { ALWAYS_AUTO_KEYS, catalogEntry } from "./catalog";
import { sendViaProvider } from "./provider";
import { renderTemplate } from "./render";

export type SendOutcome =
  | "skipped_off"
  | "duplicate"
  | "logged"
  | "sent"
  | "failed";

export type SendResult = { outcome: SendOutcome; logId?: string };

export type SendEmailInput = {
  /** Catalog key, e.g. 'system_test'. */
  key: string;
  to: string;
  recipientUserId?: string | null;
  vars?: Record<string, string | null | undefined>;
  /**
   * Optional idempotency key. A UNIQUE index backs it, so two concurrent
   * callers cannot both get through.
   */
  dedupeKey?: string | null;
  /** What this email is about, so the log can be filtered by it later. */
  entity?: { type: string; id: string } | null;
  /**
   * A test the manager asked for from the System Email page, sent to their own
   * address. Three deliberate differences from a normal send:
   *
   *   - the mode check is bypassed, so a type can be previewed end to end
   *     before it is switched on;
   *   - any dedupeKey is ignored, so a second test is never "duplicate";
   *   - the subject is prefixed "[TEST] ", so a test can never be mistaken for
   *     the real thing in an inbox or in the log.
   *
   * EMAIL_DELIVERY still decides whether it leaves the building: in log mode a
   * test is logged like anything else.
   */
  test?: boolean;
};

type EmailMode = "off" | "auto";

type LogInsert = {
  email_key: string;
  recipient_email: string;
  recipient_user_id: string | null;
  subject: string;
  body: string;
  status: "sending" | "logged" | "sent" | "failed";
  dedupe_key?: string | null;
  entity_type: string | null;
  entity_id: string | null;
  error?: string | null;
  provider_message_id?: string | null;
  sent_at?: string | null;
};

/** Postgres unique_violation -- the dedupe index did its job. */
const UNIQUE_VIOLATION = "23505";

/** Real delivery is opt-in. Unset, misspelt or anything else means "log". */
function deliveryIsLive(): boolean {
  return process.env.EMAIL_DELIVERY === "live";
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Insert one email_log row. Returns its id, or null if even the logging failed
 * (which must still not throw -- there is nowhere left to report it).
 */
async function writeLog(
  admin: AdminClient,
  row: LogInsert,
): Promise<{ id: string | null; duplicate: boolean }> {
  const { data, error } = await admin
    .from("email_log")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { id: null, duplicate: true };
    return { id: null, duplicate: false };
  }
  return { id: (data as { id: string }).id, duplicate: false };
}

/** The manager's address, used as Reply-To on everything. Null if unreadable. */
async function replyToAddress(admin: AdminClient): Promise<string | null> {
  const { data } = await admin
    .from("email_config")
    .select("manager_notification_address")
    .eq("id", true)
    .single();
  return (
    (data as { manager_notification_address: string } | null)
      ?.manager_notification_address ?? null
  );
}

/**
 * Hand a rendered message to the provider and write the result back onto the
 * 'sending' row created just before this call.
 */
async function deliverAndRecord(
  admin: AdminClient,
  logId: string,
  msg: { to: string; subject: string; text: string; html: string },
): Promise<SendResult> {
  const replyTo = await replyToAddress(admin);
  const result = await sendViaProvider({
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    ...(replyTo ? { replyTo } : {}),
  });

  if (result.ok) {
    await admin
      .from("email_log")
      .update({
        status: "sent",
        provider_message_id: result.messageId,
        sent_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", logId);
    return { outcome: "sent", logId };
  }

  await admin
    .from("email_log")
    .update({ status: "failed", error: result.error })
    .eq("id", logId);
  return { outcome: "failed", logId };
}

/**
 * Send (or log, or skip) one email.
 *
 * The decision order:
 *   unknown key              -> failed
 *   mode 'off' (unless test) -> skipped_off, nothing written
 *   render error             -> failed, with the reason in the log row
 *   dedupe_key already used  -> duplicate, nothing written
 *   mode 'auto', not live    -> logged (rendered, recorded, not sent)
 *   mode 'auto', live        -> sent / failed
 */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const {
    key,
    to,
    recipientUserId = null,
    vars = {},
    dedupeKey = null,
    entity = null,
    test = false,
  } = input;

  // A test must never collide with, or consume, a real send's dedupe key.
  const effectiveDedupeKey = test ? null : dedupeKey;

  const entityType = entity?.type ?? null;
  const entityId = entity?.id ?? null;

  try {
    const admin = createAdminClient();
    const entry = catalogEntry(key);

    // Unknown key: a caller bug. Record it where the manager will see it, but
    // do not carry the dedupe key -- the fixed call must not be blocked later.
    if (!entry) {
      const { id } = await writeLog(admin, {
        email_key: key,
        recipient_email: to,
        recipient_user_id: recipientUserId,
        subject: `[unsent] unknown email type "${key}"`,
        body: `No catalog entry exists for the key "${key}", so nothing could be rendered or sent.`,
        status: "failed",
        entity_type: entityType,
        entity_id: entityId,
        error: `Unknown email key "${key}"`,
      });
      return { outcome: "failed", logId: id ?? undefined };
    }

    // A missing settings row means off: a newly added type stays silent until a
    // manager turns it on. system_test is the deliberate exception -- a test the
    // manager explicitly asked for should not be eaten by a half-set switch.
    let mode: EmailMode = "off";
    let subject = entry.defaultSubject;
    let body = entry.defaultBody;

    const { data: settings } = await admin
      .from("email_settings")
      .select("mode, subject_override, body_override")
      .eq("key", key)
      .maybeSingle();

    if (settings) {
      const row = settings as {
        mode: EmailMode;
        subject_override: string | null;
        body_override: string | null;
      };
      mode = row.mode;
      if (row.subject_override) subject = row.subject_override;
      if (row.body_override) body = row.body_override;
    }
    if (ALWAYS_AUTO_KEYS.includes(key) || test) mode = "auto";

    if (mode === "off") return { outcome: "skipped_off" };

    // Prefix the TEMPLATE, not the rendered line: "[TEST] " carries no braces,
    // so it cannot affect what renderTemplate substitutes, and the log row then
    // stores exactly the subject that was sent.
    if (test) subject = `[TEST] ${subject}`;

    // Render both halves before anything is written or sent.
    const renderedSubject = renderTemplate(
      subject,
      vars,
      entry.allowedPlaceholders,
    );
    const renderedBody = renderTemplate(body, vars, entry.allowedPlaceholders);
    const renderError = !renderedSubject.ok
      ? `Subject: ${renderedSubject.error}`
      : !renderedBody.ok
        ? `Body: ${renderedBody.error}`
        : null;

    if (renderError || !renderedSubject.ok || !renderedBody.ok) {
      // No dedupe_key on a render failure: the template will be corrected and
      // retried, and that retry must not come back as "duplicate".
      const { id } = await writeLog(admin, {
        email_key: key,
        recipient_email: to,
        recipient_user_id: recipientUserId,
        subject: `[unsent] ${entry.label}`,
        body,
        status: "failed",
        entity_type: entityType,
        entity_id: entityId,
        error: renderError ?? "Render failed",
      });
      return { outcome: "failed", logId: id ?? undefined };
    }

    // Already sent once for this key? Nothing to do and nothing to record.
    if (effectiveDedupeKey) {
      const { data: existing } = await admin
        .from("email_log")
        .select("id")
        .eq("dedupe_key", effectiveDedupeKey)
        .maybeSingle();
      if (existing) return { outcome: "duplicate" };
    }

    const base: Omit<LogInsert, "status"> = {
      email_key: key,
      recipient_email: to,
      recipient_user_id: recipientUserId,
      subject: renderedSubject.text,
      body: renderedBody.text,
      dedupe_key: effectiveDedupeKey,
      entity_type: entityType,
      entity_id: entityId,
    };

    // On, but this environment does not deliver: record what would have gone.
    if (!deliveryIsLive()) {
      const { id, duplicate } = await writeLog(admin, {
        ...base,
        status: "logged",
      });
      if (duplicate) return { outcome: "duplicate" };
      if (!id) return { outcome: "failed" };
      return { outcome: "logged", logId: id };
    }

    // On and live. Write the row first so a crash mid-send still leaves a
    // trace, then let the unique index settle any race before we call out.
    const { id, duplicate } = await writeLog(admin, {
      ...base,
      status: "sending",
    });
    if (duplicate) return { outcome: "duplicate" };
    if (!id) return { outcome: "failed" };

    return await deliverAndRecord(admin, id, {
      to,
      subject: renderedSubject.text,
      text: renderedBody.text,
      html: renderedBody.html,
    });
  } catch (err: unknown) {
    // Last resort. Something outside the normal paths broke (no service-role
    // key, database unreachable). Swallow it: the caller's action stands.
    console.error(`[email] sendEmail(${key}) failed:`, message(err));
    return { outcome: "failed" };
  }
}
