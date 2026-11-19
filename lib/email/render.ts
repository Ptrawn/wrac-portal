// SERVER-ONLY. Turns a template plus variables into the text and HTML that get
// sent. Pure -- no database, no network -- so it is cheap to test and safe to
// call from the manager's template editor for a live preview.
import "server-only";

export type RenderResult =
  | { ok: true; text: string; html: string }
  | { ok: false; error: string };

/** {snake_case} only: a lone brace or {CamelCase} is left alone, not matched. */
const PLACEHOLDER = /\{([a-z0-9_]+)\}/g;

const PORTAL_NAME = "WRAC Research Portal";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Every distinct {placeholder} in a template, in first-seen order. */
function placeholdersIn(template: string): string[] {
  const found: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * Wrap the already-escaped body in a plain branded shell. Deliberately minimal:
 * table-free, inline styles only, no images, no external CSS -- the shapes that
 * survive Outlook and university mail clients intact.
 *
 * There is NO "do not reply" footer: Reply-To points at the program manager, so
 * replying is a supported thing to do.
 */
function wrapHtml(bodyHtml: string): string {
  return [
    '<div style="margin:0;padding:24px;background:#f4f4f5;">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;',
    'border:1px solid #e4e4e7;border-radius:6px;overflow:hidden;">',
    '<div style="padding:16px 24px;background:#1a1a1a;color:#ffffff;',
    'font-family:Helvetica,Arial,sans-serif;font-size:13px;',
    'letter-spacing:0.04em;text-transform:uppercase;">',
    escapeHtml(PORTAL_NAME),
    "</div>",
    '<div style="padding:24px;font-family:Helvetica,Arial,sans-serif;',
    'font-size:15px;line-height:1.5;color:#1a1a1a;">',
    bodyHtml,
    "</div>",
    "</div>",
    "</div>",
  ].join("");
}

/**
 * Substitute {placeholders} in `template` from `vars`.
 *
 * Two deliberate failure modes, both of which return an error rather than
 * sending something wrong:
 *
 *   1. A placeholder the type does not declare -- usually a typo in the
 *      manager's edited copy ({deadlne}). Naming it is what makes the editor's
 *      check useful.
 *   2. A declared placeholder with no value supplied. Sending a researcher a
 *      literal "{deadline}" is worse than sending nothing, so this is an error,
 *      not a silent blank.
 *
 * An empty string IS a value and renders as empty; only undefined/null fail.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
  allowedPlaceholders: string[],
): RenderResult {
  const used = placeholdersIn(template);

  const unknown = used.filter((p) => !allowedPlaceholders.includes(p));
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `Unknown placeholder {${unknown[0]}}. ` +
        (allowedPlaceholders.length > 0
          ? `This email type allows: ${allowedPlaceholders
              .map((p) => `{${p}}`)
              .join(", ")}.`
          : "This email type allows no placeholders."),
    };
  }

  const missing = used.filter(
    (p) => vars[p] === undefined || vars[p] === null,
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `No value supplied for {${missing[0]}}.`,
    };
  }

  const text = template.replace(PLACEHOLDER, (_m, name: string) =>
    String(vars[name]),
  );

  // Escape FIRST, then substitute line breaks, so a value containing "<" can
  // never introduce markup and the <br> tags we add are the only ones present.
  const html = wrapHtml(escapeHtml(text).replace(/\r?\n/g, "<br>"));

  return { ok: true, text, html };
}
