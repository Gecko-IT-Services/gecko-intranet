# Team and Leave as a wall planner

Jack, 9 Oct 2026: Team › Overview and Leave "could be so much better, be adventurous".

## Idea
A two-person firm tracks holiday on a year planner on the office wall. Both pages now borrow it.

- **Leave › Year planner** replaces the month calendar: the tax year (April → March) on one screen, a row
  per month, a column per day (1–31), a lane per person (Philip, then Jack). Leave is a sticker in the
  person's colour (Philip blue, Jack purple, as before); requested leave is hatched; a sticker opens the
  edit dialog. ‹ › in the header steps tax years (was months).
- **Click to book**: a day on a lane you may book (Philip: both, Jack: his own) starts a range, a second
  click ends it (either order); the booking form under the planner fills in and the estimate updates.
  The date inputs remain the keyboard route; cells are not focusable (744 of them).
- **Holiday left as day tokens** (`tokensHtml`, core/team.js): one pill per day of entitlement, spent →
  requested → left, filled bottom-up so half days read as half pills; days beyond the entitlement are red.
  Same on both pages, replacing the ring (Team) and the four-number strip in hours (Leave). Days lead;
  hours stay as a small figure on Leave because that is what is stored.
- **Team cards lead with status**: "Away · back Tue 13 Oct" + the leave's note, or "In today" + next leave.
  Hours this week and mileage to claim sit in one hairline panel. "Next four weeks" is a strip of the same
  planner (labelled stickers, weekends shaded, today marked) and links to the year planner.

## Logic
`bars(requests, from, to)` (core/team.js) clips live leave to a window; the Team strip and every planner
month use it. Leave reaches core/team.js through `window.GeckoTeam` (main.js). Tests: tests/team.mjs.

## Rejected / deferred
- Drag to select: two clicks work on touch and mouse alike, with no drag state.
- Bank holidays on the planner: not stored anywhere yet.
- Days 1–5 April of the following year belong to this tax year but appear on the next year's planner.

## Phone
Planner cells shrink to fit (no sideways scroll); stickers lose their labels; header shows 1/10/20/30.
Stickers opt out of the 44px touch floor (they would cover the next month); each is a full-size row in
Leave requests. The Team strip fits too, numbering Mondays only.
