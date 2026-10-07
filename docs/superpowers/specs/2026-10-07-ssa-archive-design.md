# Timesheets: archive SSA clients — Design

Date: 2026-10-07. Asked for by Philip: clients no longer on the SSA programme (Connect Data, Solent Rewinds) should be archivable rather than lingering on the SSA cards and in the client picker.

## Design
- **Data.** One Yes/No column `Archived` on the SharePoint **Clients** list (the SSA list). Added by hand, like every list column. Absent → nobody is archived; the page keeps working.
- **Timesheets › SSA tab.** Each card gains an "Archive" link (confirm dialog). Archived clients move to a collapsible "Archived — off the SSA programme (n)" list below the cards, each with "Restore". The list's open/closed state is kept for the session.
- **Timesheets › client picker.** Archived clients are not offered for new entries. Existing entries still resolve their client name (the full list stays in memory).
- **Overview › SSA tile.** Archived clients are excluded from the count and the at-risk list.
- **Clients directory.** Unchanged (reads the same list; the flag is available as `archived` if wanted).
- **Nothing is deleted.** Hours purchased/used, Hours Remaining and every timesheet entry stay as they are; archiving is a view flag. Restore is one click.

## Failure state
If the column is missing, the PATCH fails and the toast says exactly what to add (Yes/No column named "Archived" on the Clients list). The card reverts to its previous state; nothing half-applied.

## Non-goals
- No archive for the Directory's GeckoClients list or Profitability clients; those have their own status (Active / New / Winding Down).
- No automatic archive when hours run out: being out of hours is not the same as being off the programme.

## Deferred (trigger)
- A client-name filter on the Log tab so "View entries" on an archived client shows only theirs. Today it switches to the Log and toasts the name.
