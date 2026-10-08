# Gecko Intranet — guidance for Claude Code

Internal dashboard for Gecko IT Services (Philip Morris, Jack Morris). Live at
https://gecko-it-services.github.io/gecko-intranet/ from `main` via GitHub Pages.
Built by Jack; extended by "Felix" (an AI technical-manager persona Philip uses in
the Claude app) during 6–7 Oct 2026. This file is the handoff from that work.

## Read first
- `docs/superpowers/specs/` — one design note per feature (why, non-goals,
  rejected alternatives, failure states, deferred items). The Oct 2026 notes
  describe the current Profitability model; read `2026-10-07-*` before touching it.
- `CODE_REVIEW_FINDINGS.md` — earlier review notes.
- `tests/*.mjs` — run `for t in tests/*.mjs; do node $t; done` before any commit.

## Shape of the code (do not fight it)
- Static site. No bundler, no framework, no TypeScript, no build step. Deploy is
  `git push` to `main`; GitHub Pages serves with a ~10-minute cache, so after a
  merge wait a couple of minutes and hard-refresh (Cmd+Shift+R).
- `index.html` (~17.5k lines) holds the shell, the design system CSS and the
  original sections (Overview `ovw*`, Profitability `prf*`/`csp*`, Mileage
  `mil*`, Clients `cli*`, Timesheets `tsh*`, Leave `lev*`) as one inline script.
- Newer sections are ES modules: `src/sections/<name>.js` + `src/styles/<name>.css`,
  registered in `src/main.js` as `window.GeckoSections.<key> = { init }`.
  Pure logic that must be testable lives in `src/core/*.js` (no `window` at top
  level) and is registered onto `window` in `src/main.js`.
- `src/core/graph.js` / `ui.js` re-export the shell's globals (`graphFetch`,
  `resolveSiteId`, `toast`, `escapeHtml`, `syncTableLabels`). One Graph client only.
- Auth: MSAL.js, Entra app "Gecko Mileage Tracker". `CONFIG.SCOPES` is
  `User.Read, Sites.ReadWrite.All, Mail.Send`. Do not add scopes there; a scope
  without consent breaks sign-in for everyone. Section-only permissions go through
  `graphFetch(path, { scopes })`.
- Data is SharePoint lists on `geckoitservices812.sharepoint.com/sites/GeckoITClientPortal`
  (GeckoClients, GeckoServices, Clients [= SSA], Timesheets, MileageJourneys,
  MileageClients, …). Lists and columns are created by hand in SharePoint, never by
  code. If a feature needs a column, the code must tolerate its absence and the
  toast must say exactly what to add.
- Secrets never go in the browser: the site is public. Anything needing a key
  (Xero, TD SYNNEX, Atera) runs outside the site: the daily feed, or Supabase Edge Functions
  (`supabase/functions/`, secrets in Supabase › Edge Functions › Secrets, tokens in schema
  `private`). Xero is connected directly since 8 Oct (`2026-10-08-xero-integration-design.md`).
- Conventions: feature branch → PR → merge. Design note in
  `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md` for every feature. Every
  rendered value through `escapeHtml`. Error states must never look like empty
  states. Existing CSS tokens only (`--card`, `--border-dim`, `--green`, `--amber`,
  `--red`, `--muted`, `--radius`; fonts Schibsted Grotesk / JetBrains Mono); section
  CSS scoped under `#section-<key>`. `ponytail:` comments mark accepted ceilings.
- Sidebar order (Philip, 8 Oct): Home (Overview) · Sales (Opportunities, Jobs, Profitability,
  Clients) · Operations (Timesheets, Alerts, Backups) · Admin (Leave, Mileage, Settings).
- Mobile: tables with ≥4 columns are turned into stacked cards by a container
  query (`syncTableLabels()` marks them `data-rt`); tab strips are scroll rails.
  Anything new inside a card-mode table must be covered too (see the `tfoot`
  rules added 7 Oct). Check at 390px before merging layout changes.

## Profitability: the model as of 7 Oct 2026 (Philip's rules)
- **Xero is king for revenue.** Card headline "Recurring" = Xero invoices raised
  from repeating templates in the selected month; everything else is "One-off",
  shown beside it and never counted in profit.
- **Everything sits in the month it was invoiced, on both sides, consistently.**
  Supplier invoices (TD SYNNEX M365, Exclaimer, Clook) land on the client as
  read-only "Invoiced" rows in the month the invoice is dated. Annual items are
  never spread. While the feed covers them, `m365` service lines contribute no
  cost and `hosting` lines contribute neither cost nor sell (they show "from
  invoices" / "from Xero"). Service lines still carry the monthly items (Atera,
  VoIP, retainers) and the sell for non-hosting lines.
- Clook's Reseller-Enterprise plan (£29.99/mo) is a shared cost, not allocated.
- The current month shows no licence cost until the TD SYNNEX invoice lands
  (~16th); the Xero box says so. Hosting clients swing month to month. Both are
  intended.
- The Import CSP Costs panel is no longer rendered; `csp*` import code remains
  one release (ponytail) and can be deleted after November 2026 if the automatic
  path has held.
- Months the feed does not cover fall back to the typed service lines.

## Supabase (moving off SharePoint lists, from 7 Oct 2026)
- Plan and state: `docs/superpowers/specs/2026-10-07-supabase-migration-design.md`.
  Project `nkobrqzsogtyxriqqwnq`; schema only in `supabase/migrations/`, applied by the
  Supabase GitHub integration on merge to `main` (never change schema by hand).
- `CONFIG.DATA_BACKEND.<section>` says where a section's data lives. **Leave is on
  Supabase** since 7 Oct (`leave_requests`, `leave_entitlements`); its SharePoint lists
  are no longer updated. **Mileage is on Supabase** since 7 Oct (`mileage_journeys`,
  `mileage_clients`; the same flag moves Overview's mileage tiles); MileageJourneys and
  MileageClients in SharePoint are no longer updated. **Clients + Services are on
  Supabase** since 7 Oct (`gecko_clients`, `gecko_services`; one flag moves Clients,
  Profitability and Overview together via `clientList*` helpers); GeckoClients and
  GeckoServices in SharePoint are no longer updated. **Timesheets and the SSA `Clients` list**
  (Philip, 8 Oct, reversing 7 Oct): the database becomes the master (`ssa_clients`,
  `timesheet_entries`, flag `CONFIG.DATA_BACKEND.timesheets`) and **every change is still written
  to the Lists** so they stay a complete backup and the flows keep running; entries made in Lists
  or the Power App are brought in on Refresh. Design: `2026-10-08-timesheets-on-supabase-design.md`.
  Switched 8 Oct 2026 (copy: 22 clients, 1143 entries, 162.75 h, every balance matched). The feed is moving to the
  `profit_feed` table (`CONFIG.DATA_BACKEND.feed`; see `2026-10-08-feed-on-supabase-design.md`).
  Compliance/P&L are not moving; Projects is replaced by Jobs.
- Access is `public.staff` (philip@, jack@) via `is_gecko_staff()`; every table has RLS
  and a policy (`tests/supabase-migration.mjs` enforces it). Only the publishable key
  is in the site. Sign-in is the Microsoft ID token (`src/core/supabase.js`).
- `src/core/store.js` maps SharePoint fields ↔ columns and returns Graph's
  `{ id, fields }` shape so a section's logic doesn't change when it moves. A section
  moves by: migration → Copy to Supabase (green) → fresh copy → flip its flag.

## Opportunities (from 8 Oct 2026)
- `src/sections/opportunities.js` + `src/core/opportunities.js`; design note
  `2026-10-08-opportunities-design.md`. Goal (Philip): grow monthly recurring revenue and never
  miss an opportunity. Gecko is a VoIP Unlimited partner (VoxOne, FTTP, SOGEA, Ethernet).
- Gaps come from what a client buys (service lines, feed), public email/website checks
  (Cloudflare DoH, Google PageSpeed, no keys) and six months of timesheet descriptions.
  The catalogue (rules, patterns, prices, email text) is data in `opportunity_products`,
  edited on the Products tab. "Draft email" only ever creates an Outlook draft.
- Windows 10 / device gaps wait for Atera data in the feed (phase 2, with the Atera cost check).
- **VoIP Unlimited: Gecko is both reseller and dealer** (Philip, 8 Oct). Reseller = Gecko bills
  the client (service lines). Dealer = the client buys direct from VoIP Unlimited under the dealer
  account (support@gecko-it.com) and Gecko earns monthly commission, invoiced in Xero to the
  contact "Voip Unlimited" (shown as the Dealer commission KPI, never as a client's revenue).
  Dealer services live in `voip_dealer_services` (Opportunities › VoIP Unlimited tab). A dealer
  customer is never offered VoxOne or connectivity; instead out-of-contract/expiring lines raise
  a renewal, VoIP Exchange seats raise a VoxOne migration (£4/seat commission), and dealer
  customers who aren't IT clients appear as prospects for IT support.

## Jobs (from 8 Oct 2026)
- `src/sections/jobs.js` + `src/core/jobs.js` (tests `tests/jobs.mjs`); design note
  `2026-10-08-jobs-design.md`. One-off client work with a value, Quoted → Agreed → In progress →
  To invoice → Invoiced (or Lost), in Supabase `jobs`. Invoiced jobs are kept (the record); the Invoiced view
  groups them Awaiting payment / Not matched / Paid (last 90 days, older on request).
  Tabs at the top (Jobs, Month overview, Still to come, Invoiced in <month>, Owed to us, Xero);
  chart colours Gecko Green (recurring) & Indigo (one-off), striped = still to come (`--viz-*`). Replaces the old Projects board (off the
  menu since 6 Oct); its open projects can be brought across once (`source_ref`).
- "Sales this month" reads Xero from the feed: invoiced so far + repeating invoices not yet raised
  (last month's recurring contacts missing this month) + jobs to invoice + jobs due this month.
  VoIP Unlimited commission is excluded. Since Xero phase 2 this reads Xero directly (below); the
  feed is the fallback when Xero isn't connected.

## Xero, connected directly (from 8 Oct 2026)
- Edge Functions `xero-auth` / `xero-callback` / `xero-sync` / `xero-invoice` (Deno, `supabase/functions/`),
  scope `accounting.invoices` (reads; writes drafts only, phase 3). Hourly `pg_cron` sync into `xero_invoices` and
  `xero_repeating_invoices` (staff read-only); status in `xero_status`; Connect / Sync now on
  Jobs › Sales. Functions are deployed from the repo after merge (not by the GitHub integration).
- Phase 2 (8 Oct): once connected, Jobs › Sales reads those tables, not the feed: invoiced (net,
  AUTHORISED + PAID, same rule as the feed), still to come from actual repeating-invoice dates,
  drafts listed not counted, jobs matched to their invoice by number (Paid / Awaiting / Overdue),
  and "Owed to us" (amount due incl. VAT). Profitability still reads the feed.
- Phase 3 (8 Oct): **Invoice in Xero** on a job creates a **DRAFT** sales invoice only (function
  `xero-invoice`, scope `accounting.invoices`); Philip approves and sends it in Xero. Once per request
  key (`public.xero_pushes`, also the audit trail); only contacts and items already used in Xero; the
  number is added to the job, and the hourly sync moves the job to Invoiced once approved.

## The feed (where the money numbers come from)
- `Gecko Dashboard Data/profitability-feed.json` in the portal site's Documents
  library, written daily at 06:47 Europe/London by a scheduled task in Philip's
  Claude account ("Gecko Dashboard profitability feed"). It is **not** in this
  repo. It reads Xero (12 months, current+previous refetched, older carried over),
  the TD SYNNEX CSP invoice emails (13 months), Exclaimer invoices, Atera receipts
  and Clook invoices from philip@gecko-it.com, and uploads via Graph. It is also written
  to `public.profit_feed` (one row, same JSON) through the Supabase connector; the site reads
  whichever `CONFIG.DATA_BACKEND.feed` names, via `fetchProfitFeed()`.
- The task's prompt holds two name maps (Clook domain → Xero client; TD SYNNEX end
  user → Xero client). Unknown names surface on the page as "unassigned" rather
  than being guessed. Felix maintains the maps; ask Philip, then update the task.
- `src/core/profit-feed.js` validates the file (`validateFeed`): a bad section
  rejects the whole feed and the page says so; nothing is half-applied. It also
  holds the pure logic: `splitByClient` (recurring/one-off), `invoicedCosts`
  (supplier lines per client per month). Tests in `tests/profit-feed.mjs`.
- Feed shape is version 1 with optional sections; older files still validate.
  Never change a section's meaning without bumping what `validateFeed` accepts
  and updating the task prompt in the same change.

## Other things shipped 6–7 Oct 2026
- Timesheets: "Archive" on SSA cards sets a Yes/No column `Archived` on the
  Clients list (Philip added it). Archived clients leave the cards, the picker and
  the Overview count; hours and entries are kept; "Restore" is one click.
- Mileage: Driver picker defaults to the signed-in person (first-name match on
  the MSAL account). "Email my claim" sends the signed-in driver's unclaimed
  journeys since their last claim to `CONFIG.MILEAGE_CLAIM_EMAIL` via
  `/me/sendMail`. Sending does not mark anything claimed.

## SSA hours (Philip's rule, 7 Oct 2026 — "this is king")
- Never adjust existing SSA balances (`HoursUsed` on Clients) or past Timesheets entries, even
  where historic double counting is visible. No corrections, credits or recalculations.
- On the database, balances are opening balance (copied as SharePoint had it) + changes since
  (`src/core/timesheets.js` `balances`); never recomputed from all entries. Time is in quarter
  hours (0.25); adjustments are System entries made with Adjust… on the SSA card.
- A SharePoint flow adds every new Timesheets entry's hours to `HoursUsed` ~30s after it is
  created (System credits included). Code that creates entries must never also write `HoursUsed`
  on the Lists (on the database the backup copy is a new item, so the flow still does it).
  Sole exception: the renewal dialog's Undo, which takes back the exact credit it just added.

- **SSA renewal** (Timesheets › SSA › Renew…): System credit entry → waits for the "Update
  Client Balances" flow → timesheet email from `CONFIG.SSA_FROM_MAILBOX` (support@) → copy in
  Gecko Docs → Xero lines to type in. `CONFIG.SSA_EMAIL_MODE` is 'draft' (Outlook Drafts of the
  person clicking, Mail.ReadWrite) until Philip says switch to 'send' (Mail.Send.Shared + Send As).
  Logic in `src/core/ssa-renewal.js`. Flows involved (Power Automate, shared with Philip, owned by
  Jack): Update Client Balances, Create Timesheets Table Email, Archive Old Timesheet Entries.

## Open items (ask Philip before acting)
- Plain-text client passwords exist in SharePoint (Gecko Docs/clients/Technix/…)
  and OneDrive copies. Cyber Essentials risk; move to a password manager.
- The Ltd started June 2026. Xero months before that are empty and skipped.
- Planned for w/c 12 Oct 2026 (Philip): (1) security sweep (start with the plain-text
  passwords above); (2) Atera cost check: each month's Atera bill (SD-Enterprise +
  AppCenter usage: Acronis, Webroot, Keeper, EndUser Remote; per-client breakdown xlsx)
  against what each client is billed in Xero, to find seats/workloads billed to us but
  not to a client, and trim the bill.

Resolved 8 Oct:
- Kingdom Products now has service lines matching Xero's £189.82 (IS + Backup 43.50 /
  8.14 stack; M365 33.72 m365, cost from invoices; VoIP + FTTP 112.60 / 82.60 other).
  Costs: Atera breakdown (Acronis + Webroot, USD) and VoIP Unlimited bill p1538966
  (Voxone £10/seat, FTTP £42.60). Technix service lines match Xero (£215.90 retainer).
- Atera breakdown Sep 2026: hosted storage summary 2,318 GB vs 2,312 GB per client
  ($0.24 unallocated). Mentioned to Philip; not chased.
- Exclaimer prints "Gecko IT Services" as end user on some client subscriptions; the
  feed now maps by account code: 7CF1C-80B → Onsite Commercial Services (15-user
  Standard), A9356-F39 → Gecko's own (10-user Starter), `shared: true`, shown as a Gecko
  cost like the Clook reseller plan (`invoicedCosts` honours `shared` on Exclaimer lines).
- slaterfamily.me.uk is Pam Slater's, billed to LS Commercials (Xero INV-0131, Jul 2026).

## Working with Philip
- He is the owner, not a developer. Give him exact commands and say what he will
  see. One step at a time; ask one question when a decision is his to make.
- Money figures must reconcile: supplier invoices are checked line-sum vs total
  before they are used; keep that discipline for anything new.
- Statutory/compliance matters (GDPR, Cyber Essentials) are stated precisely,
  with evidence, never loosely.
