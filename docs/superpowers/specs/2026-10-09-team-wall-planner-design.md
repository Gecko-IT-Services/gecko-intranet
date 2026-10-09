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

## Mileage, the same way (9 Oct)
- **Driver cards** (replacing the four figures + unclaimed band): what each driver is owed leads (amber, or
  "All claimed"), with trips and the oldest unclaimed date; **Email my claim** sits on your own card (it left
  the header). Below, **the road**: this tax year's miles on a 0 → 10,000 track (HMRC's limit for the higher
  rate), claimed solid, unclaimed hatched, dashed centre line, and the miles left at the higher rate.
- Figures: total paid and due, still to claim, Corp. tax saving (same all-time numbers as before).
- Add journey: the six most-driven-to destinations as one-tap chips (client + miles); fields in one row.
- Monthly summary: the tax year as twelve columns (miles, Philip/Jack stacked, £ under each) and one table
  of months (journeys, each driver £ and miles, total, still to claim) replacing a card per month.
- Fixed 9 Oct (Jack: "it should be per tax year"): `milRecomputeAll` counts the 10,000 miles per driver per tax
  year (it counted across all journeys). Checked against all 74 journeys: no amount or rate changed.

## Timesheets, the same way (9 Oct)
- **Time card** at the top of Log time: the week Mon–Sun, a lane per engineer, each day's hours filling its
  cell towards a 7-hour day (Leave's standard day), days off from Leave hatched amber ("Off"), weekdays
  already past with nothing logged outlined dashed amber, a week total per engineer, ‹ › for other weeks.
  **Clicking a cell sets the form's engineer and date** and puts you in Client. Uses GeckoWeekly.weekSummary
  (same numbers as Weekly summary; System credits excluded) and GeckoTeam.bars. Leave is read from the
  database on Refresh; if it fails the card says "Days off not shown: …" rather than showing none.
- **SSA cards**: the ring becomes the figure (hours left, green / amber / red by status) and a row of hour
  tokens, one per prepaid hour (used → left; over-used hours red). `tokensHtml` takes `{ unit, noun }`.
  Balances are shown exactly as held (Philip's rule); nothing is recalculated.
- Person colours in Timesheets now match Team, Leave and Mileage: Philip blue, Jack purple (they were
  green and blue in Weekly summary and the entry pills).
- On a phone the card's cells show decimal hours ("1.5"); full text is in each cell's label.

## Overview, the same way (9 Oct)
- Today › **This week** is a strip of the planner: Mon–Sun, a lane each for Philip and Jack (hours logged that
  day filling the cell, or "Off" from Leave, weekdays already past with nothing logged outlined), then
  **Jobs** (count on the target day; late ones on today, red) and **Invoices** (repeating invoices on the day
  Xero raises them, £). A lane with nothing this week is left out and the note says so. Lane totals on the
  right replace the hours bars; "Next: Jack off 16–18 Oct" carries leave beyond Sunday; the named lists of
  jobs due and repeating invoices stay underneath.
- This week (review tab): hours bars in each person's colour.
