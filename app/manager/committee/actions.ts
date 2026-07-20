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
  const supabase = await createClient();

  // Re-verify the caller is a manager (defense in depth; the page also guards).
  const { data: claims } = await supabase.auth.getClaims();
  const managerId = (claims?.claims?.sub as string | undefined) ?? null;
  if (!managerId) return { error: "You're not signed in." };
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", managerId)
    .single();
  if ((me as { role: string } | null)?.role !== "manager") {
    return { error: "Only a manager may invite committee members." };
  }

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
