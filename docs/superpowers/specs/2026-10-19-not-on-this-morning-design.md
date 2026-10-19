# Not on this morning (19 Oct 2026)

## Why
Kelly's PC at Daron Motors (FIPC) sat on a blue screen (INACCESSIBLE_BOOT_DEVICE, 0x7B) on Monday morning and nothing in Gecko HQ
or Atera said so. Philip: "this dashboard should be telling me this". A PC that can't start can't run the Atera agent, so it raises
no alert: Atera just shows it offline, which looks the same as switched off for the weekend. The only sign is silence, so the check
looks for silence that isn't normal.

## What it does
- Monitoring › Devices opens with a **Not on this morning** card; Overview › Today › Needs attention gets the same rows.
- **Servers**: offline in Atera and quiet for an hour, any day, any time → red.
- **PCs**, on a working day (weekdays less England and Wales bank holidays) once it's past the time the PC is normally on
  (its usual first check-in + 45 min, never before 09:00, 09:30 until known): a PC that is usually on and hasn't checked in today.
  "Usually on" = seen on at least 4 of the last 5 working days the record covers fully. Red for desktops, amber for laptops.
- **Learning** (the first five working days, until Mon 26 Oct 2026): no record yet, so any desktop that was on the last working
  day is listed in amber, and Overview shows one line when there are more than three. Laptops wait for the record.
- Each row has the **likely reasons**, most telling first, from what Atera last knew (the PC can't tell us more):
  everything else at the client quiet too (power, internet, office shut); C: drive nearly full; Patch Tuesday updates waiting at
  shut-down (no restart since); went quiet mid-day (crash, power, unplugged); restarted for this month's updates (the rest
  finishes at shut-down); about six or more years old (drive, power supply); laptop (at home, flat battery); simply switched off
  (ask the user, unless it's a shared login); the Atera agent stopped while the PC works.
- Actions: Open in Atera, Add task (reasons in the note), **Known about: hide today** (`device_offline_ok`, until a date), client page.

## Data
- `atera_seen_days` (agent, UK day, first and last seen): Atera keeps no history, so a trigger on `atera_status` writes it after
  every good sync. Kept 70 days. A day with under half the busiest day's devices doesn't count (the day recording began, a day
  syncs failed), so it can't make everyone look absent.
- Extra Atera syncs every half hour on weekday mornings (`atera-sync-mornings`, 07:13–10:43 UTC), so "not on" is known within
  half an hour of the office opening. The Edge Function is unchanged.
- Logic `src/core/offline.js` (tests `tests/offline.mjs`); page `src/sections/devices.js` (`snapshot()` → `GeckoMonitor.devices`).

## Rejected / not done
- Atera's own "agent offline" alerts: Atera only alerts on servers this way, and it would fire every evening for every PC.
- Patch history and disk health (SMART) from Atera: not in the API's agent record. Reasons are inferred from what is there.
- Emailing or texting anyone: the dashboard and Overview are where it is seen (as with tasks).

## Failure states
- Tables missing (before the migration): the card says so; the rest of Devices works.
- Last Atera sync failed: the card is hidden and the sync error shows; Overview leaves it out rather than showing "all on".
- Before 09:30 the card says it's too early for PCs; at weekends, servers only.

ponytail: bank holidays are typed in for 2026–27 (`BANK_HOLIDAYS`).
