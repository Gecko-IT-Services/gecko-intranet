# Overview: neater Today — Design

Date: 2026-10-09 (Jack: "just neaten it up a little"). Builds on 2026-10-08-overview-design.md; same pass
as the Profitability, Settings and Timesheets pages the same day.

## Why
Today had two headings stacked ("Overview Dashboard / Friday 9 October", then "Good afternoon, Jack /
Backups and alerts checked 15:09") and two identical-looking lists (Monitoring above Needs attention,
same dots, same Open buttons, a count each). Business ended in a Quick actions bar repeating the sidebar.

## Design
- **One header.** The greeting is the title ("Good afternoon, *Jack*", the name in the green second-word
  style every section uses); underneath, the date and when backups and alerts were last checked.
  **Log time** sits in the header beside Refresh (one click from any Overview tab). On a phone the heading stays
  (smaller), as the client page's does: it is the greeting, not the page's name.
- **One Needs attention list.** Monitoring's rows (failed backups, alerts that need a look, backups with
  warnings; at most eight, then "n more in Monitoring") join the list. Order: red, amber, info;
  monitoring first within a colour. One count. "Not checked: …" still names a source that failed.
- **Business** loses the Quick actions bar (Jobs, Add journey, Profitability are in the sidebar).

## Unchanged
Status tiles, the month-end banner, This week strip, the This week and Month-end tabs, Business's money
tiles, sales chart and At a glance; the data and every rule behind them.

## Testing
Full suite. Browser preview with sample data: light, dark, 390px.
