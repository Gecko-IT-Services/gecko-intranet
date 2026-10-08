# Timesheets › SSA Dashboard

Philip, 9 Oct 2026: "works, now improve the SSA dashboard tab too" (after the Log Time rework).

## What it shows
- **Summary strip**: SSA clients on the programme · hours left across them (and how far any are over) ·
  how many to renew (with how many more are running low) · average hours used per month (last 90 days).
- **Views**: *Needs attention* (over, renew, running low; the default when there are any) and *All*, plus a
  search box.
- **One card per client**, most urgent first: a ring of hours left of hours bought, a status pill
  (Over hours · Renew now · Running low · On track · Not used lately), use per month, when the hours run out
  at that pace ("6 Jan · about 3 months"), the last work logged and by whom, and six months of use.
- **Actions**: Renew… (filled green when the client needs it), Log time (opens Log Time with the client
  chosen), Entries, Adjust…, Archive. The name opens the client's page (so "Jump to Directory" went).

## Rules (`src/core/ssa.js`, tests `tests/ssa.mjs`)
- The balance is shown exactly as Timesheets holds it; nothing is recalculated (Philip's SSA rule).
- Use = work entries in the last 90 days ÷ 3. System entries (renewal credits, adjustments) are not work.
- Status: over (below zero) → renew (under 2h, or under a month at this pace) → low (under 20% of the
  hours bought, or under two months) → on track; "not used lately" when nothing in 90 days.
- Run-out date = today + hours left ÷ use per month. None when there is no recent use or the client is over.

## Not changed
Renew, Adjust, Archive and their flows; the sync banner; archived clients list.
