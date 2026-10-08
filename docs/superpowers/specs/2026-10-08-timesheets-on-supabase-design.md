# Timesheets and SSA balances on Supabase, with Microsoft Lists as the backup — design

Status: **built 8 Oct 2026**, behind `CONFIG.DATA_BACKEND.timesheets` (still `'sharepoint'` until
Philip copies and switches).

## Why (Philip, 8 Oct)
"What currently is not on Supabase… let's do this now… ensure that the logic of the timesheet is
preserved and possibly bettered." Asked how, Philip chose **Supabase as master, with every change
also written to the Microsoft Lists Timesheets list** (over keeping SharePoint as master, or
retiring Lists). On adjustments: "we will need to occasionally make adjustments and when we do the
balance will adjust; all work is accounted in 0.25 chunks."

This reverses the 7 Oct decision to keep Timesheets on SharePoint, on Philip's word. What that
decision protected is kept: the Lists Timesheets list stays complete (the dashboard writes every
change to it), the Power Automate flows keep running on it, and entries made in Lists or the Power
App still count.

## The balance rule (unchanged in spirit: never recalculated from history)
The copy takes each client's Hours Used and Hours Remaining exactly as SharePoint has them
(`opening_used`, `opening_remaining`, `opening_purchased`) and each entry's hours then
(`opening_hours`). After that a balance moves only by what changes:

    change of an entry = (hours if not deleted, else 0) − (opening_hours or 0)
    used      = opening_used + Σ change
    remaining = opening_remaining + (hours_purchased − opening_purchased) − Σ change

So existing balances and past entries are untouched (Philip's 7 Oct rule), historic double counts
stay as they are, and:
- new time adds its hours; a renewal credit (negative) gives hours back, **instantly** (no more
  waiting for the "Update Client Balances" flow before the timesheet email);
- an edit moves the balance by the difference (as the dashboard did);
- a delete takes the entry's hours off; deleting a credit puts its hours back (the old code only
  handled positive entries; Undo had to patch Hours Used by hand);
- an hours change made **in Lists** now moves the balance too (the flow ignores edits; that was
  the "balance doesn't adjust" gap).
Pure logic: `src/core/timesheets.js` (`balances`, `entryChange`), tested in `tests/timesheets.mjs`.

## Quarter hours
New and edited time must be a multiple of 0.25 (Log form, edit, adjustments; and a database check
`timesheet_entries_quarter_hours`). Copied history keeps whatever it had (one entry of 0.1 h would
otherwise block the copy). Credits and adjustments may be negative.

## Adjustments
SSA card › **Adjust…**: give hours back or take them off, in quarter hours, with a reason. Saved as
a System entry "Adjustment – reason", so it appears on the client's timesheet and in Lists like the
renewal credit does, and the Lists flow applies it there too.

## Writing (database first, then Lists exactly as before)
| Action | Database | Lists (backup) |
|---|---|---|
| Log time / credit / adjustment | insert | create item; the flow adds the hours to Hours Used, as always |
| Edit | update | patch the item; Hours Used moved by the difference (as before) |
| Delete | mark deleted (kept for the audit trail and the balance) | delete the item; Hours Used moved by −hours |
| Archive client | update | patch Archived |
If Lists can't be reached the change is saved, marked `pending`/`failed` with the reason and the
Hours Used change still owed (`sp_delta`); the SSA tab says "N changes not yet in the Lists backup",
and the next Refresh sends them. The code still never writes Hours Used for a new entry (the flow
does), so there is no double count.

## Reading back from Lists (each Refresh)
`planSync` brings across: clients added in Lists (their balance then becomes their opening
balance) and changes to the details kept there (name, hours purchased, contact, email, folder,
archived); entries added in Lists or the Power App (counted as new); entries changed in Lists since
last seen (an hours change moves the balance, and Lists' own Hours Used is moved to match). An
entry made here whose copy wasn't confirmed is matched by content, not added twice. Entries **gone**
from Lists are never removed automatically: the SSA tab lists them with "Remove here too" / "Put
back in Lists". Client details (email, contact, folder, hours purchased) are still edited in Lists.

## Cut-over (Philip only, while the flag says `sharepoint`)
Timesheets › **Copy to Supabase**: refuses while any entry is under 3 minutes old (the flow may not
have added it yet), replaces both tables, reads back and checks every entry's fields and every
client's Used and Remaining against SharePoint. Green → copy once more just before switching →
flip `timesheets: 'supabase'`. Verified end to end in a browser against a simulated SharePoint with
the flow: copy, log, quarter-hour refusal, edit, delete, adjustment, Power App entry, Lists down and
back, renewal and Undo; Lists and database balances equal at the end.

## Other readers
Overview (hours KPI, SSA at risk), Clients (SSA hours), Opportunities (SSA contacts, timesheet
signals) and Alerts (client contacts) read through `ssaListItems()`, which returns SharePoint-shaped
items from whichever store the flag names. Settings' backup export still reads the Lists (a full
copy).

## Alert resolutions
`alert_resolutions` replaces the GeckoAlertResolutions list (no list to create by hand any more);
anything already in that list is brought across once (`sharepoint_id`).

## Unchanged
The SharePoint flows (Update Client Balances, Create Timesheets Table Email, Archive Old Timesheet
Entries) keep running on Lists. The Archived flag the archive flow sets comes back into the
database on Refresh. Gecko Docs copies of timesheet emails stay in SharePoint (they are documents).

## Rejected
- Recomputing balances from all entries: would "correct" historic double counts, which Philip ruled
  out on 7 Oct.
- Auto-deleting entries that vanish from Lists: a failed or partial read would wipe real time.
- Retiring Lists: Philip wants it as the backup and the Power App still writes to it.
