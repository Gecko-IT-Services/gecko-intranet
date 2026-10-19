# SEO (19–20 Oct 2026)

## Why
Philip: "add an SEO section on the side bar… At the moment ALS and Clarke Lane use us for SEO so we need to stay on top of it for them,
clarke lane is yet to go active, CDA to hopefully follow". ALS pays £250 + £250 a month (two Xero lines, "Monthly SEO Management for
newforestlocksmith.com" and "SEO Management for NFL"); SEO work isn't in timesheets (they hold support hours only).

## What it does
- **Operations › SEO** in the sidebar. Figures: active (setting up, proposed), SEO a month from Xero repeating lines that say SEO,
  worked on this month (n of active), to fix.
- **Sites** (`seo_sites`, seeded: ALS newforestlocksmith.com active since Aug; Clarke Lane clarke-lane.co.uk setting up; CDA
  cdaluminium.uk.com proposed): status, start date, what they want to be found for, notes; Add a site.
- **Weekly check** (Edge Function `seo-check`, Mondays 05:33 UTC, Check now / Check all now; `seo_checks`): the home page as Google reads
  it (title and length, meta description, H1s, canonical, noindex, viewport, lang, Open Graph, schema types, images without alt text,
  speed and size), robots.txt (blocks all?), sitemap (robots line, Rank Math's sitemap_index.xml, sitemap.xml), WordPress and Rank Math.
  Google PageSpeed mobile scores and Core Web Vitals too when the secret `PAGESPEED_API_KEY` is set (the keyless quota is used up
  worldwide). `core/seo.js` `findings` turns it into Fix now / Fix / Suggestion, each with the fix in Rank Math or WordPress terms.
- **Work done** (`seo_work`): what, hours, date, who. An active site with nothing logged by the 15th is flagged here and in Do next
  ("Do this month's SEO for ALS Locksmiths", with the fee); a red finding on an active or setting-up site is a protect item.
- Links to PageSpeed Insights and Search Console for each site.

## Not done (next, with Philip)
- Rankings and clicks: Google Search Console's API needs a Google Cloud project and Philip's consent on the properties.
- Google Business Profile (posts, reviews): its API needs Google's approval.
- A monthly SEO report email to the client from the checks and the work log (the email writer could do it).
