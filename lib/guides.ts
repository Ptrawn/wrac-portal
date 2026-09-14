import type { Profile } from "@/lib/auth/profile";

/**
 * Role-appropriate user guides.
 *
 * MECHANISM: the PDFs are static files in /public/guides. They're small
 * (6-23 KB) "how to use the portal" instructions, and serving them statically
 * means no signed-URL round trip and no extra infrastructure.
 *
 * NOTE: anything under /public is fetchable by anyone with the URL. The Program
 * Manager guide is therefore NOT served here -- the current version contains a
 * table of live account credentials, so it was removed from /public rather than
 * left publicly retrievable. Its `href` is null and the help page explains how
 * to get it instead.
 *
 * Replacing a guide = add the new PDF, point its href below at it, and delete
 * the old file. Filenames carry the guide's date, so the served version is
 * obvious from the URL and a downloaded copy keeps it. When all
 * three guides are regenerated without credentials, we decide then whether to
 * keep serving from /public or move to a private 'guides' bucket (same shape as
 * the per-cycle proposal template: bucket + pointer + signed URL). Either way
 * `guideForRole` stays the single swap point.
 */

export type Guide = {
  /** Where the file is served from, or null when it isn't served in-app. */
  href: string | null;
  /** What the link/button says. */
  label: string;
  /** Who it's written for, for the help page heading. */
  audience: string;
  /**
   * Whether the guide predates features now in the portal. When true the help
   * page shows a "being updated" notice instead of silently handing out stale
   * instructions. Per guide, so a rewritten guide can drop the notice while an
   * older one keeps it.
   */
  mayBeStale: boolean;
};

const MANAGER_GUIDE: Guide = {
  // Deliberately not served: the current PDF lists live account credentials and
  // /public is world-readable. Restore a path here once it's regenerated clean.
  href: null,
  label: "Program Manager guide",
  audience: "program manager",
  // Not yet rewritten: predates the ARC fund, the second status report, batch
  // report requests, allocation grouping and the report dashboard.
  mayBeStale: true,
};

const RESEARCHER_GUIDE: Guide = {
  href: "/guides/WRAC-Researcher-Guide-9.14.26.pdf",
  label: "Researcher guide",
  audience: "researcher",
  mayBeStale: false,
};

const COMMITTEE_GUIDE: Guide = {
  href: "/guides/WRAC-Committee-Guide-9.14.26.pdf",
  label: "Committee member guide",
  audience: "committee member",
  mayBeStale: false,
};

/**
 * The guide for a profile. Falls back to the researcher guide for a pending or
 * profile-less user, since that's who they are on the way in.
 */
export function guideForRole(profile: Profile | null): Guide {
  if (profile?.role === "manager") return MANAGER_GUIDE;
  if (profile?.role === "committee") return COMMITTEE_GUIDE;
  return RESEARCHER_GUIDE;
}
