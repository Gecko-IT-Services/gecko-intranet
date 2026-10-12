# Atera devices per client

Philip, 10 Oct 2026: picked "Atera devices per client" (with the licence check), to go with the Atera cost check planned
for w/c 12 Oct. API key saved by Philip as the `ATERA_API_KEY` Edge Function secret on 11 Oct. The Atera API is included
in the subscription (no running cost).

## What it shows
- **Monitoring › Devices** (new hub tab): figures (devices with workstations/servers, still on Windows 10, not seen for
  30+ days, customers with devices but no Atera billing this month), then **Needs a look** / **All customers**. A row opens
  the customer's machines (type, OS, Windows 10 badge, last seen) and the Atera lines invoiced to them in Xero this month.
  Refresh runs the sync now; otherwise it runs four times a day (05:43, 11:43, 15:43, 19:43 UTC).
- **Client page › Devices**: that client's machines (servers first), with a summary line; the tab badge says how many are
  still on Windows 10.
- Gecko's own machines (Atera customer "Gecko…") are shown as **Gecko's own** and never flagged as unbilled.
- Read only: the sync makes GET requests to Atera and nothing else; nothing in Gecko HQ writes to Atera.

## Data
- Edge Function `atera-sync` (cron with `x-cron-secret`, or staff) pages through `/api/v3/customers` and `/api/v3/agents`
  (50 per page, `X-API-KEY`), and replaces `atera_customers` / `atera_agents` in one transaction (devices removed in Atera
  leave here too). Status in `atera_status` (last sync, ok, error, counts); a failed sync keeps the previous data and says so
  on the page.
- Atera's agent schema isn't published where we could check it, so every row keeps Atera's full record in `raw` and the
  columns are picked defensively (e.g. last seen from the first of LastSeen / LastSeenDate / … / Modified, recorded in
  `last_seen_field`). After the first real sync the picks are checked against `raw` and the function corrected if needed
  (redeploy only; no schema change).
- Windows 10: OS text says "Windows 10" and isn't a server ("Windows 10.0 Server" is not Windows 10). Microsoft ended
  Windows 10 support on 14 October 2025.
- Atera billing: Xero lines whose item code starts "Atera" (Cloud Backup, Internet Security…) on approved/paid invoices
  this month, per contact, matched to the Atera customer by name (`sameClient`). Most are bundled lines, so this is a £
  figure per client, not seats: it answers "devices in Atera but nothing billed for Atera", which is where the cost check
  starts.

## First live sync (11 Oct 2026)
- Atera's key is a long token (462 characters), not the old 32-character key, and is accepted only as
  `Authorization: Bearer <key>`; `X-API-KEY` gets 401. The function tries `X-API-KEY` first and falls back to Bearer, and
  a refusal message says what kind of key is saved (never the key). 27 customers, 238 devices.
- The agent record has `LastSeen`, `Online`, `OSType` (Work Station / Server…), `OS`, `OSVersion`, `MachineName`,
  `CustomerName`, `LastLoginUser`, `Vendor`, `VendorBrandModel`, `VendorSerialNumber` (all picked correctly), plus hardware,
  Office and disk details kept in `raw`. No antivirus or backup status.
- Atera names that don't match Xero by spelling are linked in `ATERA_NAMES` (`src/core/devices.js`): P&M Packing → PM Packing,
  CD Aluminium → CDA Ltd, Cutler Solutions → Cutler Home Solutions.

## Not done (next)
- The Atera cost check proper: Atera's own monthly bill (SD-Enterprise + AppCenter usage: Acronis, Webroot, Keeper, EndUser
  Remote) per client against Xero, from the per-client breakdown. Needs the bill's per-client figures (feed or upload).
- Antivirus / backup status per device: not in the agents list as far as we know; revisit once `raw` is seen.
- Windows 10 machines as opportunities (device replacement / Windows 11 upgrade) in Opportunities › Gaps.
