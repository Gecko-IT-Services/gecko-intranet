# Profitability: supplier costs in the month invoiced — Design

Date: 2026-10-07. Builds on 2026-10-07-xero-recurring-split-design.md.

## Why
Philip: annual items should hit the month they were invoiced, on both sides. Revenue already does (Xero, previous spec). Costs did not: service lines carry hand-typed monthly equivalents (a £199/yr hosting fee as £16.58, Exclaimer annual subs folded into "M365 + Exclaimer" rows), so a client showed a smooth margin that never matched any month's real cash.

## What is monthly anyway
TD SYNNEX (M365), Atera and VoIP are monthly bills: the invoiced month is the month. They stay on service lines (CSP still updated from the feed via the preview). Only annual items move: Exclaimer subscriptions and Clook domain renewals.

## Design
- **Feed (version 1, optional sections).** `exclaimer.subscriptions[]` (already present: invoice, date, product, users, endUser, months, net, period) and new `clook.invoices[]`: `{ invoice, date, lines: [{ item, domain, client, shared, net, periodStart, periodEnd }] }`. `client` is the Xero contact name the job assigns from a domain map held in the job prompt (Felix maintains it); null when unknown. `shared: true` marks the Reseller-Enterprise hosting plan, which is one bill for every hosted site.
- **Validation.** Dates YYYY-MM-DD, nets numbers, end users and items non-empty. A bad section rejects the feed like every other (nothing half-used).
- **`profit-feed.js` `invoicedCosts(feed, month, match)`** → { byClient, unassigned, shared, total }. A line lands whole in the month its invoice is dated. Unknown end users / domains are kept and listed, never dropped: the total is always the real total.
- **Card.** Supplier lines appear as read-only "Invoiced" rows under the service lines; headline cost and client total include them. Profit = recurring (Xero) − monthly service lines − supplier invoices this month.
- **Feed box.** Shared and unassigned lines for the shown month are listed ("tell Felix which client"), so they sit in the grand total but on no card and the gap is visible.
- **Grand total / strip.** Total Cost includes all supplier lines; the strip says how much.

## Hosting lines (amended same day)
Philip: "I don't want that cost divided over the year." So while the feed carries Clook invoices, the cost typed on any `hosting` service line is ignored in every total and the line shows "from invoices" (with the typed figure in the tooltip). Hosting cost is then only ever the Clook invoice in its month. Sell on the line is untouched. This replaces the earlier plan of asking Philip to zero those lines by hand; the earlier "Rejected" entry below is superseded for hosting because the page now says what it is doing instead of hiding it.

## What Philip must still do once
"M365 + Exclaimer" and similar bundle lines carry Exclaimer's annual fee spread monthly inside one cost figure that cannot be separated in code. Rename them "M365 Reselling" and Apply from the CSP panel (or edit the cost to the M365-only figure), or Exclaimer is counted twice for those clients.

## Consequence, by design
A hosting client shows its cost in the month Clook bills Gecko and its revenue in the month Xero bills the client. Those are often different months, so single-month margins swing. Both figures are true.

## Non-goals
- No allocation of the shared Clook plan to clients (£29.99/mo; a rule would be a guess).
- No spreading of annual items (that is exactly what was removed).
- Category filters keep the service-line view.

## Rejected
- Storing domain→client in a new SharePoint list: another hand-made list, and the map changes rarely. The job prompt is the register for now; revisit if it grows past ~30 entries (trigger).
- Auto-zeroing hosting rows when a month has Clook data: hides the double count instead of showing it; an explicit one-off edit is safer on a money page.

## Deferred (triggers)
- Exclaimer "Gecko IT Services" 15-user subscription: Philip to say which client; until then it is listed as unassigned.
- slaterfamily.me.uk: not a client; renewal paid 19 Jul 2026 to 12 Aug 2027. Philip to disable auto-renew at Clook. Stays listed as unassigned for July.
- History: the feed carries current + previous month. If Philip wants older months on an invoiced basis, keep 13 months of supplier lines in the feed (cheap) and extend `xeroMonths`.

## One basis everywhere (amended later the same day)
Philip: "revenue should also sit in the month it was invoiced, consistent throughout." So while Xero is supplying the month's billing: hosting lines contribute no sell (they show "from Xero"); the CLIENT TOTAL row uses the same figures as the card headline (Xero recurring, lines + supplier invoices, profit); the footer compares the monthly lines against Xero recurring and shows a gap as "Xero billed more/less" with the figure, never a red Mismatch, because an annual renewal landing is the usual reason; the CSV export uses the headline figures. Months the feed does not cover fall back to the typed lines, as before.
