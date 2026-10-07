# Profitability: Xero recurring vs one-off — Design

Date: 2026-10-07. Builds on 2026-10-06-live-profitability-design.md.

## Why
Philip: "Xero is king". The card headline showed revenue from hand-typed service lines, with Xero only as a check underneath. Philip wants to see two things per month: the profit the recurring stack makes, and what else was billed that month. Mixing them gave false signals: one-off work (Clarke Lane £3,300 project, £650 renewals) showed as a "Mismatch" against the services, and a client billed a project looked hugely profitable for one month.

## Design
- **Feed (still version 1, backward compatible).** New optional `xero.recurring: { "YYYY-MM": { "<contact>": net } }`: the net of AUTHORISED/PAID invoices raised from a Xero repeating-invoice template (`repeating_invoice_id` not null). One-off = total − recurring. Older feeds without it still validate and the page behaves as before.
- **Validation.** Recurring must name a month and contact present in `xero.months`, be a number, and never exceed that contact's total. Any problem rejects the feed, as for every other section (money is written from this).
- **`profit-feed.js`.** `hasSplit(feed, month)`, `splitByClient(feed, month, match)` → Map clientId → { total, recurring, oneOff }; two contacts matching one client are summed.
- **Card headline** (all-services view, month with a split): Cost = service lines; **Recurring** = Xero recurring; Profit = recurring − cost; margin on recurring. One-off shows beside it in blue as "+£x One-off" and is never in profit. A client with no Xero invoice that month shows £0 recurring, so unbilled clients are visible (mid-month, this includes clients billed later in the month).
- **Card footer.** Read-only row: Services £ · Xero recurring £ · Match/Close/Mismatch (services vs recurring) · One-off £ · Total £. The manual Xero input stays for months without a split.
- **Summary strip and grand total**: Recurring Revenue, Total Cost, Recurring Profit, Recurring Margin, One-off Work, Xero Total.
- **Sorting** uses the headline figures.
- **Month change** now re-renders the section, since headlines depend on the month.

## Non-goals
- No per-client cost from Xero (Xero bills aren't per client). Cost stays on service lines, CSP updated from TD SYNNEX.
- Category filters (M365, Stack…) keep the service-line view: Xero totals are whole-client.

## Rejected
- Classifying by invoice reference text ("Renewal", "Project"): inconsistent in Xero. The repeating-template flag is a fact Xero holds.
- Persisting the split in XeroHistory: would change a stored shape the CSV import also writes.

## Deferred (with trigger)
- Split only exists for the months in the latest feed (current and previous). If Philip wants history further back, store recurring alongside XeroHistory.
- A manual Xero CSV import doesn't carry the split; the card uses the feed's split for that month. Revisit if CSV imports come back into use.
- Invoices that are really recurring but raised by hand (no template) count as one-off. Fix in Xero by making them repeating.
