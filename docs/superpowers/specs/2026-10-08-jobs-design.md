# Jobs: current work with values, and this month's sales from Xero — design

Status: **built 8 Oct 2026**.

## Philip's ask (8 Oct)
"We also need an area where we can keep track of existing jobs, jobs that need to be invoiced…
MSA Safety, a job for Onsite Commercials and soon more work for Clarke Lane Engineering… with
values. It would also be good to read the sales data from Xero, detailing what we have done this
month and perhaps what is projected."

Asked where it should live, Philip chose a **new Jobs section** (over reviving the old Projects
board, which he took off the menu on 6 Oct, or a tab inside Profitability).

## What Philip sees
Menu › **Jobs**, two tabs.
- Headline: Invoiced this month (Xero), Projected for the month, Ready to invoice, Work in hand
  (agreed + in progress), Quoted.
- **Jobs**: stage tiles (Quoted → Agreed → In progress → To invoice → Invoiced, and Lost), each
  with £ value and count; they filter one list. Current jobs (everything not invoiced or lost)
  show by default, nearest to invoicing first. Each job: client, what it is, value, stage, target
  date (flagged "overdue" once passed), next step, owner. One click moves it on (Agreed, Start,
  Finished → to invoice, Mark invoiced); Edit holds value, stage, target date, Xero invoice
  number, next step and notes. "Add a job" with a client picker.
- **Sales this month**: what the month is on course for, built up as
  invoiced so far (Xero, recurring + one-off) + repeating invoices still to come + jobs ready to
  invoice + jobs due to finish this month; a six-month chart of recurring and one-off sales with
  this month's projection on top; repeating invoices not yet raised; this month's invoices by
  client.

## How the numbers are worked out (`src/core/jobs.js`, tested in `tests/jobs.mjs`)
- Xero comes from the daily profitability feed (`xero.months` totals per contact, `xero.recurring`
  the part raised from repeating invoices), read through `fetchProfitFeed()` like Profitability.
- **Repeating invoices still to come** = contacts billed from a repeating invoice last month but
  not yet this month, at last month's amount. The feed has no repeating-invoice schedule, so this
  is the honest approximation; it is labelled as such on the page.
- VoIP Unlimited dealer commission is not client sales: it is excluded and mentioned separately.
- A job marked Invoiced leaves "ready to invoice" at once; its Xero invoice appears in "invoiced
  so far" after the next morning's feed run. For that morning the projection is low by that job.
  Accepted (ponytail): the alternative is matching invoice numbers, which needs invoice-level data
  in the feed.

## Storage
- `supabase/migrations/20261008190000_jobs.sql`: `jobs` (client, title, stage, value, target
  date, Xero invoice number, invoiced date, owner, next step, notes, `source_ref`), RLS via
  `is_gecko_staff()` like every table. Verified in Postgres: outsiders see and write nothing,
  unknown stages are refused, bringing projects across twice adds nothing twice.
- **Old Projects board**: "Bring the open ones across" (shown until done once) reads the
  GeckoProjects SharePoint list and adds its Quoted / Agreed / In progress projects as jobs
  (`source_ref = projects:<id>`), next action and waiting-on folded into Next step, Atera ref into
  notes. Done projects are not brought across. Values are added by hand afterwards. The list
  itself is left untouched.

## Finished jobs (Philip, 8 Oct: "when a job is invoiced what happens to it?")
- Nothing is deleted: an invoiced job is the record of the work and what it was worth (Delete is
  for mistakes). It leaves "Current jobs" when it moves to Invoiced (by hand, or by itself once its
  invoices from Invoice in Xero are approved).
- The **Invoiced** tile opens it in three groups (`invoicedGroups` in `core/jobs.js`): **Awaiting
  payment** (overdue first), **Not matched to a Xero invoice** (add the number under Edit), and
  **Paid: done** (last 90 days, older on request). The tile shows how many await payment.
- Matching to Xero invoices and Invoice in Xero: see `2026-10-08-xero-integration-design.md`
  (phases 2 and 3), which replaced the feed-based idea once Xero was connected directly.

## Tabs and chart colours (Philip, 8 Oct: "tabs for each section … nice animations … graph colours need changing")
- One tab strip at the top of Jobs (rendered by `renderTabs`): **Jobs**, **Month overview**
  (hero "on course for" figure, projection bar, last six months), **Still to come** (repeating
  invoices with dates, and jobs to come), **Invoiced in <month>** (per client with a mini bar),
  **Owed to us** and **Xero** (connection). Tabs without data are left out (no Xero/feed → Jobs only;
  Owed needs the direct connection). Badges: open jobs, counts, "overdue".
- Motion: a sliding pill under the active tab, the new pane slides in from the side it came
  from, bars grow in. Arrow keys / Home / End move along the tabs (ARIA tabs). All motion is off
  under `prefers-reduced-motion`.
- Colours: Philip chose **Gecko Green & Indigo** from four validated options. Recurring = green
  (light #2f7d1f / dark #43a024), one-off = indigo (#5b4bc4 / #9085e9); what is still to come is
  the same hue striped. Tokens `--viz-rec` / `--viz-one` in `jobs.css`; checked with the dataviz
  validator (colour-blind ΔE ≥ 25, ≥ 3:1 on the card) in both themes. Hover (or focus) a month
  for its figures.

## Not now (ask Philip)
- Costs per job (materials, hours) for job margin.

## Rejected
- **Reviving Projects**: it had no values or invoicing and lived in SharePoint; Philip chose new.
- **Writing to Xero from the browser**: needs a key in the page. Draft invoices are created by a
  Supabase Edge Function instead (Xero phase 3).
