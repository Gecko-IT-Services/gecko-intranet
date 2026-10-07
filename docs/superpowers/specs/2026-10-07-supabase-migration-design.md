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
  writable only by a signed-in user whose email is in `public.staff` (seeded with
  philip@ and jack@; add people there). `is_gecko_staff()` is the one check every
  policy calls. `tests/supabase-migration.mjs` fails if any table lacks RLS or a policy.
- Sign-in (built in phase 1): MSAL asks Microsoft for a fresh ID token carrying
  sha256(nonce) (`getIdTokenForNonce` in index.html), and `src/core/supabase.js` hands it
  to `signInWithIdToken({ provider: 'azure' })`. One Microsoft sign-in; Supabase keeps
  its own session. Silent where possible, a "Connect" button otherwise. Microsoft
  sign-out drops the Supabase session; a session left by another person is discarded.
- The email check is only sound because the Entra app is **single tenant** (only the
  Gecko tenant can issue its tokens). Confirm "Supported account types: this
  organisation only" before any section switches.
- Outsider ≠ empty: `connectSupabase()` asks `is_gecko_staff()` and throws NOT_STAFF,
  because RLS answers an outsider with empty tables.

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
1. **Foundations + Projects (built 7 Oct)** — `supabase/migrations/…_foundations_projects.sql`
   (staff, `is_gecko_staff()`, `projects`), Supabase sign-in, Projects reads/writes either
   store by `CONFIG.DATA_BACKEND.projects`, and a "Copy to Supabase" button that copies
   GeckoProjects and reconciles field by field. Still `'sharepoint'`: nothing switched.
   Each later section brings its own migration, so every table is reviewed with its import
   (changed from "all tables up front").
2. **Compliance**, then switch Projects + Compliance once Philip has seen them reconcile.
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
- Installed iOS app: if the silent Microsoft token fails there is no redirect leg yet, so
  the person connects once from Safari (ponytail in `getIdTokenForNonce`). Solve before
  Projects switches.
- Supabase Storage for documents; realtime updates; moving the feed's producer off the
  Claude scheduled task.
