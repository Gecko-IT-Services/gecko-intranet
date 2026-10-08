# Gecko HQ: one application, sections with tabs, a page per client (9 Oct 2026)

Philip: "all the sections in the side panel should follow the same format as jobs, with tabs that are
easy to navigate and reduce bloat ... it all needs to interlink, be as one ... a professional application
bespoke to Gecko IT Services and our workflow." He gave authority to build and merge the stages without
asking each time (9 Oct).

## What Philip told us about the workflow (9 Oct)
- Philip and Jack use the same app (no role-based home).
- Support work comes in by phone/email and is logged **straight into Timesheets**.
- Jack needs: logging time, alerts and backups, the jobs he is working on, client info.
- Routines to build in: **morning check**, **weekly review**, **month-end close** (done in the
  **last working days of the month**).
- Merge to reduce bloat: Alerts + Backups → **Monitoring**; Leave + Mileage → **Team**;
  Profitability into **Clients**. Deliver in stages, one PR each.
- No "Connected Workspace" card in the sidebar.

## Structure (12 sidebar items → 8)
Home: Overview · Sales: Clients, Opportunities, Jobs · Operations: Timesheets, Monitoring · Admin: Team, Settings.

**Hubs**: one sidebar entry, several sections, switched by the shared tab strip above them
(`#appHub`, `renderHub()` in index.html; `HUBS`): Clients = Directory, Profitability, and the open
client's page; Monitoring = Backups, Alerts; Team = Leave, Mileage. Every old section key still works
(`navTo('alerts')` opens Monitoring on Alerts) and the sidebar returns to the view last used in a hub.

## Shared pieces
- `src/core/tabs.js` + `src/styles/app.css`: the one tab strip (`.app-tabs`, the Jobs look: pill,
  sliding green ink, arrow keys, panes slide in from the side of the tab).
- `geckoGo(section, tab, client)` in the shell: go anywhere on the right tab (Jobs/Opportunities expose
  `show(tab)`, Timesheets `tshTab`). Overview's Open buttons and the client page use it.
- `openClient(name, tab)` and `clientLink(name)` (`clientLink` re-exported from `core/ui.js`): every
  client name in Jobs, Opportunities, Clients, Profitability and Timesheets opens that client's page.
  The attribute is `data-open-client` (Opportunities already uses `data-client` for its own buttons).

## The client page (`src/sections/client.js`, logic `src/core/client.js`, tests `tests/client.mjs`)
Header: name, status, contact, domains, client since; **Log time**. Four figures: Recurring (this month
once raised, else last month, from Xero), last 12 months invoiced, owed (overdue in red), support hours
left with months-left at the current rate (or service margin when there is no SSA).
Tabs: **Summary** (needs attention for this client, 12-month billed chart, open jobs, opportunities,
VoIP Unlimited dealer services) · **Invoices** (unpaid, recent, Xero links) · **Services & profit**
(service lines, cost/margin bar) · **Support hours** (SSA ring, hours a month, recent work) · **Jobs** ·
**Opportunities**. Read only: each tab links to where things are changed.
Names are matched across systems with `sameClient` ("Kingdom Products Ltd" = "Kingdom Products"; names
under 5 letters must match exactly). A source that fails is named ("Not checked"), never shown as zero.

## Stages
1. (this) Shared tabs, 8-item sidebar with hubs, client page and client links everywhere.
2. Monitoring with a morning check (Overview › Today).
3. Team (who's off, leave, mileage) in the new format.
4. Timesheets in the new format, quick logging from the client page.
5. Month-end close checklist and This week (weekly review) on Overview.

## Stage 3 (9 Oct): Team
- The Team hub opens on **Overview** (`src/sections/team.js`, logic `src/core/team.js`, tests
  `tests/team.mjs`), then Leave and Mileage. Per person (Philip, Jack): in today / off and back when,
  holiday left this tax year as a ring (Leave's rule: entitlement + carry over + adjustment − approved
  Annual Leave, default 140 h, 7 h a day, tax year from 6 April), booked, pending, next off, mileage
  still to claim, hours this week by day vs last week; buttons to Book leave, Claim mileage, Log time.
  Below, **Next four weeks**: who's off each day (approved solid, requested striped, today outlined).
- The older sections' own tab strips (Mileage, Timesheets, Opportunities) get the shared look:
  `geckoInkify()` adds `.app-tabs` and a sliding ink that follows the active tab, however the section
  switches (class or aria-selected); their own handlers are untouched.
