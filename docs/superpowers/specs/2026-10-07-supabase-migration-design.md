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
| Lists: GeckoClients, GeckoServices, Clients (SSA), Timesheets, MileageJourneys, MileageClients, GeckoLeaveRequests, GeckoLeaveEntitlements | SharePoint lists | Supabase tables |
| GeckoProjects, GeckoCompliance, GeckoPnLReports | Lists behind sections Philip took off the menu (6 Oct) | **Not moved.** Left in SharePoint untouched |
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
  writable only by a signed-in user whose email is in `public.staff` (seeded with
  philip@ and jack@; add people there). `is_gecko_staff()` is the one check every
  policy calls. `tests/supabase-migration.mjs` fails if any table lacks RLS or a policy.
- Sign-in (built in phase 1): MSAL asks Microsoft for a fresh ID token carrying
  sha256(nonce) (`getIdTokenForNonce` in index.html), and `src/core/supabase.js` hands it
  to `signInWithIdToken({ provider: 'azure' })`. One Microsoft sign-in; Supabase keeps
  its own session. Silent where possible, a "Connect" button otherwise. Microsoft
  sign-out drops the Supabase session; a session left by another person is discarded.
  The installed app can't hold a popup, so there the click redirects to Microsoft; the
  raw nonce waits in localStorage and `completeDatabaseRedirect()` in `init()` finishes
  the sign-in and reopens the section (Philip uses the installed app).
- The email check is only sound because the Entra app is **single tenant** (only the
  Gecko tenant can issue its tokens). Confirm "Supported account types: this
  organisation only" before any section switches.
- Outsider ≠ empty: `connectSupabase()` asks `is_gecko_staff()` and throws NOT_STAFF,
  because RLS answers an outsider with empty tables.

## How the switch happens — one section at a time
The code gets a small data layer (`src/core/store.js`): one SharePoint-field →
column mapping per list, and list/create/patch calls that hand back the same
`{ id, fields }` shape Graph does, so a classic-script section keeps its own logic
and only its fetch/create/patch calls branch. Each section reads a flag:
`CONFIG.DATA_BACKEND.<section> = 'sharepoint' | 'supabase'`. A section moves only when
its import has reconciled. Rolling back is flipping the flag back.

Copying data needs no secrets: a Philip-only **Copy to Supabase** button reads
the list through the existing Graph sign-in and writes to Supabase as that signed-in
user, then shows the reconciliation (rows, totals) side by side. Re-runnable; it
replaces the table's contents only before that section has switched.

Phases (each is its own PR, its own design-note update, Philip approves each):
1. **Foundations (merged 7 Oct, PR #27)** — staff, `is_gecko_staff()`, Supabase sign-in.
   It also wired Projects as the trial section; Projects turned out to be off the menu,
   so the next change removes that again. Each section brings its own migration, so
   every table is reviewed with its copy (changed from "all tables up front").
2. **Leave (built 7 Oct)** — `…_leave_drop_projects.sql` drops the unused `projects`
   table and adds `leave_requests` / `leave_entitlements`; `src/core/store.js`; Leave
   branches on `CONFIG.DATA_BACKEND.leave` (still `'sharepoint'`); Copy to Supabase on
   Leave (Philip only) copies both lists and shows rows, hours totals and any field that
   differs. First copy 7 Oct: 17 requests, 232h, 0 entitlements (no list; 140h default),
   every field matched. **Switched 7 Oct** by Philip after a fresh copy. After the
   switch, entitlements are edited in Supabase › Table Editor › leave_entitlements (they
   were edited by hand in the SharePoint list before; the page has never edited them).
3. **Mileage (built 7 Oct)** — `…_mileage.sql`: `mileage_journeys`, `mileage_clients`.
   One flag, `CONFIG.DATA_BACKEND.mileage`, moves both the Mileage section and Overview's
   mileage tiles (Overview reads journeys too), so they never disagree. Overview shows a
   Connect card if the database needs a click. Copy to Supabase (Philip only) shows rows,
   miles and £ totals side by side; a penny out fails. Reads page through Supabase's
   1000-row cap (`selectAllPages`), so a long journey history is never cut short. HMRC
   records: 6-year retention kept; nothing deletes on a schedule. Copy 7 Oct: 74 journeys,
   1671.4 mi, £834.11, 28 destinations, every field matched. **Switched 7 Oct** by Philip.
4. **Clients + Services (built 7 Oct)** — `…_clients_services.sql`: `gecko_clients`
   (incl. `xero_history`, the same JSON text) and `gecko_services`. Three sections read
   and write them (Clients, Profitability, Overview), so all go through one set of
   helpers (`clientListItems/Create/Patch/Delete`) behind one flag,
   `CONFIG.DATA_BACKEND.clients`. Services join clients by name, as in SharePoint; no
   SharePoint id is stored anywhere, so new ids break nothing. Copy to Supabase sits on
   Clients and totals monthly cost and sell. Not copied: GeckoClients/GeckoServices
   columns the dashboard never reads. Projects and Compliance (off the menu) keep reading
   the SharePoint GeckoClients list for their dropdowns, which goes stale after the switch.
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

## Setup Philip does once (before "Copy to Supabase" works)
1. Supabase › Integrations › GitHub: Supabase directory `supabase`, production branch
   `main`, deploy to production on. Migrations apply when the PR merges.
2. Entra › App registrations › Gecko Mileage Tracker: confirm single tenant; Token
   configuration › add optional claim `email` to the ID token; Certificates & secrets ›
   new client secret (Supabase's form requires one).
3. Supabase › Authentication › Sign In / Providers › Azure: on; Client ID
   `c41290c7-3747-4fc3-8e79-c452a7cab1f7`; the secret from step 2; Azure Tenant URL
   `https://login.microsoftonline.com/e508283a-b42d-4afa-bdc2-eb16dcd9933d`.

## Settled
- Scope as above (Philip, 7 Oct). Publishable key in `CONFIG.SUPABASE_KEY`.
- Access: philip@ and jack@ via `public.staff` until Philip says otherwise.

## Deferred
- Supabase Storage for documents; realtime updates; moving the feed's producer off the
  Claude scheduled task.
