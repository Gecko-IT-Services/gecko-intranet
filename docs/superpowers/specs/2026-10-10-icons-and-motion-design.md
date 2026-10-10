# Icons and motion: one set, one weight, one clock

Jack, 10 Oct 2026: "make sure the icons and animations in the app are up to scratch everywhere and
are consistent." Follows the design consistency pass of the same day (`2026-10-10-design-consistency-design.md`).

## What was measured (every section and tab, computed styles, before)
- **Icons.** One family already (Feather outlines, 24 grid), but drawn at ten size/stroke pairs: the
  line came out anywhere from 0.92px to 1.5px on screen. Clients and Team shared the same sidebar
  icon. Three different pencils and four different bins did the same two jobs. Row actions were
  11, 12, 13 and 14px in four tables, with two different hover looks.
- **Characters standing in for icons.** `☎ ⚠ ↗ ↙` (an iPhone draws these as colour emoji), `✓ ✕ ▸ ‹ ›`
  and a typed "+" in front of button labels. The newer sections had no icons on "add" buttons; the
  older ones did.
- **Motion.** The newer parts ran on `--ease` and `--dur-1/2/3`. The older sections still had 41
  hard-coded timings (`.15s ease`, `.2s ease`, `.25s ease`, `.4s ease`) and 20 `transition: all`.
  Timesheets and Mileage tabs faded where every other tab strip slides. Bars grew over 600ms in
  three sections and 260ms in two.

## The standard
1. **One set**: `src/core/icons.js` (`icon(name, size)`; classic script: `gkIcon(name, size)`).
   Icons written straight into `index.html`'s markup stay there (no build step) and follow the same rules.
2. **One line weight**: `system.css` §9 sets the stroke in screen pixels (1.5px,
   `vector-effect: non-scaling-stroke`), so an icon is the same weight at any size. The
   `stroke-width` attribute on each `<svg>` is only the fallback if the stylesheet is missing.
3. **Three sizes**: 16 navigation and toasts · 14 in buttons and row actions · 12 chevrons and marks
   inside text. (Sort carets 9, the hamburger 18: one-offs.)
4. **Never a text character for an icon.** Kept as text on purpose: `→` at the end of a link-like
   label ("Open →"), `▲ ▼` beside a change figure, and the Gaps map's `● ○ ◆ –` notation.
5. **Buttons that open a "new thing" form carry the plus** (Add client, Add a job, New opportunity,
   Add contact, Add prospect, Add service, the board's Add / Idea). Submit buttons do not.
6. **Row actions** (edit, delete, save, cancel) are one 30px square in every table: neutral hover,
   red only for the one that destroys.
7. **Motion tokens only.** `--dur-1/2/3` (120/180/260ms) on `--ease`; `--t-ui` is the hover/press
   transition for any control (the six properties that change, never `all`); `--dur-chart` (600ms)
   is for bars and meters filling. `tests/icons.mjs` fails on a hard-coded transition time.
8. **Every tab strip slides** its new panel in from the side its tab is on (Timesheets and Mileage
   now do, via `geckoShowPane`). Every press nudges 1px, now including row actions, chips, month
   and week arrows.

## Removed
The old toast keyframes and each section's own copy of the Refresh spin rule (`system.css` owns both).

## Non-goals
- No new animation. Nothing moves that did not move before, except the two tab strips brought into line.
- No icon library or sprite sheet: 11 icons in a 30-line module is the whole need.
- Emoji-safe glyph swap only where a character was acting as an icon; arrows inside sentences stay.
- Skeleton loading is still deferred (as in the consistency pass).

## Checked
Preview with mock data: all 35 section/tab views, light and dark, 1280px and 390px. After: icons
render at 9/12/14/16px, all at 1.5px; every transition and animation resolves to the shared curve at
120/180/260ms (600ms for charts); no text-glyph icons; Refresh spins in all 11 sections; no
sideways scroll at 390px. Not checked on a real iPhone.
