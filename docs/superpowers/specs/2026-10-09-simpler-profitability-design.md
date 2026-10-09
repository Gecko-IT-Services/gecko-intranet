# Profitability: simpler page — Design

Date: 2026-10-09 (Jack). Builds on 2026-10-07-xero-recurring-split-design.md and
2026-10-07-invoiced-supplier-costs-design.md; the money model is unchanged.

## Why
The page answers three questions (Jack, 9 Oct): which clients make or lose money, are each
client's service lines right (and add new ones), and did Xero bill what we expect. Today the
first screen is the Xero reconciliation panel (status lines, a CSV drop box, side stats,
assign dropdowns), then six KPI tiles, a filter bar, a legend, a card per client and a grand
total repeating the tiles. The answer to "who needs a look" is spread over 28 cards.

## Design
Top to bottom:

- **Header** (unchanged): Manage clients in Directory · month ‹ › · Export CSV · Refresh · Synced.
- **Status box**, one line: "Xero updated today 06:51 · <supplier invoices in the month>" (or "No
  supplier invoices for October yet (TD SYNNEX bills ~16th)"). Feed missing / unreadable /
  rejected / stale: the box is amber or red and says which. Below it, only when there are any, one
  line naming what is in Xero or on a supplier invoice but on no client: "2 Xero contacts aren't on
  any client: Haus Coast Ltd £41.44, … Add them in the Directory if they are clients." Shared
  supplier lines (Clook reseller plan, Gecko's own Exclaimer) are listed there too, as now.
- **Summary**, one line of figures: Recurring · Cost · Profit · Margin · One-off (feed months), or
  Revenue · Cost · Profit · Margin (months the feed doesn't cover, from the typed lines).
- **One table**, one row per client: Client (link to the client page, New / Winding down badge) ·
  Recurring (or Revenue) · Cost · Profit · Margin · One-off (blank when nil) · reasons.
  Two groups: **Needs a look (n)** first, then **All other clients (n)**. Search filters both;
  Sort (Profit, Margin, Recurring, Cost, A–Z) applies within each group.
- **Click a row**: a panel under it (several can be open; they stay open through a refresh) with
  the service lines (category, service and note, cost/mo, sell/mo, margin, edit, delete; "from
  invoices" / "from Xero" as now; Pending setup as now), Add service, the supplier invoice lines
  charged to the client this month (read-only), one Xero line ("Xero this month: recurring £x vs
  monthly lines £y (£z under) · one-off £a · total £b"), the retainer note, and Open client page.

### Flags (`src/core/profitability.js`, `flags()`)
Every reason that applies, most serious first:
1. **Losing money** (red): profit < £0.
2. **Thin margin** (amber): revenue > £0 and margin < 40%, when not already losing money.
3. **Xero £x under lines** (amber): feed month, client billed, monthly lines − Xero recurring > £1.
   Hosting is already off the lines on feed months, so annual renewals can't trip it; billing more
   than the lines is never flagged.
4. **Not billed in Xero** (amber): feed month that has finished, monthly lines > £0, no Xero invoice.
   Never the current month (repeating invoices may not have gone out yet).

In the current month, a client the feed shows as not yet billed is not judged at all (no "Losing
money" while its repeating invoice is still to go out). No flag for a client with no lines and no
Xero billing, or only Pending setup lines. Winding-down
clients are flagged like any other. Early in the current month costs are low until TD SYNNEX bills
(~16th), so margins look healthy: same as today, by the invoiced-month rule.

## Removed
- Xero CSV import (drop box, Browse, Include drafts, Re-import, Clear Xero data) and its parsing.
  Jack, 9 Oct: the feed is the only way in.
- The manual "Xero actual" box per client and its save.
- "Assign to client…" for unmatched contacts: on feed months the cards read the feed's split by
  name, so the assignment saved a figure nothing showed.
- Category filter buttons (Jack, 9 Oct: not used), the margin legend, Expand all / Collapse all,
  the six KPI tiles, the grand total bar.
- The "Seed sample data" empty state: "No clients yet: add them in the Directory."

## Unchanged
- Money logic: feed validation, supplier invoices in the month dated, recurring / one-off split,
  m365 and hosting cost rules (`prfRowCost`, `prfRowSell`, `prfClientHeadline`).
- The feed still saves each client's month figure in XeroHistory (Overview reads it).
- Export CSV (always the whole client now there is no category filter).
- Service line add / edit / delete.
- The `csp*` import code stays off-screen until its own removal after November 2026 (CLAUDE.md).

## Failure states
- Database unreadable: the existing "Could not load data / Try again" box.
- Feed missing / error / rejected: status box amber/red naming it; the table falls back to typed
  lines, labelled Revenue, with no Xero flags, so it never reads as a good Xero month.
- Search matches nothing: "No clients match".

## Mobile
The table becomes stacked cards below the container breakpoint (`syncTableLabels`); the open panel
spans the full width. Checked at 390px before merging.

## Testing
`tests/profitability.mjs`: each flag and its edges (profit exactly £0, margin exactly 40%, £1 under,
current vs finished month, no lines, pending only, non-feed month). Full suite before commit.
Browser preview with sample data, desktop and 390px.

## Rejected
- Moving Profitability into its own ES module while redesigning: doubles the change and moves the
  cost logic at the same time. Worth doing on its own later.
- Hiding the removed parts with CSS: leaves the manual paths live and gives no flags.
- Keeping the card per client, slimmer: still 28 things to open to find the few that matter.

## Deferred (with trigger)
- Flags for months the feed doesn't cover (they would compare against typed lines only). Add if
  history further back gets the recurring split.
- A flag for a client whose cost rose sharply month on month: add if Philip asks after the Atera
  cost check (w/c 12 Oct).
