import { redirect } from "next/navigation";

import { getUserAndProfile, homePathForProfile } from "@/lib/auth/profile";

// Root dispatcher: send authenticated users to their role home, everyone else
// to login. No public landing page.
export default async function Home() {
  const { userId, profile } = await getUserAndProfile();
  if (!userId) {
    redirect("/auth/login");
  }
  redirect(homePathForProfile(profile));
}
