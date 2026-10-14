# Whiteboards: put a sticky where you want it in its column — Design

Date: 2026-10-14 (Jack: "now let me reorder stickies within a column").

## Design
- **Drag a sticky to a spot**, in its own column or another one, on both whiteboards (Jobs, including Ideas,
  and Opportunities › Pipeline). While dragging, a green line shows the gap it will land in
  (`dropSpot` in `src/core/board.js`, from the pointer's height against the middles of the stickies).
  Dropped on Invoiced, Lost or In Xero under the Jobs board, there is no place to keep.
- **Keyboard**: Alt+↑ / Alt+↓ on a sticky (or a button on it) moves it one place up or down its column.
- **Order**: stickies placed by hand come first, top to bottom; the rest follow in the column's own order
  as before (Jobs: soonest target date; Ideas: won first, then the biggest fee; Pipeline: biggest value).
  A new sticky, or one moved by its button or Move to…, arrives unplaced, so it goes after the placed ones.
- **Shared**: the order is in the database, so Philip and Jack see the same board.

## Where the order is kept
A table of its own, `board_places` (kind, ref_id, col, place): `job` for the Jobs board, `idea` for an
opportunity in its Ideas, `deal` for the Pipeline. Rejected: a column on `jobs` and `opportunities`.
Every update there moves `modified_at`, and a deal's "quiet for 14 days" flag reads it, so tidying the
board would have hidden quiet deals.
- A place counts only in the column it was given in (`col`), so moving a sticky elsewhere needs no
  second write and leaves no stale order behind.
- Placing writes only the places that change (`placeRows`), in one upsert. Rows for a deleted job or
  deal are never matched; nothing cleans them up, and nothing needs to.
- The table is read with the rest of each page; if it can't be read (before the migration has run), the
  columns keep their own order and the boards work as before. If saving a place fails after a move, the
  move stands and a warning says the place wasn't kept.

## Left out
- **Reordering on a phone or iPad**: drag needs a mouse or trackpad there, and Move to… chooses a column,
  not a place. Alt+arrows need a keyboard.
- **Free placement** anywhere on the board (not in a column): the columns are the stages.

## Tests
`tests/jobs.mjs`: placed first, a place from another column ignored, ideas placed over a won one,
`reorder` (top, past the end), `placeRows` writes only changes. `tests/opportunities.mjs`: a deal placed on
top beats a bigger one. `tests/supabase-migration.mjs` checks the new table has RLS and a policy.
Preview (mock data): drag within Quoted to the top and to the bottom (the line shows each time), from In
progress to the top of Quoted, an idea to the top of Ideas, a deal to the top of the Pipeline's Idea
column, Alt+↑ on an idea (focus stays on it); the order holds after Refresh.
