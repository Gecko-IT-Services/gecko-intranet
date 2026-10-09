# Retro gecko art on loading, empty and error states — Design

Date: 2026-10-09 (Jack supplied five 8-bit gecko illustrations: "use these as empty or loading states
where appropriate").

## Art (src/assets/retro, 240px PNG, ~12 KB each; prompts in generation-prompts.json for more in the same style)
| File | Used for | Class |
|---|---|---|
| loading.png (gecko on a server) | a section's first load | `art art-loading` (hops 4px, two steps; still with reduced motion) |
| empty.png (empty folder) | nothing here yet | `art art-empty` |
| no-results.png (magnifying glass) | nothing matches a search/filter; no client chosen | `art art-none` |
| offline.png (unplugged cable) | could not load / connect to the database | `art art-offline` |
| all-clear.png (the mascot) | nothing needs you | `art art-clear` |

One rule in `src/styles/system.css`: the picture is the state box's `::before`, so the markup only gains
two classes and the text stays the accessible content.

## Where
Page-level states only: Overview (first load, could not load, connect, "Nothing needs you right now"),
Profitability and the Directory (first load, could not load via `sectionErrorHtml`, no clients, no
matches), Jobs, Opportunities (and Prospects), Team, Leave, Mileage journeys, Timesheets (no SSA clients,
could not load), a client page, Backups, Alerts ("Nothing needs attention").
Not on small inline states ("None" in a board column, a form's own error): a picture there is clutter.

## Rules kept
Error boxes stay red: the cable gecko never makes an error look like an empty state.
Jobs no longer shows "Needs Xero" in its figures while it is still loading (the strip is hidden until
the data is in).
