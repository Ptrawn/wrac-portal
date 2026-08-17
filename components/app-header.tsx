import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { getUserAndProfile } from "@/lib/auth/profile";
import { guideForRole } from "@/lib/guides";

/**
 * The persistent app chrome. It resolves the signed-in user itself (the lookup
 * is memoised per request, so this costs nothing on top of the page's own
 * guard), which keeps the greeting and the role-appropriate guide link correct
 * everywhere without threading props through every page.
 *
 * `email` is still accepted so the 20-odd existing call sites keep working; the
 * profile is the source of truth for the name.
 */
export async function AppHeader({ email }: { email?: string | null }) {
  const { email: sessionEmail, profile } = await getUserAndProfile();
  const shownEmail = email ?? sessionEmail;
  const name = profile?.full_name?.trim();
  const guide = guideForRole(profile);

  return (
    <nav className="topo-dark w-full border-b border-white/10 bg-wa-black text-wa-white">
      <div className="w-full max-w-5xl mx-auto flex justify-between items-center gap-4 px-5 h-16">
        <div className="flex items-center gap-3">
          {/* Logo links home — "/" dispatches to the role's dashboard. */}
          <Link
            href="/"
            aria-label="Go to your dashboard"
            className="rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-wa-black"
          >
            {/* Official WA Wine logo — used verbatim, reversed variant on dark. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-white.png"
              alt="Washington State Wine"
              className="h-10 w-auto"
            />
          </Link>
          <span className="hidden sm:inline font-display uppercase tracking-[0.04em] text-xs text-white/70 border-l border-white/20 pl-3">
            Research Proposal Portal
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            {/* Greet by name; without a name, greet plainly rather than
                showing an empty or "null" name. */}
            <span className="text-wa-white">
              {name ? `Welcome, ${name}` : "Welcome"}
            </span>
            {shownEmail && (
              <span className="text-white/50 text-xs">{shownEmail}</span>
            )}
          </div>
          <Link
            href="/help"
            className="text-white/80 underline underline-offset-4 hover:text-wa-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-wa-black rounded-sm"
            title={guide.label}
          >
            User guide
          </Link>
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
