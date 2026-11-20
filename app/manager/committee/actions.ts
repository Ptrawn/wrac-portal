"use server";

import { randomInt } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_";

/** Strong random temporary password (20 chars, mixed classes). */
function generateTempPassword(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CHARSET[randomInt(CHARSET.length)];
  }
  // Guarantee at least one of each class by seeding the first four chars.
  const seeds = "Ab7@";
  return seeds + out.slice(seeds.length);
}

/**
 * Re-verify the caller is a manager and hand back their id.
 *
 * Every action in this file either reaches for the service-role client, which
 * bypasses RLS entirely, or calls an RPC that guards itself. This is the
 * defence-in-depth layer in front of the former: the page guards too, but a
 * server action is its own entry point and must never assume it was reached
 * from the page that renders its button.
 */
async function requireManagerId(): Promise<
  { managerId: string } | { error: string }
> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const managerId = (claims?.claims?.sub as string | undefined) ?? null;
  if (!managerId) return { error: "You're not signed in." };

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", managerId)
    .single();
  if ((me as { role: string } | null)?.role !== "manager") {
    return { error: "Only a manager may manage committee members." };
  }
  return { managerId };
}

/**
 * Invite a committee member: create their auth account with a temporary
 * password (email pre-confirmed), then promote the auto-created profile to an
 * approved committee member who must change their password. Returns the
 * temporary password to display once. Uses the service-role admin client, which
 * bypasses RLS and the self-elevation guard.
 */
export async function inviteCommitteeMember(input: {
  fullName: string;
  email: string;
}): Promise<{ error?: string; tempPassword?: string }> {
  const guard = await requireManagerId();
  if ("error" in guard) return { error: guard.error };
  const { managerId } = guard;

  const fullName = input.fullName.trim();
  const email = input.email.trim();
  if (!fullName || !email) {
    return { error: "Enter a name and email." };
  }

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser(
    {
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    },
  );
  if (createError) {
    if (
      /already|registered|exists|duplicate/i.test(createError.message)
    ) {
      return { error: "An account with that email already exists." };
    }
    return { error: createError.message };
  }
  const newUserId = created.user?.id;
  if (!newUserId) return { error: "Account creation returned no user." };

  // handle_new_user has already created a pending researcher profile; promote it.
  const { error: updateError } = await admin
    .from("profiles")
    .update({
      role: "committee",
      status: "approved",
      must_change_password: true,
      invited_by: managerId,
      invited_at: new Date().toISOString(),
      full_name: fullName,
    })
    .eq("id", newUserId);
  if (updateError) {
    return {
      error: `Account created, but promoting the profile failed: ${updateError.message}`,
    };
  }

  revalidatePath("/manager/committee");
  return { tempPassword };
}

/**
 * Deactivate ('inactive') or reactivate ('approved') a committee member.
 *
 * The session client, not the admin client: set_committee_member_status is
 * SECURITY DEFINER and does its own is_manager check, so the caller's identity
 * is exactly what the database needs to see. Reaching for the service-role
 * client here would throw that check away and replace it with this file's own.
 *
 * The RPC touches status and nothing else -- no review row is read or written,
 * which is what keeps a former member's submitted scores (and every proposal's
 * total and denominator) exactly where they were.
 */
export async function setCommitteeMemberStatus(
  memberId: string,
  status: "approved" | "inactive",
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_committee_member_status", {
    p_target: memberId,
    p_status: status,
  });
  if (error) {
    return { error: error.message || "Couldn't change that member's status." };
  }

  revalidatePath("/manager/committee");
  return { ok: true };
}

/**
 * Permanently delete a committee account.
 *
 * Only ever safe with ZERO review rows. The UI only offers the button at zero,
 * but the count is taken again here because a server action is its own entry
 * point, and because the list the manager is looking at may be seconds stale --
 * a member could have submitted a review between the render and the click.
 *
 * Deleting the AUTH user, not just the profile: profiles.id cascades from
 * auth.users, so this removes both, and it frees the address. Deleting only the
 * profile would leave the email claimed and re-inviting it would fail with
 * "An account with that email already exists" -- which is exactly how the
 * duplicate account this feature exists to clean up came about.
 *
 * Behind both checks the schema has the last word: reviews.reviewer_id is
 * ON DELETE RESTRICT (20260721091640), so a delete that slipped past this guard
 * would be refused by Postgres rather than taking review history with it.
 */
export async function deleteCommitteeMember(
  memberId: string,
): Promise<{ error?: string; ok?: boolean }> {
  const guard = await requireManagerId();
  if ("error" in guard) return { error: guard.error };

  const admin = createAdminClient();

  const { data: profileData, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", memberId)
    .maybeSingle();
  if (profileError) return { error: profileError.message };
  const profile = profileData as { role: string } | null;
  if (!profile) return { error: "That account no longer exists." };
  if (profile.role !== "committee") {
    return { error: "Only a committee member can be deleted here." };
  }

  // Any state counts: a draft review is still a row, and still blocks.
  const { count, error: countError } = await admin
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("reviewer_id", memberId);
  if (countError) return { error: countError.message };
  const reviewCount = count ?? 0;
  if (reviewCount > 0) {
    return {
      error: `This member has ${reviewCount} review${
        reviewCount === 1 ? "" : "s"
      } on record, so the account can't be deleted. Deactivate them instead — their reviews stay with the proposals either way.`,
    };
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(memberId);
  if (deleteError) return { error: deleteError.message };

  revalidatePath("/manager/committee");
  return { ok: true };
}

/**
 * Issue a fresh temporary password for an existing member and require them to
 * change it on next sign-in. For the member who lost theirs, or never used the
 * one from the invitation.
 *
 * Deliberately the same shape as the invite: the same generator, the same
 * must_change_password flag, and the password returned to be shown once and
 * never stored. Nothing here reads or writes a review.
 */
export async function reissueTemporaryPassword(
  memberId: string,
): Promise<{ error?: string; tempPassword?: string }> {
  const guard = await requireManagerId();
  if ("error" in guard) return { error: guard.error };

  const admin = createAdminClient();

  const { data: profileData, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", memberId)
    .maybeSingle();
  if (profileError) return { error: profileError.message };
  const profile = profileData as { role: string } | null;
  if (!profile) return { error: "That account no longer exists." };
  if (profile.role !== "committee") {
    return { error: "Only a committee member's password can be reissued here." };
  }

  const tempPassword = generateTempPassword();

  const { error: passwordError } = await admin.auth.admin.updateUserById(
    memberId,
    { password: tempPassword },
  );
  if (passwordError) return { error: passwordError.message };

  const { error: flagError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", memberId);
  if (flagError) {
    // The password IS changed at this point; say so rather than implying the
    // manager can retry cleanly with the old one still working.
    return {
      error: `The password was reset, but marking the account to change it failed: ${flagError.message}`,
    };
  }

  revalidatePath("/manager/committee");
  return { tempPassword };
}
