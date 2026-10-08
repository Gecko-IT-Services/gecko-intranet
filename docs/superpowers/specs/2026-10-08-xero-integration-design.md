# Xero, connected directly — design

Status: **phase 1 built 8 Oct 2026** (connection + hourly sync of sales invoices and repeating
invoices). Phase 2: Jobs and "Sales this month" read invoice-level data (matching jobs to their
invoice, the projection from actual repeating-invoice dates).

## Why
Philip (8 Oct): "establish a proper Xero integration". Until now Xero reached the dashboard only
as monthly totals per contact, through the daily feed written by a scheduled Claude task. That
can't say which invoice a job became, whether it's paid, or when a repeating invoice is next due.

## Shape
- **Xero app** "Gecko Dashboard" (Web app) registered by Philip at developer.xero.com; redirect URI
  `https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/xero-callback`. Client id and secret are
  **Supabase Edge Function secrets** (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`); never in the site,
  the repo or chat.
- **Scopes**: `offline_access accounting.invoices.read`. Read-only; the granular scope that new
  Xero apps must use from 2 March 2026 (the broad `accounting.transactions` is closed to them).
  Overridable with an `XERO_SCOPES` secret if Xero names it differently, without a deploy.
- **Edge Functions** (`supabase/functions/`, Deno, shared code in `_shared/xero.ts`):
  - `xero-auth`: staff only (Supabase session → email in `public.staff`); stores a one-time state
    and returns Xero's consent URL. The site sends the browser there.
  - `xero-callback`: Xero returns here. Accepts only a state issued in the last 15 minutes,
    exchanges the code, picks the organisation (the one named Gecko, else the first), stores the
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

## Verified
- Functions type-check with Deno 2.1.
- Against a simulated Xero and a real Postgres with every migration: connect, first sync (paged:
  101 invoices), incremental second sync (only the changed invoice, now Paid), access-token reuse
  and refresh-token rotation, supplier templates ignored, status recorded.
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
- **Writing to Xero** (raising invoices from Jobs): not asked for; would need write scopes and a
  review of who may raise invoices. Read-only until Philip asks.
