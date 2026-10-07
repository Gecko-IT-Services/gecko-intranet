# Mobile: Profitability footer and header on phones — Design

Date: 2026-10-07. Philip asked for the dashboard to be "better at being mobile friendly". Audit at 390px (iPhone) with sample data across Overview, Profitability, Mileage and Timesheets. The shell (hamburger, stacked header), the card-mode tables and the scroll-rail tab strips from the earlier mobile pass all held up. Three concrete faults, fixed here:

1. **Profitability page rendered zoomed out.** The table footer added this week (CLIENT TOTAL and the Xero line) is a `tfoot`, which the card-mode container query only applied to `tbody`. The footer kept its desktop width (~526px), the layout viewport grew to 512px, and the whole page shrank. Fix: the same stacked treatment for `tfoot` rows, with Cost / Revenue / Profit / Margin labels on the total line.
2. **"Assign to client" dropdowns** in the Xero unmatched list sized to their longest option and overflowed. Fix: wrap the row; selects flex and cap at 100%.
3. **Cost hidden on phones.** The card header dropped Cost below 900px. On the invoiced basis cost is the number that moves, so it is shown again and the figures wrap.

Also: no empty "ACTIONS" label on read-only Invoiced rows; the Xero footer line loses its grey band in card mode.

## Non-goals
Anything the audit did not surface. Mileage and Timesheets already stack correctly; their tab strips scroll with an edge fade by design.
