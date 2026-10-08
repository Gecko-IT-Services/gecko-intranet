# Overview: what really matters, at the top (8 Oct 2026)

Philip: "The dashboard needs to be representative of the portal, at the moment it only shows
mileage data, I need an overview of what is really important up there."

## What it answers, top to bottom
1. **How is the money doing?** Four tiles, all from Xero (the same invoices Jobs reads), each opening
   the place the figure comes from:
   - **Sales · <month>**: invoiced so far, what the month is on course for, and a bar in the Jobs
     colours (green recurring, indigo one-off, striped = still to come) → Jobs › Month overview.
   - **Recurring · <month>**: raised from repeating invoices + still to come this month, against what
     was raised from them last month (Philip's goal is growing monthly recurring revenue) → Still to come.
   - **Owed to us**: amount due incl. VAT and how much is overdue → Owed to us.
   - **Pipeline**: open jobs (quoted → to invoice) and proposals out with their £/month → Jobs.
2. **What needs me?** One list, red then amber then info, each with an Open button:
   Xero not connected / sync failed / not synced for 3 h; invoices overdue; draft invoices waiting in
   Xero; jobs ready to invoice (less what approved invoices already cover); jobs past their target
   date; SSA clients under 2 h (red when out); leave to approve; mileage from before this month not
   claimed; proposals with no update for 14 days. Empty = "Nothing needs you right now".
3. **This week**: who is away (today → two weeks), job targets this week (and late ones), repeating
   invoices Xero raises in the next 7 days, hours logged per engineer.
4. **Sales, last six months** (as Jobs › Month overview) and **At a glance**: active clients, SSA
   clients and their prepaid hours left, opportunity ideas, mileage this month.

Mileage, which was most of the old page, is now one line in At a glance and one item in the list.

## Where things live
- Logic: `src/core/overview.js` (`money`, `attention`, `thisWeek`), tests `tests/overview.mjs`.
- Database reads: `src/sections/overview.js` `loadDb()` (jobs, opportunities, leave, xero_status, and
  Xero invoices through Jobs' `fetchXero`, so both pages read the same invoices).
- Page: `index.html` `ovw*` (classic script), styles `src/styles/overview.css`.
- Open buttons use `data-ovw-go="section:tab"`; Jobs exposes `show(tab)`, Timesheets `tshTab`.

## Failure states
- Each source is read on its own. One that fails is named under the list ("Not checked: …"), so a
  short list never passes for an all-clear. Money tiles without Xero show "—" and why, never £0.
- Mileage and clients are still required (as before); the database not being connected shows Connect.

## Not done (deliberately)
- **Backups and Alerts** are not read here: both read the support@ mailbox (Mail.Read.Shared, up to
  thousands of messages) and would slow every page load and could ask for consent. Next step if
  wanted: have those sections store their latest summary in the database and show it here.
- Profit/margin stays on Profitability (it needs the feed's supplier costs and is monthly).
- The old Operational Snapshot (company switch countdown, passed on 1 June) is gone.

## Update 9 Oct: Today and Business tabs (Gecko HQ stage 2)
Philip asked for a **morning check** (stage plan in `2026-10-09-gecko-hq-structure-design.md`). Overview
now has two tabs:
- **Today** (default): greeting, six status tiles (Backups 24h, Alerts 2 days, Money, Support hours,
  Jobs, Team), then **Monitoring** (failed backups, alerts that need a person, backups with warnings),
  **Needs attention** and **This week**. Each tile and row opens the place to deal with it.
- **Business**: the money tiles, six months of sales and At a glance (as before).
- Backups and alerts come from the Backups and Alerts sections' new `snapshot()` (same parsing and
  triage, resolutions included; their own state untouched), exposed as `window.GeckoMonitor`. They are
  read after the rest so the page never waits on the mailbox. Without mailbox consent the tile says
  **Connect** (one click, the consent popup); no access says so. Never shown as all-clear when unread.
