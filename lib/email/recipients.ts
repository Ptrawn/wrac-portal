// SERVER-ONLY. Who an email goes to.
//
// Addresses live in auth.users, NOT in public.profiles, so every lookup here
// needs the service-role client: profiles supplies the name, auth.users the
// address. These run inside after() callbacks, where there is no user session
// to borrow, which is the other reason they are service-role.
//
// NOTHING HERE THROWS. A lookup that fails returns null (or an empty list) and
// the caller simply sends nothing -- an email must never break the action that
// triggered it, and that promise has to hold at this layer too.
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type UserContact = {
  email: string;
  /** profiles.full_name, which is nullable. Callers need a fallback. */
  fullName: string | null;
};

export type CommitteeContact = UserContact & { userId: string };

export type PendingResearcherContact = CommitteeContact & {
  /** profiles.institution, nullable. Callers need a fallback phrase. */
  institution: string | null;
};

/** Address + name for one user, or null if either lookup fails. */
export async function getUserContact(
  userId: string,
): Promise<UserContact | null> {
  try {
    const admin = createAdminClient();

    const { data: authData, error: authError } =
      await admin.auth.admin.getUserById(userId);
    const email = authData?.user?.email ?? null;
    if (authError || !email) return null;

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    return {
      email,
      fullName: (profile as { full_name: string | null } | null)?.full_name ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Every committee member who can actually review: role 'committee' AND status
 * 'approved'. An invited-but-not-yet-approved member is deliberately excluded,
 * since they cannot open the review workspace yet.
 *
 * One auth lookup per member. The committee is a dozen people at most, so this
 * is cheaper and more exact than paging listUsers() and hoping the page is big
 * enough. A member whose auth row has no address is skipped, not fatal.
 */
export async function getApprovedCommitteeContacts(): Promise<
  CommitteeContact[]
> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name")
      .eq("role", "committee")
      .eq("status", "approved");
    if (error || !data) return [];

    const rows = data as { id: string; full_name: string | null }[];
    const resolved = await Promise.all(
      rows.map(async (row) => {
        const { data: authData } = await admin.auth.admin.getUserById(row.id);
        const email = authData?.user?.email ?? null;
        return email
          ? { userId: row.id, email, fullName: row.full_name }
          : null;
      }),
    );

    return resolved.filter((c): c is CommitteeContact => c !== null);
  } catch {
    return [];
  }
}

/**
 * Every researcher waiting on the manager's decision: role 'researcher' AND
 * status 'pending'. 'rejected' is a decision already taken and is excluded.
 *
 * The address is fetched per row, as in getApprovedCommitteeContacts, and a row
 * whose auth user has no address is skipped. Unlike the committee, this list is
 * unbounded in principle -- but the sweep that uses it only ever mails the
 * MANAGER, once per researcher, deduped forever, so a long list costs lookups
 * rather than a flood of email. The address is carried because it is the
 * fallback when a registration has no full_name yet.
 */
export async function getPendingResearcherContacts(): Promise<
  PendingResearcherContact[]
> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name, institution")
      .eq("role", "researcher")
      .eq("status", "pending");
    if (error || !data) return [];

    const rows = data as {
      id: string;
      full_name: string | null;
      institution: string | null;
    }[];
    const resolved = await Promise.all(
      rows.map(async (row) => {
        const { data: authData } = await admin.auth.admin.getUserById(row.id);
        const email = authData?.user?.email ?? null;
        return email
          ? {
              userId: row.id,
              email,
              fullName: row.full_name,
              institution: row.institution,
            }
          : null;
      }),
    );

    return resolved.filter((c): c is PendingResearcherContact => c !== null);
  } catch {
    return [];
  }
}

/**
 * The address manager-audience email goes to, from email_config. Null when the
 * row is missing or unreadable -- in which case the caller sends nothing rather
 * than guessing at an address.
 */
export async function getManagerNotificationAddress(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("email_config")
      .select("manager_notification_address")
      .eq("id", true)
      .maybeSingle();
    return (
      (data as { manager_notification_address: string } | null)
        ?.manager_notification_address ?? null
    );
  } catch {
    return null;
  }
}
