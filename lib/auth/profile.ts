import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ProfileRole = "researcher" | "committee" | "manager";
export type ProfileStatus = "pending" | "approved" | "rejected";

export type Profile = {
  id: string;
  role: ProfileRole;
  status: ProfileStatus;
  full_name: string | null;
  institution: string | null;
  cv_path: string | null;
  must_change_password: boolean;
};

/**
 * Reads the current authenticated user and their own profile row.
 * Reading one's own row is permitted by the `profiles_select_own` RLS policy.
 * Returns nulls when there is no session (or the profile row isn't present yet).
 */
export async function getUserAndProfile(): Promise<{
  userId: string | null;
  email: string | null;
  profile: Profile | null;
}> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = (claimsData?.claims?.sub as string | undefined) ?? null;
  const email = (claimsData?.claims?.email as string | undefined) ?? null;
  if (!userId) {
    return { userId: null, email: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, role, status, full_name, institution, cv_path, must_change_password",
    )
    .eq("id", userId)
    .single();

  return { userId, email, profile: (profile as Profile | null) ?? null };
}

/**
 * Single source of truth for where an authenticated user belongs, based on
 * their profile. Every protected page redirects here so routing stays
 * consistent and server-enforced.
 *
 * - must_change_password          -> /auth/change-password (gate, overrides all)
 * - manager                       -> /manager
 * - committee                     -> /committee
 * - approved researcher           -> /dashboard
 * - pending / rejected researcher -> /pending
 * - missing profile row           -> /pending (treated as pending)
 */
export function homePathForProfile(profile: Profile | null): string {
  if (!profile) return "/pending";
  // Forced password change takes precedence over every role home.
  if (profile.must_change_password) return "/auth/change-password";
  if (profile.role === "manager") return "/manager";
  if (profile.role === "committee") return "/committee";
  if (profile.role === "researcher" && profile.status === "approved") {
    return "/dashboard";
  }
  return "/pending";
}

/**
 * Guard for manager-only routes. Redirects unauthenticated users to login and
 * bounces non-managers to their own home. Returns the manager's identity on
 * success. Mirrors the inline guard used across /manager pages.
 */
export async function requireManager(): Promise<{
  userId: string;
  email: string | null;
  profile: Profile;
}> {
  const { userId, email, profile } = await getUserAndProfile();
  if (!userId) {
    redirect("/auth/login");
  }
  if (homePathForProfile(profile) !== "/manager") {
    redirect(homePathForProfile(profile));
  }
  // homePathForProfile only returns "/manager" for a manager profile.
  return { userId, email, profile: profile as Profile };
}

/**
 * Guard for approved-researcher routes (/dashboard and below). Redirects
 * unauthenticated users to login and bounces anyone who isn't an approved
 * researcher (managers, pending/rejected) to their own home.
 */
export async function requireApprovedResearcher(): Promise<{
  userId: string;
  email: string | null;
  profile: Profile;
}> {
  const { userId, email, profile } = await getUserAndProfile();
  if (!userId) {
    redirect("/auth/login");
  }
  if (homePathForProfile(profile) !== "/dashboard") {
    redirect(homePathForProfile(profile));
  }
  // homePathForProfile only returns "/dashboard" for an approved researcher.
  return { userId, email, profile: profile as Profile };
}

/**
 * Guard for committee routes (/committee). Redirects unauthenticated users to
 * login and bounces anyone who isn't a committee member to their own home.
 */
export async function requireCommittee(): Promise<{
  userId: string;
  email: string | null;
  profile: Profile;
}> {
  const { userId, email, profile } = await getUserAndProfile();
  if (!userId) {
    redirect("/auth/login");
  }
  if (homePathForProfile(profile) !== "/committee") {
    redirect(homePathForProfile(profile));
  }
  return { userId, email, profile: profile as Profile };
}
