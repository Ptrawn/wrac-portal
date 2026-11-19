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
//
// WRITING THE COPY. Three rules the defaults follow:
//   1. Only placeholders the hook can ALWAYS fill. renderTemplate refuses to
//      send a body with a missing value, so an optional field in the default
//      copy would turn into a silent failure the day it is null. Where a value
//      is nullable in the schema, the hook substitutes a readable phrase.
//   2. Every body ends with the portal link. These emails are notices, not
//      conversations; the useful thing is a way in.
//   3. No "do not reply" line. Reply-To is the program manager's address, so a
//      reply reaches a person.
import "server-only";

import { portalUrl } from "./format";

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
  /**
   * A realistic value for every allowed placeholder, used by the manager's
   * preview and by "send test to me". It has to cover allowedPlaceholders
   * exactly: a placeholder with no sample renders as the error "No value
   * supplied for {x}", which is what the manager would see instead of a
   * preview. That self-reports, so this is not separately enforced here.
   */
  sampleVars: Record<string, string>;
  /** Days before the deadline to send. Reminder kinds only. */
  defaultReminderOffsets?: number[];
};

/**
 * The pool the per-type samples are drawn from, so the same placeholder reads
 * the same way in every preview. Dates are pre-formatted the way
 * formatPacificDate renders them, since that is what the hooks pass in.
 */
const SAMPLE_VALUES = {
  recipient_email: "manager@example.org",
  recipient_name: "Dr. Sam Reviewer",
  researcher_name: "Dr. Jane Sample",
  proposal_title: "Powdery mildew resistance in Washington Riesling",
  proposal_type: "full proposal",
  cycle_name: "FY28 Research Cycle",
  serial_number: "FY28-007",
  stage_label: "Full proposal review",
  review_due_date: "15 March 2027",
  project_title: "Deficit irrigation in Red Mountain Cabernet",
  report_type: "status",
  portal_url: portalUrl(),
} as const;

/** Sample values for the named placeholders, in the order given. */
function samples(
  ...names: (keyof typeof SAMPLE_VALUES)[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) out[n] = SAMPLE_VALUES[n];
  return out;
}

/**
 * BATCH 2: the six event-triggered types, plus the batch-1 self-test. The
 * deadline reminders (scope doc section 8) are still to come and need a
 * scheduler, which does not exist yet.
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
    sampleVars: samples("recipient_email"),
  },

  // --------------------------------------------------------------------------
  // Researcher
  // --------------------------------------------------------------------------
  {
    key: "researcher_approved",
    label: "Researcher account approved",
    audience: "researcher",
    kind: "event",
    defaultSubject: "Your WRAC portal account has been approved",
    defaultBody: [
      "Hello {researcher_name},",
      "",
      "Your account on the Washington State Wine Commission research portal has been approved. You can now sign in to see open funding cycles and submit a proposal.",
      "",
      "Sign in: {portal_url}",
    ].join("\n"),
    allowedPlaceholders: ["researcher_name", "portal_url"],
    sampleVars: samples("researcher_name", "portal_url"),
  },
  {
    key: "proposal_submitted",
    label: "Proposal submitted (confirmation to researcher)",
    audience: "researcher",
    kind: "event",
    defaultSubject: "Proposal received: {proposal_title}",
    defaultBody: [
      "Hello {researcher_name},",
      "",
      "We have received your {proposal_type} for {cycle_name}.",
      "",
      "Title: {proposal_title}",
      "Reference: {serial_number}",
      "",
      "Nothing further is needed from you now. You will hear from the Research Advisory Committee once your submission has been reviewed.",
      "",
      "View your submission: {portal_url}",
    ].join("\n"),
    allowedPlaceholders: [
      "researcher_name",
      "proposal_title",
      "proposal_type",
      "cycle_name",
      "serial_number",
      "portal_url",
    ],
    sampleVars: samples(
      "researcher_name",
      "proposal_title",
      "proposal_type",
      "cycle_name",
      "serial_number",
      "portal_url",
    ),
  },
  {
    key: "invitation_withdrawn",
    label: "Full-proposal invitation withdrawn",
    audience: "researcher",
    kind: "event",
    defaultSubject: "Invitation withdrawn: {proposal_title}",
    defaultBody: [
      "Hello {researcher_name},",
      "",
      "The invitation to submit a proposal for {proposal_title} in {cycle_name} has been withdrawn, and that draft is no longer available in the portal.",
      "",
      "If this is unexpected, reply to this message and the program manager will follow up.",
      "",
      "Portal: {portal_url}",
    ].join("\n"),
    allowedPlaceholders: [
      "researcher_name",
      "proposal_title",
      "cycle_name",
      "portal_url",
    ],
    sampleVars: samples(
      "researcher_name",
      "proposal_title",
      "cycle_name",
      "portal_url",
    ),
  },

  // --------------------------------------------------------------------------
  // Committee
  // --------------------------------------------------------------------------
  {
    key: "review_stage_opened",
    label: "Review stage opened (to committee)",
    audience: "committee",
    kind: "event",
    defaultSubject: "{stage_label} is open for {cycle_name}",
    defaultBody: [
      "Hello {recipient_name},",
      "",
      "{stage_label} is now open for {cycle_name}. Please read and score each proposal in your review queue.",
      "",
      "Reviews are due by {review_due_date}.",
      "",
      "Start reviewing: {portal_url}",
    ].join("\n"),
    allowedPlaceholders: [
      "recipient_name",
      "cycle_name",
      "stage_label",
      "review_due_date",
      "portal_url",
    ],
    sampleVars: samples(
      "recipient_name",
      "cycle_name",
      "stage_label",
      "review_due_date",
      "portal_url",
    ),
  },

  // --------------------------------------------------------------------------
  // Manager
  // --------------------------------------------------------------------------
  {
    key: "proposal_rescinded",
    label: "Proposal withdrawn by researcher (to manager)",
    audience: "manager",
    kind: "event",
    defaultSubject: "Proposal withdrawn: {proposal_title}",
    defaultBody: [
      "{researcher_name} has withdrawn a proposal from {cycle_name}.",
      "",
      "Title: {proposal_title}",
      "",
      "The proposal and its history stay on file, and the withdrawal can be reversed in the portal if it was a mistake.",
      "",
      "Open the portal: {portal_url}",
    ].join("\n"),
    allowedPlaceholders: [
      "researcher_name",
      "proposal_title",
      "cycle_name",
      "portal_url",
    ],
    sampleVars: samples(
      "researcher_name",
      "proposal_title",
      "cycle_name",
      "portal_url",
    ),
  },
  {
    key: "report_submitted",
    label: "Report submitted (to manager)",
    audience: "manager",
    kind: "event",
    defaultSubject: "New {report_type} report submitted: {project_title}",
    defaultBody: [
      "{researcher_name} has submitted a {report_type} report.",
      "",
      "Project: {project_title}",
      "",
      "Read it in the portal: {portal_url}",
    ].join("\n"),
    allowedPlaceholders: [
      "researcher_name",
      "project_title",
      "report_type",
      "portal_url",
    ],
    sampleVars: samples(
      "researcher_name",
      "project_title",
      "report_type",
      "portal_url",
    ),
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
