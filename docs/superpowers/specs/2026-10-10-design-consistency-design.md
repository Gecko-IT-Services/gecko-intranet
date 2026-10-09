# Design consistency pass

Jack, 10 Oct 2026: "each section should follow the same design principles and features as the rest …
some pages are new and some are old … make sure the app through and through is consistent."

## Why it drifted
- The older sections (inline in `index.html`) each grew a prefixed copy of every part (`prf-refresh`,
  `cli-add-btn`, `lev-iconbtn` …), then several "Phase" override layers patched them towards one look.
- The newer module sections (`src/sections/*.js`) never used the shared parts at all: each defined its
  own pill button (`job-btn`, `opp-btn`, `cl-btn`, `tm-btn`), KPI cards, pills and states.
- Section stylesheets load *before* the inline `<style>`, so the inline layers silently beat them.

## The fix
`src/styles/system.css` loads last and anchors every rule on `#app` (the `<main>`), so it wins over the
per-section ID rules and the light-theme band overrides. Tokens only (they already switch per theme).
New and converted markup uses the shared classes; older sections are unified by grouped selectors there
rather than by rewriting every template.

## The standard (what every section does)
1. **Header**: `.section-head` band; `h1` is two words with the second in `<span>` (green); a `p` only
   when it carries live data (Overview's date, the tax year), never a tagline;
   then a head-actions row: section actions (primary last-but-one), **Refresh** (13px icon + "Refresh",
   default button), then **"Synced HH:MM"** (mono, muted) straight after it. View tabs sit *below* the
   band, never inside it.
2. **Buttons**: `.btn` (34px pill, 13px). `.btn-primary` = ink (one per view). `.btn-ghost` for low
   emphasis, `.btn-danger` = red outline, `.btn-success` = green fill for a positive completion
   ("Mark invoiced"), `.btn-sm` (30px, 12px) inside rows and cards. No bespoke button classes.
3. **Tabs**: `.app-tabs` via `GeckoTabs.tabsHtml` (or `geckoInkify` for older strips).
4. **Figures**: one hairline-divided panel (`gap:1px` on `--hair`), cells on `--card`; label 10px
   small caps muted; value mono 22–24px weight 500, white unless a status colour is the meaning.
5. **Lists/cards**: full 1px `--border-dim`; status by dot, badge or coloured value, never a side stripe.
6. **Badges**: `.badge .badge-{green,amber,red,blue,purple}` for status; mixed-case chips only for
   free-text tags (product names).
7. **Forms**: label 11px `--faint`; inputs 34px, `--inset`, `--radius-sm`. Buttons right-aligned:
   Delete far left (danger), then Cancel, then the primary action last.
8. **States**: loading = "Loading …" text in the empty box (no new skeletons in this pass); empty =
   quiet text on the card; **error = red-tinted box with a red `strong` line and a Retry button**.
   An error never uses the empty look.
9. **Copy**: sentence case for headings, buttons and empty states ("Add client", not "Add Client");
   "…" not "..."; Refresh's title is "Reload"; dates en-GB ("9 Oct 2026"), times 24h.
10. **Tokens**: no literal colours, `999px` → `--radius-pill`, motion on `--ease` / `--dur-*`.
11. **Motion** (second pass, same day): one curve, `--ease` (ease-out quint), three speeds `--dur-1/2/3`
    (120/180/260 ms). Pages rise 6px; hub panes slide 12px; dialogs fade their backdrop and lift the
    panel; toasts rise in and leave faster; every press nudges 1px; `<details>` opens smoothly where
    the browser can size to auto. Data replacing a "Loading…" placeholder fades in (first eight
    staggered 30ms) from one observer in `src/main.js`, so re-renders from filters or typing never
    flash. Everything sits behind `prefers-reduced-motion`. Theme/density changes crossfade with a
    View Transition.
12. **Copy diet** (Jack: "clear and concise … without being bombarded"): no taglines, no text that
    explains the page, restates a heading, names the data source or repeats what a button says.
    Sublines stay only when they carry a fact. Errors, money/safety notes and draft-only warnings stay.

## Non-goals
- No new layout, features or IA changes; the Overview "today" tiles keep their words-not-numbers role.
- Hidden sections (Projects, P&L, Compliance) are aligned through the shared layer but not redesigned.
- Skeleton loading is deferred.
