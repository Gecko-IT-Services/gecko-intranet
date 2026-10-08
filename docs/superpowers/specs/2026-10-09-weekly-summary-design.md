# Timesheets › Weekly Summary

Philip, 9 Oct 2026: "now improve the weekly summary tab too" (after Log Time and the SSA Dashboard).

Before: every week ever, stacked, each with per-engineer and per-client totals as plain rows.

## Now
- **One week at a time**, opening on this week: ‹ › (or the arrow keys) to move, "This week" to come back;
  the next arrow stops at this week.
- **Totals**: hours logged with the change against the week before; Philip and Jack each with days logged and
  their share; number of clients and the biggest.
- **By day**: Monday–Sunday bars stacked by engineer (Philip green, Jack blue), hours on top, today marked,
  days still to come hatched. Underneath, weekdays up to today with nothing logged per engineer, worded
  neutrally ("leave, or time still to log"): Timesheets doesn't know about leave.
- **By client** (names open the client page) and **by work type**, as bars split by engineer.
- **Last 8 weeks**: totals, the open week highlighted; click a week to open it. The trend runs to this week
  unless the open week is older than that.
- **Entries**: the week's entries grouped by day with day totals (engineer, client, description, work type, hours).

## Rules (`src/core/weekly.js`, tests `tests/weekly.mjs`)
- Work only: System entries (renewal credits, adjustments) and non-positive hours are not counted.
- Weeks run Monday to Sunday. Entries without a work type show as "No work type" (older Power App rows).
- Read-only; nothing here changes entries or balances.
