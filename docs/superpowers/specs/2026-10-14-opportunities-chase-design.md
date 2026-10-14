# Opportunities: Chase and Could sell — Design

Date: 2026-10-14 (Jack).

## Why
The Pipeline board read as dead space: 26 of 29 open deals sat in Idea, three in Proposed, one Won, none Lost, so
one long column stood beside three near-empty ones. Most ideas carry no price, so "Open pipeline" said £12/mo.
"Recurring revenue" is a business figure, already on Overview. Jack opens the page for two things: **what to
chase** and **what else we could sell**. The board answers neither at a glance.

Idea holds two kinds of thing, and the data already tells them apart:
- a catalogue product with no one-off and nothing written on it: a gap someone promoted, not yet acted on;
- no product, a one-off fee, a next step or a follow-up date: a real conversation (the same rows Jobs shows as
  ideas via `isJobIdea`).

## Design
Pipeline gets a third view, **Chase**, and opens on it: `[Chase | Board | List]`, last choice remembered per
browser under a new key (`gecko.opp.pipeview`, so a browser that once picked Board still opens on Chase the
first time). Board and List are unchanged.

**Figures** (every tab): Proposed (£/mo, deal count, + one-off) · Could sell (ideas, products, "N need a price")
· Won this month (unchanged). Recurring revenue goes.

**Chase**: one row per deal that needs a person:
- every Proposed deal;
- every Idea with no product, a one-off fee, a next step or a follow-up date;
- every Won deal still to set up (`needsJob` / `needsBilling`).

Order: follow-up due (most days late first) · won to set up · quiet 14+ days (quietest first) · the rest by
£/month then one-off. A row: client (plain text, since the row itself opens the deal), what it is (vendor mark), value, next step, one badge (late /
follow up date / quiet / to set up), and buttons: Draft email, then Proposed (an idea) or Won (proposed), then
Lost; Create job / Billing set up on won deals still to set up. Clicking the row opens the deal pop-up the board uses
(`oppDialog`); next step and follow-up date are set there.

**Could sell**: every other Idea, grouped by product. A group: product name and vendor mark, the client price
(`unit_price` per `price_unit`, or "£X/mo each" from `default_mrr` when there is no client price), how many clients, and the clients as
chips (click opens the deal pop-up). "Draft emails (N)" makes one Outlook draft per client, one after another,
with the existing `draftEmail` (each moves to Proposed, so it leaves the group and appears in Chase). Groups
with more clients first, then by name.

Logic: `chaseView(opps, products, today)` in `src/core/opportunities.js` returns `{ chase, couldSell }`; the
figures come from `pipelineTotals`, extended with Proposed and Could sell counts.

## Failure states
- No deals: the existing "Nothing in the pipeline yet." empty state.
- Load error: the existing error box (unchanged).
- Draft emails for a group: each draft is its own call; a failure stops the run and the toast names the client
  it stopped at, so drafts already made are not made again by a second click (those deals are Proposed now).
- A deal whose product was removed from the catalogue: shown in Chase (treated as no product), never dropped.

## Left out
- A "Log call" button: the pop-up's next step and follow-up date cover it; client Activity is one click away.
- Merging Gaps into Could sell: Gaps answers "who could buy anything", Could sell "what we chose to pitch".
- Pricing ideas from seat counts we don't hold: an unpriced idea says "needs a price", never a guessed figure.

## Unchanged
Board (drag, reorder, touch, click to edit, Maximise), List, Gaps, Prospects, VoIP Unlimited, Products, every
saved field. No migration. `show(tab)` and `open(id)` take the same arguments.

## Testing
`tests/opportunities.mjs`: which deals land in Chase vs Could sell, Chase order, grouping, Proposed / Could sell
totals. Full suite. Browser preview (`hq-preview`): light, dark, 390px.
