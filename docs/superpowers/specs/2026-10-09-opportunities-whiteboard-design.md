# Opportunities › whiteboard and Gaps map

Jack, 9 Oct 2026: "Now do the same for Opportunities" (after the Jobs whiteboard, `2026-10-09-jobs-whiteboard-design.md`).

## Pipeline: the board is a whiteboard
- Board is now the default view (List remembered if chosen). Columns Idea · Proposed · Won · Lost (won and lost:
  last 90 days, as before), each with £/month, count and any one-off total.
- Deals are the same stickies as Jobs (shared CSS in jobs.css): client, product, next step, £/month (+ one-off),
  follow-up due / quiet badges, "To set up" on won deals still needing a job or billing, tape and initial in the
  owner's colour, the same slight lean.
- **Drag** a deal to another column, or tap its arrow (Proposed →, Won →). Same rules and toasts as the buttons
  (`moveDeal`): Won says what to set up next.
- **Click** a sticky to show the full deal under the board (Draft email, Edit, Won: next steps with Create job and
  Mark done), instead of jumping to the list.

## Gaps: a Map view (Clients | Map)
- A row per client (same order as the cards: most evidence first, then MRR), a column per active product: the
  whitespace grid you would draw on a whiteboard. Cells (`mapCell` in core/opportunities.js, tested):
  ● green = rule and timesheets agree, ● amber = some evidence, ○ = not bought, no evidence (only with "Include
  products they don't buy"), ◆ = in the pipeline, ✓ = won / has it, – = not interested.
- A gap opens that client's card (Clients view); a deal opens it on the pipeline board, picked.
- Nothing is added or changed from the map; the card's buttons do that, as before.
