# Timesheets: stop counting portal entries twice against SSA hours — Design

Date: 2026-10-07. Found while preparing the SSA renewal button.

## What was wrong
Two things add a new entry's hours to the client's `HoursUsed` on the **Clients** list:
1. A SharePoint flow on the **Timesheets** list. It runs about 30 seconds after any entry
   is created (as Philip), whether the entry came from the Power App, SharePoint or the portal.
   It is also what applies the System credit entries (−10 / −20) on renewal.
2. The portal's `tshAddEntry`, which PATCHed `HoursUsed` itself straight after creating the entry.

So every billable entry logged in the portal was counted twice. Evidence: the version history of
each Clients item shows, for every portal-created entry (`AppAuthorLookupId` 27), one increase by the
person logging it within ~1s of `Created`, then the same increase again by the flow ~32s later.
Entries created outside the portal show only the flow's increase. First portal entry: 22 May 2026.

## Change
`tshAddEntry` no longer writes `HoursUsed`; the flow does it. The "now negative" warning uses the
balance the flow is about to produce. The page refresh straight after logging can show the old
balance for up to ~30s; Refresh catches up.

Edit and delete still adjust `HoursUsed` from the portal: the version history shows the flow does
not react to edits (an entry edited from 0.25h to 1h on 5 Oct produced no Clients change).

## Not changed here (Philip to decide)
- Correcting the balances already affected. Per-client over-deduction measured from version history
  totals about 90 hours across 18 clients; the correction is a business decision, not a code change.
- The "Billable" toggle. The flow counts every entry regardless, so unticking it has never stopped
  hours counting (e.g. entry 767, 9 Jun: portal added 0, flow added 0.25). Needs a decision on what
  non-billable should mean before the toggle is changed or removed.
