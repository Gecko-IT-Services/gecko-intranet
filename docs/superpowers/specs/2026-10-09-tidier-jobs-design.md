# Jobs: tidier page — Design

Date: 2026-10-09 (Jack: "just tidy it up. I love the whiteboard view"). Same pass as Profitability,
Settings, Timesheets and Overview the same day. Builds on 2026-10-08-jobs-design.md and
2026-10-09-jobs-whiteboard-design.md.

## Why
Six figure tiles sat above every tab, three repeating the whiteboard's column totals (Quoted, Work in
hand, Ready to invoice) and two repeating the Month overview right under them. Six tabs, three of them
pieces of one month (Month overview, Still to come, Invoiced in Oct). "Jobs Board" as the title, a
"Whiteboard" label beside the Whiteboard/List switch, and a one-off "Import open projects" link.
Jack uses the whiteboard, the month's sales and Owed to us; not the List view or the Xero tab.

## Design
- **Header** "Jobs"; **Add a job** beside Refresh (opens the form on the Jobs tab, stage Quoted).
- **Strip** of three figures on every tab: Invoiced this month, On course for, Owed to us (overdue
  under it). A figure that can't be worked out shows "—" and why.
- **Tabs: Jobs · This month · Owed to us.**
  - **Jobs** is the whiteboard, unchanged (stickies, drag, arrows, Ideas, + Add, + Idea, picked card,
    Invoiced and Lost drop zones). **See them** on Invoiced or Lost lists those jobs under the board
    (Invoiced keeps Awaiting payment / Not matched / Paid) with Close.
  - **This month**: how the month adds up (the bar and its legend; the total is in the strip), then
    repeating invoices and jobs still to come, invoiced by client, the last six months. The Xero
    connection is one line at the end (synced at, Sync now, Reconnect); at the top, in red, when the last
    sync failed or Xero isn't connected (Connect Xero).
  - **Owed to us**: unchanged, with Nudge.
- Links into Jobs keep working: `overview`, `tocome`, `invoiced` and `xero` open This month; back from
  Xero's consent screen lands there too.

## Removed
The six-tile strip; the Month overview, Still to come, Invoiced and Xero tabs (their content moves to
This month); List view (toggle, stage tiles, remembered choice); the "Whiteboard" label; "Import open
projects from the old board" and `importProjects` (the old GeckoProjects list is no longer read).

## Unchanged
Every saved field and rule: stages, moves, ideas → jobs, Invoice in Xero, Nudge, the sales and owed
figures (`src/core/jobs.js`).

## Testing
Full suite. Browser preview with sample data: light, dark, 390px.
