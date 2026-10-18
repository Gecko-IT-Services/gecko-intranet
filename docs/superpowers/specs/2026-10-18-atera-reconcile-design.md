# Atera reconcile (Clients › Atera)

Philip, 18 Oct 2026: "this is to tie the Acronis, Webroot, Atera, Keeper together with what is being billed, almost like a
reconcile. I need to know the leaks, where the gaps are, what customers use and to get it right between what Atera is
billing me and what we are providing the customers and what we are billing the customers. It should be designed to stop
leaks and if there are gaps to be able to do something about it."

The same day, by hand in each console: 11 dead Webroot devices still billed, two Work from Home devices not billed, MSA
billed for 6 Keeper users with 4 in use, Snowskool billed 9 with 7 in use, Onsite billed Internet Security for 15 with 2
protected, WCF's servers unprotected since April, ~400 GB of stale backups. Each was found by looking; this view finds them.

## The reconcile

Per client, per product, three numbers side by side:

| | Atera bills Gecko | The client uses (live) | Xero bills the client |
|---|---|---|---|
| Backup | Acronis breakdown (per client) | Acronis API: workstations, VMs/servers, M365 seats, GB | repeating invoice lines |
| Antivirus | Webroot total × $1.20 | Webroot API: active endpoints per site | " |
| DNS protection | Webroot DNS total | Webroot API (sites with DNS) | " |
| Work from home | EndUser Remote total × $5 | devices ticked on the page (Atera devices) | " |
| Passwords | Keeper totals by licence | typed per client (only 3 clients) | " |
| Management | 2 technician seats | Atera devices per client | retainer / cloud management lines |

Each row is one of: **Leak** (used, not billed, or billed fewer), **Over-billed** (billed more than used: the client is
paying for dead devices; a fairness and churn risk), **No margin** (billed below cost), **Dead device** (in the vendor and
still costing, not seen 30+ days), **OK**. Atera's per-product totals are checked against the sum of the live counts, so a
device in Webroot under no client shows up as unassigned cost.

Every row that isn't OK has an action, never just a figure:
- **Fix repeating invoice** (exists: the exact change + link to the template; Xero's API can't edit one)
- **Bill in Xero** (exists: a draft for this month)
- **Remove in Webroot / Acronis**: a link to that device in the vendor console (Gecko HQ never deactivates anything itself)

Bundled lines ("Internet Security & Cloud Management", flat fees) are matched by what they say they include; a flat-fee
client is checked for margin, not quantity (Philip's pricing workbook, May 2026: Regal, WCF, Technix).

## Data sources (decided 18 Oct)

- Acronis: `acronis-sync` (live).
- Webroot: `webroot-sync`, Unity API (`unityapi.webrootcloudav.com`), password grant as a **view-only console admin** created
  for Gecko HQ, never Philip's own login. Sites = clients (names mapped like Atera's), endpoints with last seen and status.
- Keeper: typed per client on the page (no simple API; 10 users across 3 clients), checked against Atera's Keeper total.
- Work from home: tick which Atera devices have it (not in Atera's API), checked against Atera's EndUser Remote total.
- Xero: `xero_repeating_invoices` lines (quantity, unit price).

## Steps

1. `webroot-sync` (this change): tables `webroot_sites`, `webroot_endpoints`, `webroot_status`, raw records kept, built
   against real rows next.
2. The reconcile table in Clients › Atera, with the typed Keeper counts and ticked Work from Home devices (one small table).
3. Client page panel: the same rows for one client.

## Rules

- Read only towards every vendor. Gecko HQ never deactivates a device, revokes a backup or changes a repeating invoice.
- Money must reconcile: per product, live counts × unit price must come to Atera's charge within $1, or the gap is shown.

## Built (step 2, 18 Oct)

Clients › **Reconcile** (`src/sections/reconcile.js`, `src/core/reconcile.js`, tests `tests/reconcile.mjs`), its own tab beside Atera
because Atera is month by month from invoices and this is now, from live counts.

- Page (Philip: "clean, visually clear and apparent"): four figures (to bill, over-billed, dead devices, set up once), then three
  blocks. **Fix these**: every money gap across clients, one line each (state, client and product with its vendor mark, in use · billed,
  £ a month, one button), red first then by £. **Set up once**: one line per client with today's counts as chips, Use these counts /
  Edit, and Pick Work from Home devices / Enter Keeper users. **All clients**: billed, costs, margin, status; opens to the products.
  "Check" (billed with no Webroot site) offers Review in Xero, never a change, since the client may be under another name there.
- Lines → products (`lineProducts`): "Acronis/M365 …" and "… Office365 & Sharepoint" are Microsoft 365 backup; any other backup line covers
  machines and Microsoft 365; "Cloud Management" / retainer bundles cover antivirus and backup unless the antivirus is Defender (Technix);
  hosting and website lines are not Atera. A line is per-device when it sells one product and is a count (qty > 1 or ≤ £12 each); yearly
  templates (period ≥ 11) count quantity ÷ 12.
- Flat fees: recorded once per product (`atera_reconcile_inputs`, kind `covered`); "Use today's counts" records them all for a client.
  After that only growth is flagged ("grown"), with a link to review the fee in Xero.
- Keeper users seeded from Philip's console check on 18 Oct (CDA 5, MSA 4 Enterprise Plus, Haus Coast 1); Work from Home devices are
  ticked from the client's Atera devices.
- First run on live data: MSA Microsoft 365 backup 9 in use vs 6 billed (£26.85/mo), MSA Keeper 6 vs 4 and antivirus 8 vs 7, Onsite
  antivirus 15 vs 2 (£52/mo), Snowskool 9 vs 7, CanCan and Philip Brazier billed for antivirus with no Webroot site, 4 dead Webroot devices.
- Not done: Bill in Xero from this page (the repeating invoice is the fix for an ongoing gap; Clients › Atera still has Bill in Xero),
  Keeper and EndUser Remote totals checked against Atera's bill, the client page panel.

## Margin by supplier and Who (18 Oct, Philip: "how much margin is being made for each part"; "we should know who that relates to")

- **Margin by supplier** (`vendorMargins`): Acronis, Webroot, Keeper, Atera Work from home, Atera technician seats, and the total.
  Cost is what Atera actually charged (the latest usage report, plus the last seats charge), so it reconciles to the invoice;
  "not tied to a client" is the part no client's live count explains (Gecko's own, dead devices, Keeper's MSP base and BreachWatch).
  Income: a per-device line belongs to its product; a flat fee is shared across what it covers plus the platform, in proportion to
  what each costs Gecko for that client (`splitRevenue`). The seats are shared out by each client's Atera devices. "(x5)" in a
  bundle's wording counts as its Work from Home devices until they are ticked. First run: £2,637.84 in, £867.47 out, 67%.
- **Who** (`whoFor`): every count opens to its names. Antivirus: Webroot devices (user, last seen, not seen 30+ days). Microsoft 365
  backup: the users Acronis charges a seat for, from the backup console's API (`/bc/api/resource_manager/v1/o365/…`, read by
  `acronis-sync` as kind `m365_user`; not in Acronis's public docs), each tagged shared / admin login / no Microsoft licence / leaver
  (`userTags`), and those it doesn't charge. Named seats matched Acronis's seat count for all 9 clients on 18 Oct. Work from home:
  the ticked devices. Xero lines don't name people, so the page says who is in use, not which ones the invoice meant.
- Found on the first run: Gecko and admin logins hold paid seats at MSA, Onsite, Cowans (two) and CDA.
