# Gecko Intranet — guidance for Claude Code

Internal dashboard for Gecko IT Services (Philip Morris, Jack Morris), named **Gecko HQ** (Philip, 8 Oct;
not "Internal Portal"). Live at
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
- `index.html` (~14k lines) holds the shell, the design system CSS and the
  original sections (Overview `ovw*`, Profitability `prf*`, Mileage
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
- Sidebar (Philip, 9 Oct, 8 entries): Home (Overview) · Sales (Clients, Opportunities, Jobs) · Operations
  (Timesheets, Monitoring) · Admin (Team, Settings). **Hubs** group sections under one entry with the
  shared tab strip: Clients = Directory + Profitability + Licences + client page; Monitoring = Backups + Alerts;
  Team = Overview (`src/sections/team.js`: who's in, holiday left as day tokens, next four weeks, hours, mileage to claim)
  + Leave (tax-year wall planner, click two days to book; `2026-10-09-team-wall-planner-design.md`) + Mileage (`HUBS`/`renderHub` in index.html). Older tab strips get the shared look via `geckoInkify()`. Every section uses the same tabs
  (`src/core/tabs.js`, `.app-tabs` in `src/styles/app.css`). Any client name → `clientLink(name)` →
  that client's page (`src/sections/client.js`). Navigate with `geckoGo(section, tab)`.
  Design: `2026-10-09-gecko-hq-structure-design.md` (workflow answers and the stage plan).
- Design system (10 Oct 2026, `2026-10-10-design-consistency-design.md`): `src/styles/system.css`
  loads last and is anchored on `#app`; it defines the header actions row (Refresh + "Synced HH:MM"),
  `.btn` family (`btn-primary` ink, `btn-ghost`, `btn-danger`, `btn-success`, `btn-sm`), hairline figure
  panels, error vs empty boxes and `.badge`. New UI uses these classes; never add a bespoke button,
  pill or KPI card. Sentence case for all labels.
  Page-level loading/empty/error states carry retro gecko art (9 Oct, `2026-10-09-retro-gecko-states-design.md`):
  add `art art-loading|art-empty|art-none|art-offline|art-clear` to the state box; never on small inline states.
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
- The manual CSP cost import (CSV → m365 service lines) was removed 9 Oct; TD SYNNEX
  invoices only come in through the feed. Git history has it if ever needed.
- Months the feed does not cover fall back to the typed service lines.
- Clients › **Licences** (10 Oct, `2026-10-10-licence-check-design.md`): Microsoft 365, TD SYNNEX invoice (feed `cspInvoices`)
  vs Xero lines with item code M365 in the same month, per client; seats × rate per product once the feed carries
  `customers[].skus` (optional; must add up to the customer's cost or `validateFeed` refuses the feed), totals per client until
  then. Read only, reports differences without pricing advice. `src/core/licences.js`, tests `tests/licences.mjs`.
- The page (9 Oct, `2026-10-09-simpler-profitability-design.md`): one status line, one line of figures, one
  table with **Needs a look** first (losing money, margin under 40%, Xero £1+ under the lines, not billed in a
  finished month: `src/core/profitability.js`, tests `tests/profitability.mjs`); a row opens its service lines.
  The Xero CSV import, manual Xero figures, category filters and grand total are gone: the feed is the only way in.

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
  Projects is replaced by Jobs. The Compliance and P&L pages were removed 9 Oct (their GeckoCompliance and GeckoPnLReports lists stay in SharePoint and in Settings › Backup).
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
- Page (tidied 9 Oct, `2026-10-09-tidier-opportunities-design.md`): opens on Pipeline (board; List kept); tabs Pipeline ·
  Gaps (Map by default) · Prospects · VoIP Unlimited · Products; three figures (Recurring revenue, Open pipeline, Won this month).
- Gaps (Clients list or a clients × products **Map**, `mapCell`; `2026-10-09-opportunities-whiteboard-design.md`) come from what a client buys (service lines, feed), public email/website checks
  (Cloudflare DoH, Google PageSpeed, no keys) and six months of timesheet descriptions.
  The catalogue (rules, patterns, prices, email text) is data in `opportunity_products`,
  edited on the Products tab. "Draft email" only ever creates an Outlook draft. Emails quote the
  **client price** (`unit_price` per `price_unit`, e.g. Hornetsecurity £7.50 per user, Philip 8 Oct) and the total
  when the opportunity has a `quantity`; `default_mrr` is the pipeline value (commission for dealer
  products) and is never quoted.
- Client page › **Contacts** (9 Oct): several people per client in `client_contacts` (role, email, phone, one main contact,
  seeded from the SSA list); header shows the main one. `src/core/contacts.js`. Design `2026-10-09-client-contacts-design.md`.
- Client page › **Activity** (9 Oct): log notes/calls/emails/meetings/visits with an optional follow-up date (`client_activity`);
  due follow-ups appear in Overview › Today › Needs attention and open the client's Activity tab. `src/core/activity.js`.
  Design `2026-10-09-client-activity-design.md`.
- Client page › **Details & contacts / Emails** (10 Oct): address + postcode map (postcodes.io → OpenStreetMap embed), office
  number as `tel:+44…` (VoxOne dials; a click readies a call log with duration), website, visiting notes (no passwords/codes);
  Emails tab = read-only Graph search of your mailbox, the rest of the team's (`TEAM_MAILBOXES`; needs Read and manage on
  their mailbox) and support@ (`Mail.Read.Shared`) for the client's domains, Log it → Activity.
  Activity has When / How long / Which way. `src/core/profile.js`. Design `2026-10-10-client-details-design.md`.
- Client page › **+ Opportunity** (9 Oct): add one from the catalogue (quantity × client price) or typed by hand;
  `newOpportunity()` in `src/core/opportunities.js`. Design `2026-10-09-client-new-opportunity-design.md`.
- Pipeline (9 Oct): follow-up dates, quiet-deal flag (14 days), Board (a whiteboard of stickies, drag between stages; default) / List, Won → **Create job** (one-off part, once per
  deal via `jobs.source_ref = 'opp:<id>'`) and **Mark done** for monthly billing; due follow-ups and won deals to set up show on
  Overview › Today. `dealState`/`jobFromDeal`/`boardColumns`. Design `2026-10-09-sharper-pipeline-design.md`.
- Opportunities › **Prospects** (9 Oct): new business that isn't a client yet (`prospects`: source, interest, stage New →
  Contacted → Meeting → Proposal / Lost, £/month estimate, follow-up); **Make client** adds them to Clients (New) with contact
  and a first activity line. `src/core/prospects.js`. Design `2026-10-09-prospects-design.md`.
- Windows 10 / device gaps wait for Atera data in the feed (phase 2, with the Atera cost check).
- **VoIP Unlimited: Gecko is both reseller and dealer** (Philip, 8 Oct). Reseller = Gecko bills
  the client (service lines). Dealer = the client buys direct from VoIP Unlimited under the dealer
  account (support@gecko-it.com) and Gecko earns monthly commission, invoiced in Xero to the
  contact "Voip Unlimited" (shown as one line at the top of the VoIP Unlimited tab, never as a client's revenue).
  Dealer services live in `voip_dealer_services` (Opportunities › VoIP Unlimited tab). A dealer
  customer is never offered VoxOne, nor connectivity they already have there (Philip, 11 Oct: those without it are offered it via the dealer route); instead out-of-contract/expiring lines raise
  a renewal, VoIP Exchange seats raise a VoxOne migration (£4/seat commission), and dealer
  customers who aren't IT clients appear as prospects for IT support.
- Dealer list refreshed 11 Oct from the account manager's commission sheet (`2026-10-11-dealer-list-design.md`): one row per
  service with fixed commission (£613.50/month); Cowan and MSA are VoxOne (no migration); call recording = priority VoxOne
  upgrade (Waterside, Freeston); PSTN lines raise a renewal (switch-off due 31 Jan 2027).

## Ask Gecko HQ (from 11 Oct 2026)
- Sidebar foot (desktop) / top bar **Ask** (phone) → dialog → Edge Function `ask` (Claude `claude-opus-5-5`, read-only tools:
  `query_table` via PostgREST as the caller so RLS applies, fixed SQL for `ssa_balances` (Philip's rule), `timesheet_hours`,
  `xero_sales`). Answers link `[[Client]]` names. Logged in `ask_log`; daily cap `ASK_DAILY_LIMIT` (150). Secret
  `ANTHROPIC_API_KEY`. Never writes or sends. `src/sections/ask.js`, `src/core/ask.js`, design `2026-10-11-ask-gecko-hq-design.md`.

## Jobs (from 8 Oct 2026)
- `src/sections/jobs.js` + `src/core/jobs.js` (tests `tests/jobs.mjs`); design note
  `2026-10-08-jobs-design.md`; opens on a **whiteboard** (9 Oct, `2026-10-09-jobs-whiteboard-design.md`: Ideas from
  Opportunities + stage columns of stickies, drag or arrow to move, drop an idea to make the job). One-off client work with a value, Quoted → Agreed → In progress →
  To invoice → Invoiced (or Lost), in Supabase `jobs`. Invoiced jobs are kept (the record); the Invoiced view
  groups them Awaiting payment / Not matched / Paid (last 90 days, older on request).
  Tidied 9 Oct (`2026-10-09-tidier-jobs-design.md`): header Add a job; three figures (Invoiced this month, On course for,
  Owed to us); tabs **Jobs** (the whiteboard only; Invoiced/Lost "See them" lists under it; no List view) · **This month**
  (how it adds up, still to come, invoiced by client, six months, the Xero line) · **Owed to us**. Old tab keys passed to
  `show()` (`overview`, `tocome`, `invoiced`, `xero`) open This month.
  Chart colours Gecko Green (recurring) & Indigo (one-off), striped = still to come (`--viz-*`). Replaces the old Projects board
  (off the menu since 6 Oct; its code was removed 9 Oct).
- "Sales this month" reads Xero from the feed: invoiced so far + repeating invoices not yet raised
  (last month's recurring contacts missing this month) + jobs to invoice + jobs due this month.
  VoIP Unlimited commission is excluded. Since Xero phase 2 this reads Xero directly (below); the
  feed is the fallback when Xero isn't connected.

## Xero, connected directly (from 8 Oct 2026)
- Edge Functions `xero-auth` / `xero-callback` / `xero-sync` / `xero-invoice` (Deno, `supabase/functions/`),
  scope `accounting.invoices` (reads; writes drafts only, phase 3). Hourly `pg_cron` sync into `xero_invoices` and
  `xero_repeating_invoices` (staff read-only); status in `xero_status`; Connect / Sync now on
  Jobs › This month. Functions are deployed from the repo after merge (not by the GitHub integration).
- Phase 2 (8 Oct): once connected, Jobs › This month reads those tables, not the feed: invoiced (net,
  AUTHORISED + PAID, same rule as the feed), still to come from actual repeating-invoice dates,
  drafts listed not counted, jobs matched to their invoice by number (Paid / Awaiting / Overdue),
  and "Owed to us" (amount due incl. VAT). Profitability still reads the feed.
- Phase 3 (8 Oct): **Invoice in Xero** on a job creates a **DRAFT** sales invoice only (function
  `xero-invoice`, scope `accounting.invoices`); Philip approves and sends it in Xero. Once per request
  key (`public.xero_pushes`, also the audit trail); only contacts and items already used in Xero; the
  number is added to the job, and the hourly sync moves the job to Invoiced once approved.
- Nudge (8 Oct): Jobs › Owed to us › **Nudge** drafts a friendly payment reminder in the clicker's Outlook Drafts
  (never sent by the portal) to the contact's Xero email, with pay-online links (`xero-invoice` action `nudge`, read
  only); logged in `payment_nudges`. Jobs › Refresh syncs Xero first. Design `2026-10-09-nudge-and-prices-design.md`.
- Timesheets › Log Time (9 Oct; simplified the same day, `2026-10-09-simpler-timesheets-design.md`: one short form, no time card,
  chips, date shortcuts or detailed notes; Enter logs; description one line for the Lists backup), time typed as 1:30 / 1h30 / 45m or tapped, SSA balance preview before saving, checks in
  `src/core/timelog.js` (errors stop; duplicates, future/old/weekend dates, long days, going over SSA need **Log anyway**),
  one save at a time, draft kept in the browser. No "Billable" switch: every entry counts against the balance. Design
  `2026-10-09-timesheets-entry-design.md`. SSA Dashboard (9 Oct): summary, Needs attention/All, per-client hour tokens (one per prepaid hour), status,
  use per month and run-out date from the last 90 days (`src/core/ssa.js`; balances never recalculated). Design
  `2026-10-09-ssa-dashboard-design.md`. Weekly Summary (9 Oct): one week at a time with ‹ ›, totals vs the week before, by
  day/client/work type, weekdays with nothing logged, 8-week trend, entries (`src/core/weekly.js`; work only, no System entries).
  Design `2026-10-09-weekly-summary-design.md`.
- Phase 4 (8 Oct): the SSA renewal box offers **Create draft in Xero** (same function, `source: 'ssa'`,
  n × SSA at £650, account 214, reference Renewal); drafts for that client in the last 45 days are listed.

## Overview (rebuilt 8 Oct 2026; Today/Business tabs 9 Oct)
- Tabs: **Today** · **This week** (weekly review vs last week) · **Month-end** (self-ticking close checklist;
  TD SYNNEX/Atera ticked by hand in `month_end_checks`; banner on Today in the last 5 working days) ·
  **Business**. Logic `src/core/review.js`. **Today** = the morning check (status tiles for backups 24h, alerts, money, support hours, jobs,
  team; Monitoring list from `window.GeckoMonitor` = Backups/Alerts `snapshot()`; Needs attention; This
  week) and **Business** = the money. Landing page answers: how is the money doing (Xero: Sales, Recurring, Owed to us, Pipeline tiles), what
  needs me (one list, red → amber → info, each with an Open button to the right tab), and this week (away,
  jobs due, repeating invoices next 7 days, hours). Design `2026-10-08-overview-design.md`; logic
  `src/core/overview.js` (tests `tests/overview.mjs`); database reads `src/sections/overview.js`; page
  `ovw*` in index.html + `src/styles/overview.css`. A source that fails is named ("Not checked"), never
  shown as zero. Backups/Alerts are not read here (mailbox reads too slow for the landing page).
  Neatened 9 Oct (`2026-10-09-neater-overview-design.md`): the greeting is the header (with Log time), and
  Monitoring's rows are part of the one Needs attention list; no Quick actions bar.

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
  the MSAL account). "Email my claim" (on your own driver card since 9 Oct) sends the signed-in driver's unclaimed
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
  Gecko Docs → draft invoice in Xero (or the lines to type in). `CONFIG.SSA_EMAIL_MODE` is 'draft' (Outlook Drafts of the
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
- Client portal (Philip, 9 Oct: "put a pin in it, pick it up next week"): clients see their timesheets and past
  invoices. Proposed, not decided: a separate read-only page (not inside Gecko HQ), emailed sign-in link for
  contacts Philip adds, one client per login enforced by RLS with tests that try to read another client's rows,
  safe columns only (date, engineer, hours, work description; invoice number/date/total/due/status + Xero online
  link), never internal notes, costs, margins or opportunities; pilot with one client. Alternative: a monthly
  statement email per client. Open questions: who signs in, all work or SSA only, pilot client.
- Monthly statement email per client (Philip, 9 Oct: liked it, then "leave that one too for now… payments are managed
  by direct debit and it works well; think about it next week"). Nothing built. Idea: Outlook draft per client for a
  month (work done + hours, SSA left, invoices raised/owed), from the client page or a Clients › Statements tab.

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
