# Design system — WA Wine research funding portal

Internal tool, industry-facing, must read as Washington State Wine Commission.
This is the Commission's own portal, so it carries the **official WA Wine logo**
(supplied in `docs/`, used verbatim — see Assets). Palette, typography and
textures below come from the **Washington Wine Brand Guidelines v5.2021** (the
public PDF at washingtonwine.org). Everything in `css/tokens.css` is the source
of truth — read tokens from there, never hardcode a hex value in a component,
and do not introduce a hue that is not in this file.

## The look in one paragraph

Stark black and white, one red accent, hard edges, slab-serif headlines in caps,
and a faint topographic contour texture in the background. The brand is
deliberately austere — it distinguishes itself from other wine regions by
*refusing* the warm-cream-and-gold wine cliché. Resist the urge to soften it
with rounded corners, drop shadows, gradients or a second accent colour. The
discipline is the brand.

## Colour

| Token | Hex | Source | Use |
|---|---|---|---|
| `--wa-black` | `#000000` | Rich Black | Text, table header rules, inverse surfaces |
| `--wa-white` | `#ffffff` | White | Card surfaces |
| `--wa-red` | `#d1412b` | PMS 179 | **The only accent.** Primary buttons, active nav, eyebrows |
| `--wa-grey` | `#4d4d4f` | PMS 446 | Secondary text, labels |
| `--wa-grey-light` | `#adafb1` | PMS Cool Grey 7 | Borders, dividers, disabled — **never text** (2.2:1) |

Neutral surfaces (`--surface-page` `#f2f2f3`, `--surface-sunken` `#e7e7e9`,
`--border` `#d6d7d9`) are tints of Cool Grey 7, so they add no new hue.

### Status colours

A proposal pipeline needs more than one accent, so status draws on the
Commission's own programme palettes rather than inventing colours:

| Status | Token | Hex | Source |
|---|---|---|---|
| Draft | `--status-draft` | `#adafb1` | Cool Grey 7 |
| Submitted | `--status-submitted` | `#000000` | Rich Black |
| Under review | `--status-review` | `#8a541f` | PMS 153, Road Trip |
| Funded | `--status-funded` | `#5c6c22` | PMS 583 (WAVE), darkened to 5.8:1 |
| Declined | `--status-declined` | `#d1412b` | PMS 179 |

`#a0ba3e` is the true WAVE green but only hits 2.2:1 on white — use it as a
fill with black text, and use `--wa-wave-ink` when green needs to be text.

### Two contrast traps

1. **Brand red passes on white (4.66:1) but fails on the page grey (4.17:1).**
   Red text belongs on white cards only. On the grey page background, use red as
   a *fill* with white text.
2. Red is both the brand accent and the natural error colour. Don't invent a
   second red to resolve that — instead never signal an error with colour alone.
   Every error and declined state carries an icon and a text label, so the
   overlap costs nothing.

## Typography

Two families, from the guidelines:

- **Arvo** (Google Fonts, 400/700) — all headings. The guidelines require **all
  caps whenever Arvo is used as a headline face**, so `h1`/`h2` are uppercased
  with `0.04em` tracking. Arvo is a slab serif and gets heavy in long runs; keep
  it to headings and card titles. (The logo is the official WA Wine asset — do
  not set the logo in Arvo or any webfont; it ships as artwork.)
- **Arial** — body, UI, forms, table cells. The guidelines name Arial explicitly
  for digital applications, so this is on-brand, not a fallback.
- A mono stack (`--font-data`) with `tabular-nums` for dollar amounts, acreage
  and dates. Apply via `.num`. Funding figures must align in columns.

**Veneer** is the brand's display face for print headlines and pulled quotes.
It is a licensed distressed face with no webfont — do not attempt it in the
browser and do not substitute a lookalike. Arvo Bold caps is the sanctioned
digital stand-in.

Scale runs 12 / 13 / 15 / 17 / 20 / 26 / 34 px (`--fs-xs` … `--fs-3xl`), tuned
dense for a data-heavy internal tool. Body at 15px, table cells at 13px.

## Texture

Two textures, both named in the guidelines.

**7 Hills topographic** — `texture-topo-dark.svg` / `texture-topo-light.svg`,
a 480px tile of contour lines that repeats seamlessly in both axes. This is a
procedurally generated stand-in for the Commission's asset, in the same idiom;
if you get the official texture file, drop it in with the same filenames.
Apply with the `.topo-dark` / `.topo-light` classes, which paint it on a
`::before` at 8–10% opacity.

**Distressed grain** — inline in `--texture-grain` as an `feTurbulence` data
URI, 3.5% opacity, multiply blend. Costs no HTTP request.

Rules: texture is atmosphere, never content. Use it on the login screen, the
app header/sidebar, empty states and print headers. Never behind body copy,
form fields or table rows. Never above 0.10 opacity. Never both textures on the
same surface.

## Geometry, elevation, motion

`--radius: 0` for cards, tables and panels; `--radius-sm: 2px` is the ceiling,
for buttons and inputs. Separate surfaces with 1px `--border` rules rather than
shadows — the brand is flat. One shadow token, `--shadow-overlay`, for modals
and dropdowns only. Motion is functional: 120–160ms on hover and focus, nothing
decorative, and `prefers-reduced-motion` is already handled in `tokens.css`.

## Assets

| File | Use |
|---|---|
| `logo.svg` | The official Washington State Wine Commission logo, for light surfaces (white and light grey) |
| `logo-white.svg` | Official logo, white/reversed variant, for dark surfaces — the app header and login screen |
| `favicon.svg` | Modern browsers |
| `favicon.ico` | 16/32/48px, legacy |
| `favicon-32.png` | Fallback |
| `apple-touch-icon.png` | 180px |
| `texture-topo-dark.svg` / `texture-topo-light.svg` | Background tiles |

### The logo is the official WA Wine Commission asset

This is the Commission's own portal, built for the Washington State Wine
Commission, so the app uses the **official WA Wine logo** as its mark. The
source asset lives in `docs/` and is copied verbatim into `public/brand/` — it
is used as-is, never recreated, redrawn, recoloured, stretched, or otherwise
modified, per the Commission's brand guidelines ("the logo should never be
modified or appended"). If only a single-colour or single-orientation asset is
supplied, use it on every surface rather than editing it to fit; adjust the
surface (e.g. give it a white or black plate) instead of altering the logo.

Pick the variant by surface: `logo.svg` on white and light grey,
`logo-white.svg` (the official reversed/white version) on black or red. If the
Commission supplies only one variant, place it on a surface with adequate
contrast rather than producing a new colour treatment. **`currentColor` does not
cross the `<img>` boundary** — reference the logo with `<img src>` and do not try
to recolour it via CSS.

Maintain clear space around the logo and a sensible minimum size per the
Commission's guidelines; when in doubt, give it more room, not less.

### Favicon

A full horizontal logo will not reduce legibly to 16–32px. Derive the favicon
from the logo's **standalone mark/icon element** if the official asset includes
one (many brand kits ship a separate icon lockup for exactly this). If the
supplied asset is a wordmark-only lockup with no standalone mark, do NOT crop or
redraw it into one — instead use a simple, neutral monogram or the mark element
only if the Commission provides it, and flag that a proper favicon asset should
be requested from them. The favicon must not be a distorted squeeze of the full
logo.

## Next.js wiring

Copy assets to `public/brand/`, then in `app/layout.tsx`:

```tsx
export const metadata = {
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32" },
    ],
    shortcut: "/brand/favicon.ico",
    apple: "/brand/apple-touch-icon.png",
  },
  themeColor: "#000000",
};
```

Import `tokens.css` once in the root layout, above any component styles. The
texture URLs in `tokens.css` assume `/brand/`; change them if you use a
different public path.

### Tailwind v4

```css
@import "tailwindcss";
@import "./tokens.css";

@theme inline {
  --color-black: var(--wa-black);
  --color-white: var(--wa-white);
  --color-accent: var(--wa-red);
  --color-ink: var(--text);
  --color-ink-secondary: var(--text-secondary);
  --color-ink-muted: var(--text-muted);
  --color-page: var(--surface-page);
  --color-card: var(--surface-card);
  --color-sunken: var(--surface-sunken);
  --color-line: var(--border);
  --color-line-strong: var(--border-strong);
  --color-status-review: var(--status-review);
  --color-status-funded: var(--status-funded);
  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-data: var(--font-data);
  --radius-none: 0;
}
```

Then `bg-page`, `text-ink-muted`, `border-line`, `font-display` and so on.

## Accessibility floor

AA contrast on all text (the palette above is pre-checked), visible red focus
rings on every interactive element, keyboard-reachable tables and forms, status
never conveyed by colour alone, responsive to 375px, reduced motion respected.
