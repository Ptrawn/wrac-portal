import type { Profile } from "@/lib/auth/profile";

/**
 * Role-appropriate user guides.
 *
 * MECHANISM: the PDFs are static files in /public/guides. They're small
 * (6-23 KB), non-confidential "how to use the portal" instructions, and serving
 * them statically means no signed-URL round trip and no extra infrastructure.
 *
 * Replacing a guide today = drop a new PDF at the same path and deploy. If the
 * manager should be able to swap them herself without a deploy, the upgrade is
 * the same shape as the per-cycle proposal template: a private 'guides' bucket
 * plus a pointer, with `guideForRole` resolving to a signed URL instead of a
 * static path. That swap is contained entirely in this file.
 */

export type Guide = {
  /** Where the file is served from. */
  href: string;
  /** What the link/button says. */
  label: string;
  /** Who it's written for, for the help page heading. */
  audience: string;
};

const MANAGER_GUIDE: Guide = {
  href: "/guides/wrac-manager-guide.pdf",
  label: "Program Manager guide",
  audience: "program manager",
};

const RESEARCHER_GUIDE: Guide = {
  href: "/guides/wrac-researcher-guide.pdf",
  label: "Researcher guide",
  audience: "researcher",
};

const COMMITTEE_GUIDE: Guide = {
  href: "/guides/wrac-committee-guide.pdf",
  label: "Committee member guide",
  audience: "committee member",
};

/**
 * TEMPORARY: the bundled PDFs predate fiscal years, proposal serial numbers, the
 * WSU ARC fund, selective review participation, the lifecycle corrections and
 * the report dashboard. Until regenerated guides are dropped in, the help page
 * says so rather than silently handing users stale instructions.
 *
 * TO REMOVE THE NOTICE: set this to false. That's the only change needed.
 */
export const GUIDES_MAY_BE_STALE = true;

/**
 * The guide for a profile. Falls back to the researcher guide for a pending or
 * profile-less user, since that's who they are on the way in.
 */
export function guideForRole(profile: Profile | null): Guide {
  if (profile?.role === "manager") return MANAGER_GUIDE;
  if (profile?.role === "committee") return COMMITTEE_GUIDE;
  return RESEARCHER_GUIDE;
}
