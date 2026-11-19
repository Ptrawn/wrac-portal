// SERVER-ONLY. The ONLY file in the codebase that imports @sendgrid/mail.
// Everything else goes through sendEmail() in ./send. Swapping provider means
// rewriting this file and nothing else -- keep it that way.
import "server-only";

import sgMail from "@sendgrid/mail";

export type ProviderResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

export type ProviderMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

/**
 * Best-effort message for an unknown throw. SendGrid surfaces the useful detail
 * in response.body.errors, not in err.message ("Bad Request" on its own tells
 * nobody anything), so dig that out when it is there.
 */
function describe(err: unknown): string {
  if (err && typeof err === "object") {
    const body = (err as { response?: { body?: unknown } }).response?.body;
    if (body && typeof body === "object") {
      const errors = (body as { errors?: { message?: string; field?: string }[] })
        .errors;
      if (Array.isArray(errors) && errors.length > 0) {
        return errors
          .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
          .filter(Boolean)
          .join("; ");
      }
    }
  }
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown provider error";
}

/**
 * Hand one message to SendGrid.
 *
 * NEVER THROWS. Every failure -- missing config, network, rejected address --
 * comes back as { ok: false, error }, because no email problem may break the
 * user action that triggered it.
 *
 * This function does not decide WHETHER to send. sendEmail() has already
 * checked the per-type mode and EMAIL_DELIVERY before calling here.
 */
export async function sendViaProvider(
  message: ProviderMessage,
): Promise<ProviderResult> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME;

  if (!apiKey) return { ok: false, error: "SENDGRID_API_KEY is not set" };
  if (!from) return { ok: false, error: "EMAIL_FROM is not set" };

  try {
    sgMail.setApiKey(apiKey);

    const [response] = await sgMail.send({
      to: message.to,
      from: fromName ? { email: from, name: fromName } : from,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      text: message.text,
      html: message.html,
      // Click tracking rewrites every link through sendgrid.net. For mail going
      // to university systems that reads as a phishing redirect and hurts both
      // deliverability and trust, so it is off on every message.
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
      },
    });

    const messageId =
      (response?.headers as Record<string, string> | undefined)?.[
        "x-message-id"
      ] ?? null;
    return { ok: true, messageId };
  } catch (err: unknown) {
    return { ok: false, error: describe(err) };
  }
}
