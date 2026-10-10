# Analytics

10 Oct 2026. Jack asked for an analytics section with responsive graphics where "everything must have a
purpose". Mockups were reviewed in an artifact first (three rounds of comments); this note records what was built.

## What it is

A new section, **Analytics**, under Home in the sidebar, with four tabs. Every card is one question: the heading
asks it, the sub-line says the window and the source, the graphic answers it. Read only. No new tables, columns,
scopes or secrets: every figure comes from data another section already owns.

| Tab | Question | Graphic | Reads |
|---|---|---|---|
| Revenue | Why did recurring revenue change? | A sum (last month + gained − lost = this month), then one bar per client | `xero_invoices`, `xero_repeating_invoices` |
| Revenue | Is each month on course? | Recurring and one-off columns, stripes for still to come; margin strip beneath | Xero tables, `jobs`; feed + service lines for the margin |
| Revenue | How much rides on a few clients? | Ranked share bars with a 15% line | the same recurring figures |
| Clients | Which clients earn their keep? | Money kept against hours logged, one guide line, table worst first | feed, `gecko_clients`, `gecko_services`, `timesheet_entries` |
| Time | Is every working day logged? | 26-week heatmap per person | `timesheet_entries`, `leave_requests` |
| Time | Is support crowding out project work? | Weekly hours by kind of work | `timesheet_entries` |
| Ahead | Which support blocks run out next? | One burn-down wedge per SSA client on a calendar | `ssaBoard` (core/ssa.js) |
| Ahead | Where is the next pound of recurring revenue? | One square per client per product | the Opportunities gaps map |

## Rules the figures follow

- **Revenue is Xero read the way Jobs › This month reads it**: net, AUTHORISED + PAID, recurring = raised from a
  repeating invoice, VoIP Unlimited commission left out. The month in progress counts what is raised plus what its
  repeating invoices will still raise (`repeatDates`), so it is compared whole. `monthSeries` reuses
  `xeroHistory` and `xeroMonthSales` unchanged.
- **The sum must add up**: last month + gained − lost = this month, to the penny (tested). Pence are shown small.
- **Nothing is spread.** An annual or quarterly repeating invoice sits in the month it is invoiced, as everywhere
  else, so it shows as a move. Each move says what kind it is so it is not misread: New (first recurring invoice
  ever), Not monthly (billed before, not last month), Not due this month (still has a repeating invoice, none due),
  Left (no repeating invoice any more). More and less carry no tag.
- **Money per client is Profitability's model** (`monthMoney`): recurring and one-off from the feed's Xero split;
  cost = service lines + supplier invoices dated that month; while the feed covers supplier invoices, m365 and
  hosting lines contribute no typed cost. The month total includes shared and unassigned supplier lines, so the
  margin strip equals Profitability's Margin for that month. The current month's margin is left open until a
  TD SYNNEX invoice dated in it is in the feed (~16th).
- **Kept per hour** = (Xero invoiced − cost) ÷ hours logged, over the last three finished months the feed splits,
  so one SSA block invoice does not swing it. Only clients with hours can have a rate; the rest are counted.
  It reports the gap to the target and gives no pricing advice.
- **SSA balances are never recalculated.** The run-out calendar is `ssaBoard`'s rows re-drawn: the wedge starts at
  the hours left today and reaches zero on `runsOut`, which is the same straight-line projection.
- **Whitespace is the gaps map as data** (`whitespace()` exported from `sections/opportunities.js`, the same
  `clientGaps` / `mapCell` / `holds` calls the Map makes). Value is the gap's own `mrr` (the pipeline value), so a
  gap with no price counts as £0 and is said so. A dealer customer who must not be offered a product is a dot.

## Two numbers that are assumptions (constants in `src/core/analytics.js`)

- `TARGET_RATE = 65`: £ kept per hour. Taken from the £650 SSA price over ten hours. **Philip to confirm.**
- `DEPENDENCE = 0.15`: the share of recurring revenue above which a client is called a dependency. A suggestion.

## Charts

Hand-drawn SVG from the data at the container's width (re-drawn by a `ResizeObserver`), so text stays a fixed
size and nothing scrolls sideways at 375px. No chart library. Colour does one job per chart: green = recurring /
support, indigo = one-off / planned work (the pairing Jobs already uses), stripes = still to come, amber and red
only for state, grey for context. Text is never in a series colour. The three-hue set and the four-step green ramp
were run through the dataviz palette validator in both themes. Every mark has a hover and keyboard-focus readout
(value first); every value is also on the page as a label or a table row.

Work types group as: Support = Remote Support, Onsite Support; Planned work = Project Work, PC Set Up, Maintenance;
Other = Misc and blank (`workKind`).

## Failure states

Each source is loaded on its own (`settle`). A source that fails names itself in the card that needs it, with
Retry, and the other cards still draw; nothing is shown as zero. Leave failing does not stop the heatmap: it says
days off may show as nothing logged. No Xero invoices → an empty state pointing at Jobs › This month. The gaps
map is the heaviest read (it is all of Opportunities), so it loads only when Ahead is opened.

## Accepted ceilings

- A weekday nobody logged counts as closed (bank holidays are not known), so a day both forgot is not flagged,
  nor is a day one forgot while the other was on leave. `ponytail:` comment in `logGrid`.
- `monthMoney` mirrors the rules in Profitability's classic script rather than sharing code with it. If that
  model changes, change both; `tests/analytics.mjs` pins the rules with a reconciling example.
- Service lines are today's lines applied to past months, as Profitability does.

## Rejected

- A waterfall/bridge chart for the revenue change (first mockup): hard to follow. Replaced by the sum.
- Flat bars for SSA run-out: the wedge carries hours left and pace as well, with no extra labels.
- A date range picker: each card states its own window, one decision per card.
- A chart library: eight small charts, no dependency, and the app has no build step.
- A four-column table beside the scatter: the shared table transform would stack it into cards in a half-width
  column, so it is three columns with hours and kept as a sub-line.

## Deferred

- Pipeline conversion and time in stage: the pipeline started 8 Oct, there is no history yet. Revisit January.
- Days to pay: payments run on direct debit and work well.
- Year on year: Xero history starts June 2026.
- Clicking a mark to drill in (a blank day opening Log time on that date, a square opening that client's gap).
  Each card has one button to the section that owns the data instead.

## Sidebar

Analytics is a ninth sidebar entry (Home: Overview, Analytics). Philip settled on eight on 9 Oct; if he prefers
eight, make Home a hub (`HUBS.home = Overview + Analytics`) and drop the link: two lines in `index.html`.

## Files

`src/core/analytics.js` (pure, `tests/analytics.mjs`), `src/sections/analytics.js`, `src/styles/analytics.css`,
`whitespace()` in `src/sections/opportunities.js`, the section container and sidebar link in `index.html`,
registration in `src/main.js`.
