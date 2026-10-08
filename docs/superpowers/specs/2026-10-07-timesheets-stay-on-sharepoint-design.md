# Timesheets and SSA balances: plan for the Supabase move — design

Status: **decided by Philip, 7 Oct 2026** ("yes, keep Timesheets on SharePoint"). Part of `2026-10-07-supabase-migration-design.md` (phase 5).

## Philip's requirement (7 Oct)
"We regularly use the Microsoft Lists Timesheets and want this to be updated as well with
whatever happens in the timesheets in the dashboard. The last thing we want is to add time
entries into the dashboard and it doesn't update the Timesheets list. The app currently
writes to it via Graph and would like to keep that."

## What SharePoint does for Timesheets today
- The dashboard writes each entry to the `Timesheets` list through Graph (create, edit,
  delete, Archive, SSA renewal credits and Undo).
- **Update Client Balances** (Power Automate) adds each new entry's hours to `HoursUsed` on
  the SSA `Clients` list about 30 s later. Its trigger is "When an item is created" only
  (checked 8 Oct), so the dashboard never adds hours for a new entry (Philip's rule, 7 Oct).
  It does adjust `HoursUsed` itself when an entry is edited (by the change in hours) or
  deleted (by its hours), and on Renewal's Undo, because the flow never sees those.
  If the trigger is ever changed to "created or modified", edits would count twice.
- **Create Timesheets Table Email** and **Archive Old Timesheet Entries** also read these lists.
- Philip and Jack read and use the list directly in Microsoft Lists.

## Decision: Timesheets and the SSA `Clients` list stay on SharePoint, as the master
No change to how timesheets are saved. The dashboard keeps writing every entry to the
Timesheets list through Graph exactly as now, the three flows keep running untouched, and
SSA balances keep coming from `HoursUsed`. This is the deliberate exception to the move.

Why:
- It meets the requirement completely: there is only one copy, so it can't be out of date.
- Every SSA rule stays as it is: no balance is copied, recalculated or touched, and the flow
  remains the only thing adding hours. A second copy of the balances is the double-count
  risk that `2026-10-07-ssa-double-count-design.md` already describes.
- Nothing to switch off on a cutover day, and nothing for Jack to change.

What the rest of the dashboard already does with it: Clients and Overview read SSA hours
from the `Clients` list over Graph today and keep doing so. They work alongside the
sections that moved, because those join on client name, not on ids.

## Rejected
- **Supabase as master, also writing each entry to the Timesheets list.** Entries typed
  straight into Microsoft Lists would never reach Supabase; a failure between the two writes
  leaves them disagreeing about an entry, and so about a balance; and the flow would keep
  adding hours in SharePoint while Supabase kept its own count. That is two balances for the
  same client.
- **Moving the flows' logic into Supabase.** It only makes sense if SharePoint stops being the
  master, which Philip doesn't want.

## Optional later: a read-only copy in Supabase
If a report ever needs timesheets in the database (say joined with profitability), add a
**one-way, read-only** copy: SharePoint → Supabase, never back. It would be refreshed by the
daily Claude scheduled task, which already reads Graph and can hold a Supabase secret key
outside the site. It would never be used for balances. Not built until something needs it.

## What's left of the move after this
- **Phase 6, the feed.** `profitability-feed.json` is still a file in SharePoint Documents.
  It can stay there (it works, it is validated, and Profitability writes its Xero totals
  into Supabase), or the scheduled task can write a Supabase row instead. Philip's call;
  there is no technical pressure.
- **Tidy-up.** After about three months on Supabase, the stale SharePoint lists (GeckoLeave*,
  Mileage*, GeckoClients, GeckoServices) can be archived; the ponytail in the main note
  still applies.
