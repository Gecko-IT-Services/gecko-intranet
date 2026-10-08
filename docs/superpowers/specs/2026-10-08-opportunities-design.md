# Opportunities: find the gaps in each client, and turn them into proposals — design

Status: **phase 1 built 8 Oct 2026** (Philip: "create using all the smart tools available… increase the monthly recurring revenue and ensure we don't miss an opportunity").

## Philip's ask (8 Oct)
"Enhance the sales side… opportunities tying in multiple factors… areas of improvement,
for example those users still on Windows 10… fill a likely gap in their business
process, perhaps upselling Hornetsecurity… identify gaps and then push these ideas to the
client." Plus websites: Gecko now does SEO (Rank Math) for ALS Locksmiths and Clarke Lane
Engineering; offer the same to clients whose sites need it.

Also from Philip (8 Oct): Gecko is a **VoIP Unlimited partner**, so VoxOne and all connectivity
(FTTP, SOGEA, Ethernet circuits) are core products; **timesheets** are a source of opportunity
(what clients keep calling about); later, **reward clients** who take more from us.

## The idea in one line
For every client, the dashboard looks at what they already buy, how their email and website
are set up and (later) what their computers are running, works out the likely gaps, and
lets Philip turn any gap into a tracked opportunity and a ready-to-send email in one click.

## Where the signals come from
| Signal | Source | Needs a key? | Phase |
|---|---|---|---|
| What each client buys today (M365, backup, security, Exclaimer, hosting, VoIP, SSA, retainer) | Service lines (`gecko_services`), the feed (TD SYNNEX, Exclaimer, Clook), Xero | No, already in the dashboard | 1 |
| Email security: MX (is it Microsoft 365?), SPF, DMARC policy (none / quarantine / reject), DKIM for M365 | Public DNS, read in the browser over DNS-over-HTTPS | No | 1 |
| Website: HTTPS, performance, SEO and accessibility scores, mobile-friendliness | Google PageSpeed Insights (public API) on the domains we already know (37 from Clook, plus M365 email domains) | No (a free key raises the daily limit later) | 1 |
| Windows 10 machines, old hardware, failing backups, missing patches | Atera device inventory | Yes, so it runs outside the site: Atera's scheduled report email, read by the daily feed task (same pattern as the supplier invoices) | 2 |
| M365 licence mix (Basic vs Standard vs Premium) | TD SYNNEX invoice lines (SKUs per client) | No, already read by the feed | 2 |
| What they keep calling us about | Timesheets list (SharePoint, read only): last 6 months of work descriptions per client, matched against each product's phrases (`ticket_keywords`); System credit rows ignored | No | 1 |

Nothing in phase 1 needs a new password, connector or key in the site.

## Gap rules (first set; Philip edits the wording and prices)
Each rule names the gap, the evidence that triggered it and the product that fills it.
- **No email filtering / weak DMARC** (no DMARC, or `p=none`), on M365 and no Hornetsecurity → *Hornetsecurity 365 Total Protection* + DMARC hardening.
- **M365 but no M365 backup** (no Acronis M365 seats for them) → *M365 backup*.
- **Devices but no endpoint backup or security** (no Acronis workstation / Webroot) → *IS + Backup*.
- **No signatures** (M365 users, no Exclaimer) → *Exclaimer*.
- **No password manager** (no Keeper seats) → *Keeper*.
- **Website slow or poor SEO** (PageSpeed performance or SEO score below a threshold), not already an SEO client → *SEO with Rank Math* / *website refresh*, with the scores as evidence.
- **Website not on Gecko hosting** (domain not in Clook) → *hosting move*.
- **Windows 10 machines** (phase 2, Atera) → *Windows 11 upgrade / hardware refresh*. Windows 10 support ended 14 Oct 2025; businesses on the paid Extended Security Updates programme need a plan, and machines without it are unpatched now.
- **Business Basic / Standard without Defender** (phase 2, SKUs) → *Business Premium*.

Rules are data (a small table of gap → product → default value → email template), so new
ones are added without code.

## What Philip sees
A new **Opportunities** section:
1. **Client gap map:** one row per client, one column per product family; ✓ has it,
   ○ gap, ? unknown. Click a gap to see the evidence (e.g. "DMARC: p=none", "PageSpeed
   mobile performance 38/100").
2. **Opportunity board:** Idea → Proposed → Won / Lost, with client, product, estimated
   monthly and one-off value, next step, and the evidence that started it. The total
   value of open opportunities sits at the top.
3. **Draft to client:** one click writes an Outlook **draft** (never sends) to the client's
   main contact: what we found, why it matters to them, what we'd do, the price. The
   wording comes from the rule's template, filled with that client's evidence.

## Storage and security
- New Supabase tables `opportunities` and `opportunity_rules`, RLS through
  `is_gecko_staff()` like every other table. Signal results are cached per client per day
  (`client_signals`) so the page doesn't re-check every domain on every visit.
- DNS and PageSpeed results are public information about the client's own domains; nothing
  is sent anywhere except Google's public APIs.
- Drafts only; sending stays a human decision. Uses the same `Mail.ReadWrite` consent the
  SSA renewal already asks for, requested on the click, not at sign-in.

## How it is built (phase 1)
- `supabase/migrations/20261008090000_opportunities.sql`: `opportunity_products` (catalogue:
  rule, "already has it" pattern, timesheet phrases, prices, email template; 14 products seeded,
  incl. VoxOne and FTTP/SOGEA/Ethernet), `client_product_status` (has / not interested / n/a),
  `client_domains`, `client_signals` (cached DNS and PageSpeed per domain, re-checked after 30
  days), `opportunities` (idea → proposed → won / lost, £/month, £ one-off, evidence, next step).
- `src/core/opportunities.js` (tested in `tests/opportunities.mjs`): MX/SPF/DMARC/DKIM reading,
  PageSpeed summary, timesheet matching, `holds` (already has it: service-line pattern,
  TD SYNNEX, Exclaimer, Clook, SSA/retainer, MX filter), `evaluate` (gap + plain-English
  reasons + strength: 2 = rule and timesheets agree, 1 = one of them, 0 = simply not bought),
  pipeline totals, email template filling (HTML-escaped).
- `src/sections/opportunities.js`: Gaps (client cards, strongest first; "Check email &
  websites" runs Cloudflare DNS-over-HTTPS and Google PageSpeed; add a domain by hand),
  Pipeline (four columns, edit value / next step / status), Products (prices, in use, email
  text). Headline: Xero recurring revenue, open pipeline, won this month, won to date.
- Client identity: same name matcher as Profitability (`prfXeroMatchName`). Domains come from
  Clook invoice lines, the SSA contact's email address and any added by hand.
- Thresholds (`THRESHOLDS`): SEO < 80 or performance < 50 (mobile), 2+ timesheet hits in 6
  months, 3+ ad-hoc support hours for clients with no SSA block or retainer.
- Verified in a real browser against faked Graph, Supabase, DNS and PageSpeed: gaps, checks,
  draft email, pipeline, no errors, no horizontal scroll at 390px.

## Phases
1. Gap map from what clients already buy + DNS/email checks + PageSpeed; opportunity
   board; draft email. (Data in hand, no keys.)
2. Atera devices (Windows 10, age, backup health) and M365 SKU mix via the daily feed;
   pairs with next week's Atera cost check, which reads the same Atera data.
3. Optional: a monthly "top 5 opportunities" summary, and Claude-written proposals from
   the evidence (run in the scheduled task, not in the browser).
4. **Rewarding clients** (Philip, 8 Oct): once the pipeline is working, a loyalty view built
   on the same data, e.g. a bundle discount or a free review when a client takes N products,
   a referral credit, a thank-you on contract anniversaries.

## Rejected
- **Scraping client websites from the browser:** blocked by browsers (CORS) and fragile;
  PageSpeed gives scores and audits without it.
- **Auto-sending emails:** too easy to send the wrong thing to a client. Drafts only.
- **A CRM product (HubSpot etc.):** another login and subscription for two people; the
  dashboard already knows the clients, their spend and their margins.

## Open questions for Philip
1. ~~Sales Opportunities list~~: not in use (8 Oct); start fresh.
2. Prices: set £/month on the Products tab (Hornetsecurity, Keeper, M365 backup, SEO, …);
   until then those gaps show "price not set" and add £0 to the pipeline.
3. PageSpeed thresholds above are the starting point; change `THRESHOLDS` if they feel off.
