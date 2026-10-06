# Live Profitability (no more CSV exports) — Design

**Date:** 2026-10-06
**Branch:** `feat/live-profitability`
**Status:** Built, for review
**Author:** drafted by Claude (Felix persona) for Philip; for Jack to review

## Why

Profitability depended on two monthly CSV exports: Xero invoices (revenue,
into `GeckoClients.XeroHistory`) and the TD SYNNEX StreamOne "Microsoft CSP
Billing Customers Report" (cost, into the m365 `GeckoServices.CostPerMonth`
rows). When nobody exported, the figures went stale silently.

## Constraint

The page is a public static site. It cannot hold Xero or TD SYNNEX
credentials, and Xero does not allow browser calls. So the page cannot be
"live" against either system directly.

## Design

A **scheduled Claude task** ("Gecko Dashboard profitability feed", daily
06:47 UK) does the reading the browser can't:

- **Xero:** sales invoices for the current and previous month (AUTHORISED +
  PAID), `amount_net` summed per contact.
- **TD SYNNEX:** the monthly CSP invoice already emailed to
  philip@gecko-it.com by `customerinvoices@tdsynnex.com` (subject contains
  "See Billing Statemen"). Its PDF lists every line with `End User:` and its
  net GBP value. Summed per end user and **reconciled to the invoice's
  "Total Value without VAT"** (±£0.05); if it doesn't reconcile, the CSP
  section is left out with `cspError`, never half-written.

It writes one file, replacing the previous one:
`GeckoITClientPortal › Documents › Gecko Dashboard Data › profitability-feed.json`

```json
{ "version": 1, "generatedAt": "ISO",
  "xero": { "months": { "2026-10": { "Cowan Consultancy": 776.55 } } },
  "csp":  { "invoice": "8284668977", "date": "2026-09-16", "month": "2026-08",
            "netTotal": 1142.72, "customers": [{ "customer": "ALS Locksmiths", "cost": 47.51 }] },
  "cspError": null }
```

### Page behaviour

`src/core/profit-feed.js` (pure, tested) validates the file; `index.html`
loads it on every Profitability refresh (Graph item → pre-authenticated
download URL; existing `Sites.ReadWrite.All`, no new permission).

- **Revenue is applied automatically.** Each month's totals go through the
  existing name matcher into `XeroHistory`, written only where the value
  changed. Two Xero contacts matching one client are summed. Unmatched
  contacts appear in the existing unmatched list for the month on screen.
- **Costs are not auto-applied.** Apply rewrites GeckoServices rows, so the
  CSP card shows "TD SYNNEX invoice N … Not applied yet · Review costs from
  this invoice", which opens the existing preview (same tick rules, duplicate
  and plausibility checks). Once applied, the card says "Already applied"
  (invoice number recorded with the last-import baseline).
- Both manual CSV imports stay as fallbacks.

### Failure states (never look like "all fine")

| Case | Shown |
|---|---|
| File not there yet | amber: not set up, manual import still works |
| Can't read file | red: error text; figures are from last good update |
| File fails validation (bad month, string amounts, CSP lines ≠ total) | red: rejected, nothing applied |
| Older than 36 h | amber: nightly update has stopped |
| No CSP invoice / didn't reconcile | amber with the job's reason |

## Security note

The feed holds revenue and cost per client. It lives in the portal site's
Documents, which is the same site as the GeckoClients/GeckoServices lists.
Check that client portal users cannot browse the `Gecko Dashboard Data`
folder (break permission inheritance on it if they can).

## Testing

`node tests/profit-feed.mjs`: validation (version, dates, months, numeric
amounts, CSP reconciliation incl. rounding tolerance, optional sections),
month ordering, per-client summing, CSP shape, staleness, UK-time labels.
All existing tests still pass.
