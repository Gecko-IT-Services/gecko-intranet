# Acronis, connected directly (sync)

Philip, 18 Oct 2026: "it needs to be monitored better". The same day West Country Fires' file server and domain controller
(FPServer) turned out to have had no backup since 18 Apr, and Tserver none since its Acronis service stopped. Tserver had
already been seen 97 days stale on 6 Oct (`2026-10-06-backups-board-design.md`) and was still missed. Clearing their old
copies saved ~400 GB.

## Why the emails aren't enough

Monitoring › Backups reads Acronis's job emails. A machine that stops completely sends none, so it drops off the board
(the board's own "known limits"). Coverage ("what should be backed up and isn't") can't come from emails at all.

The 6 Oct note rejected the Acronis API because the site is public and can't hold a secret. Since 8 Oct secrets live in
Supabase Edge Functions (Xero, Atera), so that reason is gone.

## What this change does (step 1 of part 1)

Edge Function `acronis-sync`, read only towards Acronis (GET requests plus the token request), four times a day from the
scheduler (`x-cron-secret`) and on demand by staff. Secrets: `ACRONIS_CLIENT_ID`, `ACRONIS_CLIENT_SECRET`,
`ACRONIS_BASE_URL` (`https://eu8-cloud.acronis.com`), API client created by Philip on 18 Oct.

1. Token: client credentials (`/api/2/idp/token`), then the API client's own tenant (`/api/2/clients/{id}`).
2. Customers: tenants under it (`/api/2/tenants?parent_id=`), going through folders and partners, kind `customer` kept.
3. Usage per customer (`/api/2/tenants/usages`): workloads by type, storage, Microsoft 365 seats: what Atera bills.
4. Per customer, with a token scoped to that customer: resources (machines, M365 sites/mailboxes), resource statuses (last
   good backup, next backup), agents (online, version), protection plans, alerts.

Everything is kept as Acronis sent it (`raw`) in `acronis_items` (one row per thing, `kind` says what), plus
`acronis_tenants` and `acronis_status`. Acronis's field names for the per-customer endpoints aren't fixed in their public
docs, so the page (step 2) is built against real rows, not guesses. An endpoint that fails for one customer is recorded in
`acronis_status.problems` and the others carry on; a customer's rows of one kind are replaced only when that fetch fully
worked, so a hiccup never empties the board. A failed token fails the whole run and says so.

## Step 2 (next, once real rows are in)

Monitoring › Backups › **Coverage**, the client page and Overview › Today:
- servers in Atera (Server / Domain Controller) with no Acronis plan → red;
- SharePoint / Teams not protected for any client (Philip's rule: every client's SharePoint is backed up);
- no successful backup in 48 h, whatever the reason (failed, or silent) → red;
- Acronis agent offline while Atera says the machine is online (the Tserver case).

## Part 2 (later)

Storage per backup and stale archives (plan or machine gone, $ per month each); Clients › Atera reading live usage instead
of waiting for the monthly breakdown xlsx.

## Rules

- Read only. Nothing in Gecko HQ changes Acronis: no plans, no Run now, no deletes.
- Staff read the tables (RLS, `is_gecko_staff()`); only the function writes.

## Rejected

- Reading the Acronis console's own pages: needs Philip's session, breaks when they change the UI.
- Per-customer API clients: one client at the partner tenant sees every customer.
