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

## Not now (ask Philip)
- Invoice-level Xero data in the feed (number, contact, date, amount, status, repeating schedule)
  would let a job match its Xero invoice automatically and make the projection exact. That is a
  feed change: `validateFeed` and the scheduled task's prompt change together.
- Costs per job (materials, hours) for job margin.

## Rejected
- **Reviving Projects**: it had no values or invoicing and lived in SharePoint; Philip chose new.
- **Writing to Xero from the site**: needs a key in the browser. Invoices stay raised in Xero.
