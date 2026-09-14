/**
 * How users reach the program manager. The single definition of the address:
 * the header's help link and the help page both build from it, so the visible
 * address and every mailto href can't drift apart.
 *
 * The subject is fixed so she can identify and filter these messages, and it is
 * encoded rather than hand-escaped (it contains an em dash).
 */
export const MANAGER_EMAIL = "JTarara@washingtonwine.org";

export const MANAGER_MAILTO = `mailto:${MANAGER_EMAIL}?subject=${encodeURIComponent(
  "WRAC Research Portal — help request",
)}`;
