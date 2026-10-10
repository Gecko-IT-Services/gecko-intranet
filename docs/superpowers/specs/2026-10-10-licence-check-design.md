# Microsoft 365 licence check (Clients › Licences)

Philip, 10 Oct 2026, picked "Monthly Microsoft 365 licence check" from the suggestions: compare the TD SYNNEX invoice
with what each client is billed in Xero, and list what doesn't match. The method is the one Philip's monthly
reconciliation already uses (the `td-synnex-m365-reconciliation` skill): seats × rate per client and product,
never invoice totals, and report the differences without commenting on pricing.

## What it shows
- A **Licences** tab in the Clients hub (Directory · Profitability · Licences), one month at a time (the months that
  have a TD SYNNEX invoice in the feed, newest first).
- Figures: TD SYNNEX cost (with the invoice number and date), billed in Xero (M365 lines that month), margin £ and %,
  differences and £/month not billed.
- **Needs a look**: clients with a difference, biggest £ first. **Matching**: the rest, each with TD, Xero and margin
  (amber under 30%, red below zero). A row opens the detail: per product, TD seats vs Xero seats, the kind of difference,
  whether it is new this month or a repeat, and for fewer seats billed the exact change ("INV-0227: … 14 → 15 at £17.92 =
  +£17.92/month") at the client's own rate. A product the client isn't billed for gets an estimate, always labelled with
  the rule that produced it: their own rate for that product, else their own mark-up on their other licences, else the
  median across clients. Products on monthly commitment at TD SYNNEX are named as a fact.
- Read only. Nothing is written to Xero; Philip makes changes there.

## Where the data comes from
- TD SYNNEX: the feed's `cspInvoices[]` (the morning job reads the invoice email). Xero: `xero_invoices.line_items`
  (hourly sync), lines with item code **M365** on AUTHORISED or PAID invoices dated in the same month. Backup lines
  ("Acronis/M365 - Cloud Backup", item "Atera - Cloud Backup") are not licences.
- Client names: the feed already maps TD's end user to the Xero name (`client`); the rest goes through `sameClient`.
- Products: by MFPN prefix on the TD side; by the words on the Xero line (Business Standard / Basic / Premium, Exchange
  Plan 1 incl. "Hosted Exchange 50Gb", Plan 2 incl. "100gb", Archiving, OneDrive / 1TB). A Xero line that names no product
  ("M365 Subscription") covers whatever TD products are left when the seats add up; otherwise it is "Can't compare
  seats". Bundle lines are opened up when the text says how many ("Business Standard x 3", "(13 seats: 8x Business
  Standard, 4x Exchange Online Plan 2, 1x Exchange Online Plan 1)").

## Two levels
1. **Today's feed: totals per client.** The feed holds each client's TD cost but not products or seats, so the page
   compares cost with Xero revenue per client: on TD but nothing in Xero ("Not billed"), billed in Xero but not on TD,
   and margin. It says plainly that seats can't be compared yet. Checked on live data for Sep 2026: all 19 TD clients
   billed, £1,142.72 cost, £2,516.76 billed, 55% margin.
2. **Seat detail**, as soon as the morning job adds it (below): per client × product, the variance types
   UNBILLED_CLIENT (Not billed), UNBILLED_SKU (Product not billed), SEAT_SHORT (Fewer seats billed), SEAT_OVER (More seats
   billed), NO_TD_LINE (Not on TD SYNNEX), UNMATCHABLE (Can't compare seats), MATCH.

### The morning job: one extra instruction (Philip pastes it into the scheduled task)
> For each customer on each TD SYNNEX CSP invoice in `cspInvoices`, also add `skus`: one entry per product (MFPN) and
> commitment, summing that customer's subscriptions: `{ "mfpn": "CFQ7TTC0LDPB:0001", "product": "<description as
> printed>", "tenant": "<tenant>", "seats": <total seats>, "unitCost": <unit price>, "total": <net total>,
> "commitment": "Annual" | "Month" }`. The `total`s must add up to the customer's `cost` (to the penny); if they don't,
> stop and report, as for the invoice total. M365/CSP lines only: never hardware, freight or warranties.

`validateFeed` accepts `skus` as optional (older feeds still validate) and refuses a feed whose products don't add up to
the customer's cost, so a mis-read invoice never reaches the page looking plausible. Until every customer on that
month's invoice has `skus`, the page stays at level 1 for that month.

## Timing
TD bills each subscription on its anniversary (invoice ~16th–23rd); Xero's repeating invoices run on the 1st. Both are
compared in the calendar month they are dated, the same rule Profitability uses. A seat added mid-month can show on TD
before the next Xero run; the difference is still listed (Philip's instruction: report all variances), tagged "new this
month", and drops off the month after if it was only timing.

## Non-goals and rejected
- No writes to Xero, no draft invoices from here (the quote builder comes later and will own Xero drafts).
- No price advice: a rate Philip agreed with a client is not an error, so matching seats at any price are "Matches".
- Parsing the TD PDF in the browser: rejected (attachments need extra mail permissions, and a PDF parser in a static
  site is fragile). The job already reads the invoice and checks its total.
- Partner Center / TD SYNNEX StreamOne API: would need keys in an Edge Function; not worth it while the invoice email
  carries everything.

## Files
`src/core/licences.js` (tests `tests/licences.mjs`), `src/sections/licences.js`, `src/styles/licences.css`,
`src/core/profit-feed.js` (`skus` check, tests in `tests/profit-feed.mjs`), Clients hub in `index.html`.
