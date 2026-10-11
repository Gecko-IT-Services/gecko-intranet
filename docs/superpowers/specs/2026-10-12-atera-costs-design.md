# Atera costs (Clients › Atera)

Philip, 10 Oct 2026: "the costing is the bit that upsets me a little, it's expensive", then "a separate section… a clear
picture of it all, cost v sales price split by feature, why the costs are going up, the leaks, and to make it better
and leaner". Framework built 10 Oct; Philip downloads Atera's usage report the next day.

## What it answers

1. **The bill:** what Atera charges each month: technician seats (2 × $189, charged on the 26th) and AppCenter
   add-ons (usage-based, charged on the 10th), in USD and the GBP actually paid, last six months, beside what clients were
   charged for Atera services in Xero.
2. **By feature:** Backup (Acronis), Security (Webroot / OpenText), Passwords (Keeper), Work from home (remote access),
   Management (what the technician seats pay for, set against cloud-management and retainer lines), Other add-ons:
   cost, charged, margin.
3. **By client:** the same per client, with their Atera devices; a row opens the feature split, the usage lines and the
   Xero lines.
4. **What changed:** this month's usage report against last month's, per customer and product, largest first
   ("Webroot 15 → 17 at Cowan, +$2.40").
5. **Leaks and savings**, largest first: the technician-seat offer not taken ($143.10 a seat on annual billing, offered
   11–16 Sep), add-ons on a client with no Atera line in Xero, a client charged less than their add-ons cost, a feature in
   Atera that no Xero line for that client mentions, devices not seen for 30+ days (an estimate), devices with no
   Atera billing (before a report exists), Gecko's own add-ons.

## Where the numbers come from

- **atera_bills:** one row per charge, in the month it was charged (Philip's rule). June–October seeded from the BlueSnap
  receipts (USD) and PayPal receipts (GBP paid). After that the page adds the feed's `atera.charges` as they appear, with GBP at
  the feed's rate (`gbp_source = 'rate'`, and the page says so). No new feed field, no mailbox reading from the site.
- **atera_usage / atera_usage_files:** Atera's per-customer AppCenter usage report, uploaded on the page (CSV or Excel;
  Excel is read with SheetJS, loaded only when such a file is chosen). Atera's receipt is one line and its API has no billing
  data, so this report is the only source of cost per client and feature.
- **Xero:** `xero_invoices` lines whose item code starts "Atera", the same rule as Devices.
- **Devices:** `atera_agents` (Monitoring › Devices).

## Rules

- **It must add up.** A usage report is saved only when its lines total that month's add-ons charge within $1.00 (Atera
  rounds per line). `save_atera_usage` checks it in the database as well as the page, replaces the month as a whole in one
  transaction, and records who uploaded it. A file that doesn't add up says by how much and can't be saved.
- Columns are found by their headings (Atera doesn't document the layout); the preview shows what was found, lets you
  pick other columns, shows the total against the charge and a few lines with the feature each counts towards. Total
  and subtotal rows are left out; a report that names the customer once per group is read correctly.
- **Bundles** ("Internet Security & Backup & Work from Home") are split by what each named feature costs that client,
  or evenly until costs are known, and the page says so. Philip's own action plan (Pricing Dashboard, May) already
  says to put Security and Backup on separate Xero lines; that makes the split exact.
- **Retainer lines** (Technix: "Remote IT Support, Defender AV, Windows Backup…") count as Management only: Defender
  and Windows Backup aren't Atera add-ons.
- Seats are charged on the 26th, so the current month shows add-ons only until then and says so (as Licences does before
  TD SYNNEX's invoice). The seat offer is worked out from the last seats charge.
- Read only towards Atera and Xero. The only writes are the usage upload and adding the feed's latest charge.
- Atera names that differ from Xero use `ATERA_NAMES` in `src/core/devices.js` (shared with Devices), and every contact ever
  charged for Atera is matched, so a client with nothing invoiced this month still shows under its Xero name.

## Not done / later

- The exact report layout is unknown until Philip downloads one (11 Oct); the heading rules in `detectColumns` may need a
  word adding then. Feature words for usage products are in `PATTERNS` (`src/core/atera-costs.js`).
- No per-device add-on data: "old devices" savings are an estimate (client's add-on cost ÷ devices × old devices).
- Replaces the hand-kept `Gecko Docs/Gecko Pricing Dashboard.xlsx` for Atera; that workbook's Exclaimer, M365 and
  hosting sheets are covered by Profitability and Licences.

## Rejected

- Reading BlueSnap/PayPal receipts from Philip's mailbox in the page: only works for the signed-in mailbox, and the feed
  already reads them.
- Estimating per-client cost from a rate card × device counts: Atera's devices don't say which add-ons each carries,
  so it would look exact and not be.
