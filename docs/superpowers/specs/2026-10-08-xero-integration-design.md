# Xero, connected directly — design

Status: **phase 1 built 8 Oct 2026** (connection + hourly sync of sales invoices and repeating
invoices). **Phase 2 built 8 Oct 2026** (Philip: "go"): Jobs and "Sales this month" read
invoice-level data (below). **Phase 3 built 8 Oct 2026** (Philip: "from that jobs page I would
like the option to invoice to xero"): a job can raise a DRAFT invoice in Xero (below).

## Why
Philip (8 Oct): "establish a proper Xero integration". Until now Xero reached the dashboard only
as monthly totals per contact, through the daily feed written by a scheduled Claude task. That
can't say which invoice a job became, whether it's paid, or when a repeating invoice is next due.

## Shape
- **Xero app** "Gecko Dashboard" (Web app) registered by Philip at developer.xero.com; redirect URI
  `https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/xero-callback`. Client id and secret are
  **Supabase Edge Function secrets** (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`); never in the site,
  the repo or chat.
- **Scopes**: `offline_access accounting.invoices` (phase 3; was `.read`); the granular scope that new
  Xero apps must use from 2 March 2026 (the broad `accounting.transactions` is closed to them).
  Overridable with an `XERO_SCOPES` secret if Xero names it differently, without a deploy.
- **Edge Functions** (`supabase/functions/`, Deno, shared code in `_shared/xero.ts`):
  - `xero-auth`: staff only (Supabase session → email in `public.staff`); stores a one-time state
    and returns Xero's consent URL. The site sends the browser there.
  - `xero-callback`: Xero returns here. Accepts only a state issued in the last 15 minutes,
    exchanges the code, picks the organisation (the Ltd, "Gecko IT Services": the old "Gecko IT"
    org, to May 2026, is shared with the app too; an `XERO_ORGANISATION` secret overrides; switching
    organisation clears the other's invoices and forces a full sync), stores the
    tokens, runs the first sync and sends the browser back to `…/gecko-intranet/#xero=connected`.
  - `xero-sync`: hourly from `pg_cron` (minute 17) with a secret from `private.cron_secret`, or on
    demand by staff ("Sync now"). Refreshes the token (Xero rotates refresh tokens: the new one is
    saved first), pulls sales invoices changed since the last good sync (all of them the first
    time; 100 per call) and every repeating invoice (sales only).
- **Storage**: tokens and OAuth state in schema `private` (not exposed by the API, no browser role
  can read it). `public.xero_status`, `public.xero_invoices` (every status, net/tax/total, amount
  due/paid, repeating-invoice link, line items) and `public.xero_repeating_invoices` (schedule,
  next date, amounts) are **read-only to staff** (select policy only); only the functions write.
- **Calls**: about 3 per hourly run against Xero's Starter limit of 1,000 per organisation per day.
  Xero's Starter developer tier is free for up to 5 connected organisations (we have one).

## In the dashboard (phase 1)
Jobs › Sales this month: a Xero panel. Not connected → "Connect Xero" (staff). Connected → the
organisation, last sync time, invoice and repeating counts, "Sync now", "Reconnect"; a failed sync
shows Xero's error. Coming back from Xero opens Jobs › Sales with the result.

## In the dashboard (phase 2)
Once Xero is connected and synced, Jobs › Sales reads `xero_invoices` / `xero_repeating_invoices`
instead of the daily feed (the feed stays the fallback; Profitability still reads the feed).
Logic in `src/core/jobs.js` (`xeroMonthSales`, `xeroHistory`, `repeatDates`, `jobInvoice`, `owed`).
- **Invoiced this month**: net (`sub_total`) of AUTHORISED + PAID sales invoices by invoice date,
  VoIP Unlimited commission kept out; "recurring" = raised from a repeating invoice. The same rule
  as the feed: June–September matched it to the penny.
- **Still to come**: each repeating invoice (not deleted, either approval setting) whose schedule
  lands later this month, at its own amount and date (weekly ones as often as they fall, never past
  the end date). Replaces "last month's recurring contacts not yet billed".
- **Drafts**: draft / awaiting-approval invoices dated this month are listed, not counted (often
  the same work as a job "to invoice").
- **Jobs ↔ invoices**: the invoice number typed on a job (case and spaces ignored) shows Paid,
  Awaiting payment (amount, due date), Overdue, Draft, Voided or Not found. A job whose invoice is
  already raised isn't counted again in the projection, and a "to invoice" one says "mark invoiced".
- **Owed to us**: Xero's amount due on approved invoices (incl. VAT), overdue first, per contact,
  and a KPI. Includes what VoIP Unlimited owes in commission.
- Loads six months of invoices, every unpaid one and any older invoice a job names (no line items).

## Invoice in Xero (phase 3)
On a job that is agreed, in progress or to invoice: **Invoice in Xero** → contact, item,
description, amount, reference → **Create draft in Xero** (after a confirm).
- **Always a draft.** Philip checks, approves and sends it in Xero. Nothing is emailed to a client
  from the dashboard, matching the "drafts only" rule for email.
- **Function** `xero-invoice` (staff only): `options` lists the contacts and item codes Gecko has
  already invoiced (from synced invoices; only those can be used), suggests the contact by name;
  `create` posts one invoice: today's date (London), due on the contact's usual terms (their last
  invoice) or 14 days, net amounts, the item's usual account (VAT from that account's default).
- **Once only.** Each form has a request key, claimed in `public.xero_pushes` before Xero is called
  and sent to Xero as its Idempotency-Key: a double click or retry can't make two invoices. A failed
  attempt keeps Xero's message and can be retried. `xero_pushes` is the audit trail (who, what, when);
  staff can read it, only the function writes.
- **The job**: the invoice number is added to the job (a deposit and the balance can both be raised;
  the form starts from what's left). When the hourly sync sees the job's invoices approved and
  covering its value, an open job moves to **Invoiced** by itself (dated as the latest invoice).
  Numbers typed by hand are shown, never acted on.
- **Scope**: `accounting.invoices` (read and write, invoices only). The current connection already
  has it; a read-only connection gets "Reconnect Xero" instead of an error.
- Rejected: approving in the dashboard (who may send invoices is a Xero decision); creating new
  Xero contacts or items from the dashboard (typos would make duplicates; first invoice in Xero).

## SSA renewal → Xero (phase 4, Philip 8 Oct: "post an invoice to xero from the timesheet renewal")
- Timesheets › SSA › Renew…: once the timesheet email is done, the box offers **Create draft in
  Xero**: contact (suggested by name), `n × SSA — Software Support Agreement - 10 hours` at £650,
  account 214, reference "Renewal" (all from `src/core/ssa-renewal.js` `SSA_XERO`), after a confirm.
- Same function and rules as jobs (`xero-invoice`, `create` with `source: 'ssa'`, quantity = blocks):
  a DRAFT, once per renewal (request key made when the renewal opens), contact and item must
  already be used in Xero. `xero_pushes` records `source`, `ssa_client_id`, `quantity`.
- Drafts made for the same client in the last 45 days are listed in the box, so a second
  renewal isn't invoiced twice by mistake. Undo after a draft was made says to delete it in Xero
  (with a link); nothing deletes Xero invoices from the dashboard.
- Not connected / no SSA item / an error: the box keeps the details to type in and Copy details.

## Verified
- Functions type-check with Deno 2.1.
- Against a simulated Xero and a real Postgres with every migration: connect, first sync (paged:
  101 invoices), incremental second sync (only the changed invoice, now Paid), access-token reuse
  and refresh-token rotation, supplier templates ignored, status recorded.
- Phase 4: simulated Xero + Postgres: SSA options (contact suggested), create 2 × SSA (Quantity 2,
  £650, account 214, due on terms), same key once, recent list, bad quantity/client/item refused;
  browser: renewal box → confirm → draft link; recent warning.
- Phase 3: against a simulated Xero and real Postgres with every migration: options (contact
  suggested, deleted contacts and repeating-only items left out), create, same key again (one Xero
  call), bad amount/contact/item refused, Xero's validation message recorded and retry, read-only
  connection refused, approval → sync → job Invoiced. Browser: form, confirm, draft badge with link.
- Phase 2: unit tests in `tests/jobs.mjs`; browser at 1366px and 390px (no overflow, owed and
  to-come tables become cards on a phone).
- Browser: panel not connected → Sync → connected; Connect sends the browser to Xero; the return
  lands on Jobs › Sales with the message and a clean address bar.

## Deployment
Migrations deploy through the Supabase GitHub integration on merge, as always. The three functions
are deployed to project `nkobrqzsogtyxriqqwnq` from `supabase/functions` after merge (gateway JWT
check off: the callback is reached by a browser redirect and the sync by the scheduler; each checks
its caller itself).

## Rejected
- **A key in the browser** (implicit/PKCE flow from the static site): the refresh token would live
  in a public page's storage. No.
- **Xero Custom Connection** (client-credentials, no consent screen): needs a paid Xero
  subscription per organisation; the Web-app flow is free on the Starter tier.
- **Writing to Xero** beyond draft sales invoices: not asked for.
