# Timesheets › Log Time: intuitive and robust entry

Philip, 9 Oct 2026: "Improve the timesheets entry process as well please and make it super intuitive + robust."

## What changed
- **Time typed the way people say it**: `1.5`, `1,5`, `1:30`, `1h30`, `1h 30m`, `90m`, `45 mins`, or one tap
  (15m · 30m · 45m · 1h · 1h 30m · 2h). The label says what was read ("= 1h 30m", "rounded to 1h 15m",
  "not recognised"). Time is still saved in quarter hours (nearest quarter).
- **Date shortcuts**: Today · Yesterday · Last working day; the label shows the weekday.
- **SSA preview before saving**: the summary line reads e.g. `Kingdom Products · 1h 30m · Remote Support` and
  `SSA 3h → 1h 30m left` (amber/red when low, "over" when it goes negative).
- **The Billable switch is gone.** It was never saved: every entry counts against the client's balance (the
  "Update Client Balances" flow adds it in Lists; the database balance follows the entry). A switch that
  looked like it stopped that was misleading. Clients without SSA hours say "No SSA hours".
- **Checks before saving** (`src/core/timelog.js` `checkEntry`, tests `tests/timelog.mjs`):
  - stop the save: no client, no engineer, no date, time missing/unreadable/under 15m, more than 12h in one
    entry, no description. The field is outlined and focused.
  - need a second click (**Log anyway**): same engineer + client + day + hours with the same (or no)
    description (a duplicate), a date in the future, more than 31 days back, a weekend, a day total over
    10h, or going over the SSA hours. Changing anything asks again.
- **Robust saving**: one save at a time (double click / Enter can't log twice); the form is only cleared
  once the save is confirmed; a failed save says "Not logged" and keeps the form, then reloads so that if
  the save did reach the server a retry shows as a duplicate; a successful save that can't refresh says so
  instead of reporting a failure (it used to say "Failed to log entry" after a successful save if the
  reload failed). A reload asked for while one is running now runs afterwards instead of being dropped.
- **Draft kept** in this browser (localStorage, 7 days) across reloads, with "Unsaved entry restored · Discard".
- **Faster repeats**: recent clients are one tap; picking a client fills the description suggestions from
  its past entries and its last work type (unless you chose one). After saving, client/engineer/date stay
  for the next entry and the cursor goes to Time spent. Ctrl/⌘+Enter logs from any field.

## Not changed
- Balances, the Lists backup, the flow, and the rule that code creating entries never writes `HoursUsed`.
- The Edit dialog (number input) and the System adjustment dialog.

## Rejected
- Rounding up to the next quarter: not Philip's stated rule; nearest quarter, shown before saving.
- Undo after logging: deleting straight after creation races the Lists flow that adds the hours (~30s).
