// SERVER-ONLY. The registry of email types.
//
// This is the single source of truth for every email the portal can send: its
// key, who it is written for, and the DEFAULT wording. A manager may override
// the subject and body per type in email_settings; a null override there means
// "use what is written here", so editing this file changes the copy for every
// type a manager has not customised.
//
// Adding an entry does NOT start sending it. A type with no email_settings row
// is treated as mode 'off' until a manager turns it on.
import "server-only";

export type EmailAudience = "researcher" | "committee" | "manager";
export type EmailKind = "event" | "reminder";

export type CatalogEntry = {
  /** Stable key. Also the primary key of email_settings. Never rename one. */
  key: string;
  /** Human label for the manager's settings page. */
  label: string;
  audience: EmailAudience;
  /** 'event' fires on an action; 'reminder' fires on a deadline schedule. */
  kind: EmailKind;
  defaultSubject: string;
  defaultBody: string;
  /**
   * Every {placeholder} the subject or body may use. renderTemplate rejects
   * anything outside this list, which is what lets the manager's editor catch
   * a typo like {deadlne} before it reaches a researcher.
   */
  allowedPlaceholders: string[];
  /** Days before the deadline to send. Reminder kinds only. */
  defaultReminderOffsets?: number[];
};

/**
 * BATCH 1 holds exactly one entry: a self-test the manager can fire at their
 * own address to prove the SendGrid path end to end without involving a
 * researcher. The real types (approval, advancement, funding, reminders --
 * see scope doc section 8) arrive in batch 2.
 */
export const EMAIL_CATALOG: CatalogEntry[] = [
  {
    key: "system_test",
    label: "Test email",
    audience: "manager",
    kind: "event",
    defaultSubject: "WRAC portal test email",
    defaultBody:
      "This is a test message from the WRAC Research Portal sent to {recipient_email}.",
    allowedPlaceholders: ["recipient_email"],
  },
];

const BY_KEY = new Map(EMAIL_CATALOG.map((e) => [e.key, e]));

/** The entry for a key, or null when the key is not in the catalog. */
export function catalogEntry(key: string): CatalogEntry | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * The one key that ignores its email_settings mode and always behaves as
 * 'auto'. A test the manager explicitly asked for must not be swallowed by a
 * switch they are in the middle of configuring.
 */
export const ALWAYS_AUTO_KEYS: readonly string[] = ["system_test"];
