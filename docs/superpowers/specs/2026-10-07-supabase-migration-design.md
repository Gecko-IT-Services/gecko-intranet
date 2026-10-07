# Move the intranet's data from SharePoint lists to Supabase — design

Status: proposed, 7 Oct 2026. Nothing changes for users until Philip approves each phase.
Supabase project: https://nkobrqzsogtyxriqqwnq.supabase.co (connected to this repo).

## Why
SharePoint lists are slow to query, have to be created by hand, store columns under
mangled names (`Hours_x0020_Remaining2`, `ATERA_x0020_Ticket_x0020_ID`) and keep
business rules in Power Automate flows that live outside this repo. Postgres gives
real tables, schema in git (`supabase/migrations/`), rules as database triggers next
to the data, and row-level security.

## What moves and what stays
| Thing | Today | After |
|---|---|---|
| Lists: GeckoClients, GeckoServices, Clients (SSA), Timesheets, MileageJourneys, MileageClients, GeckoLeaveRequests, GeckoLeaveEntitlements, GeckoProjects, GeckoCompliance, GeckoPnLReports | SharePoint lists | Supabase tables |
| "Update Client Balances" flow (adds new Timesheets hours to `HoursUsed`) | Power Automate | Postgres trigger, same rule; flow switched off at the same moment |
| Profitability feed | JSON file in Documents | Unchanged at first; later the scheduled task writes a Supabase row instead (phase 5) |
| Sign-in | Microsoft (MSAL) | Still Microsoft. Supabase trusts the Microsoft sign-in, so there is still one button |
| Email (leave, mileage claim, SSA timesheet), Atera/backup mailbox reads | Outlook via Graph | Unchanged — this is Microsoft 365's job |
| Gecko Docs files (timesheet copies, client folders) | SharePoint/OneDrive | Unchanged |

Non-goal: leaving Microsoft 365. The company still runs on it; only the dashboard's
*data store* moves.

## Rules carried over unchanged
- **SSA hours are king.** `HoursUsed` values and past Timesheets rows are copied
  exactly, never recalculated, even where historic double counting is visible. The
  import checks: per-client `HoursUsed` total and Timesheets row count/sum must match
  SharePoint to the hundredth before a section switches over.
- The new trigger adds each *new* timesheet row's hours to the client's `hours_used`,
  System credits included — exactly what the flow does. The SharePoint flow must be
  turned off the moment Timesheets switches, or hours count twice. Renewal Undo keeps
  its one exception.
- Money figures reconcile: every imported money column is checked total-vs-total.
- Every rendered value through `escapeHtml`; error states never look empty.

## Security (the site is public)
- Only the Supabase *publishable/anon* key goes in the browser. It is meant to be public.
  The service-role key never enters this repo or the site.
- Row-level security on every table, on from the first migration: a row is readable and
  writable only by a signed-in user whose verified email ends `@gecko-it.com`.
  No table is ever created without a policy. Anonymous visitors get nothing.
- Sign-in: Supabase Auth with the Azure (Microsoft) provider, restricted to the Gecko
  tenant. The Entra client secret lives in Supabase's dashboard, not in the site.

## How the switch happens — one section at a time
The code gets a small data layer (`src/core/store.js`) with the operations each
section needs (list, get, create, update). Each section reads a flag:
`CONFIG.DATA_BACKEND.<section> = 'sharepoint' | 'supabase'`. A section moves only when
its import has reconciled. Rolling back is flipping the flag back.

Copying data needs no secrets: an admin-only **Import from SharePoint** button reads
the list through the existing Graph sign-in and writes to Supabase as that signed-in
user, then shows the reconciliation (rows, totals) side by side. Re-runnable; it
replaces the table's contents only before that section has switched.

Phases (each is its own PR, its own design-note update, Philip approves each):
1. **Foundations** — `supabase/` folder, first migration (all tables + RLS), Supabase
   sign-in alongside Microsoft, `store.js`, import screen. No section switched.
2. **Low-risk first**: Projects, Compliance. Prove the pattern.
3. **Mileage**: MileageJourneys, MileageClients (HMRC records: 6-year retention kept).
4. **Clients, Services, P&L reports, Leave.**
5. **Timesheets + SSA** with the trigger, flow switch-off, Renewal and Archive. Done on
   a quiet day with Jack aware, because of the flow cutover.
6. **Feed** to a table; scheduled task updated in the same change. Then the SharePoint
   lists are left read-only for 3 months (ponytail) before anyone deletes them.

## Failure states
- Supabase down or sign-in to Supabase failing: the section says "Can't reach the
  database" with the error — never an empty table.
- Import mismatch: the section refuses to switch and lists the rows that differ.
- A missing table or column (migration not applied): the toast names the migration.

## Rejected
- **Big-bang cutover**: one bad import breaks every section at once; no rollback.
- **Two-way sync between SharePoint and Supabase**: double the failure modes, and the
  SSA flow would fire twice.
- **Import script run on someone's laptop with the service-role key**: Philip isn't a
  developer and the key is a master key. The in-app import uses normal sign-in + RLS.
- **Supabase email/password logins**: a second set of passwords for two people who
  already have Microsoft accounts.

## Open questions for Philip
1. Confirm the scope above (data moves; email, documents and Microsoft sign-in stay).
2. The Supabase project's publishable (anon) key — safe to share, it is public by design.
3. In Supabase › Integrations › GitHub: which branch deploys migrations, and is the
   Supabase directory set to `supabase`?
4. Who is allowed in: just philip@ and jack@, or anyone `@gecko-it.com`?

## Deferred
- Supabase Storage for documents; realtime updates; moving the feed's producer off the
  Claude scheduled task.
