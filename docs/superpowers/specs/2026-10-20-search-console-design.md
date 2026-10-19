# Search Console on the SEO page (20 Oct 2026)

## Why
Philip ("happy to proceed", after the SEO page): which searches find each SEO site, clicks and position, so the monthly SEO can be
shown to work and aimed at what's nearly there.

## How
- One Google sign-in, read only (`webmasters.readonly`), like Connect Xero: SEO › **Connect Search Console** → Edge Function `google-auth`
  (consent URL, one-time state in `private.google_oauth_states`) → Google → `google-callback` (code → tokens in `private.google_tokens`,
  first sync, back to `#google=…`). Secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from Philip's Google Cloud project (OAuth client,
  web, redirect `https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/google-callback`). The same project gives `PAGESPEED_API_KEY`.
- `gsc-sync` daily 06:13 UTC and Sync now: the properties the account can see (`google_status.properties`); each SEO site matched to a
  property (domain property first, then https://www., https://, http://); clicks, impressions, CTR and position per day for ~90 days
  (`seo_search_days`) and the top 50 searches of the last 28 days (`seo_search_queries`, replaced each sync).
- Each site card: last 28 days' clicks, times shown, average position (impression-weighted) and click rate, each against the 28 days
  before, and a 90-day sparkline of clicks (`searchSummary`, `sparkline` in `core/seo.js`). Opened: the searches table, positions 1–10
  green (page one), 11–20 amber (page two: the quickest wins).
- A site Search Console can't see says so (add it as a Domain property, or give the account access). An expired or removed sign-in
  marks the connection off and says to connect again.

## Not done
- Per-page figures, countries, devices. Alerts on a drop in clicks (could join Do next later).
