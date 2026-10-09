# Settings: simpler page — Design

Date: 2026-10-09 (Jack). Same pass as 2026-10-09-simpler-profitability-design.md.

## Why
Jack, 9 Oct: Settings is hardly used, "just full of unnecessary info"; what it is for is changing the
look. The page had eight blocks: a profile card (job title, department, office, phone from Graph),
appearance (theme, density, accent), the Azure app registration, resolved SharePoint list IDs,
Portal info ("Phase 11 — Annual Leave"), System health (SharePoint-era sections only), an Operational
watchlist (a second, older Needs attention) and two buttons.

## Design
- **Who's signed in**: one line, initials avatar, name and email (from the MSAL account, no Graph call).
- **Appearance**: Theme (Light / Dark / System) and Accent (Green / Blue / Amber), as before.
- **Data and sign-in**: Export backup ("Every SharePoint list and database table as one JSON file") and
  Clear cache & sign out ("If sign-in gets stuck on this device"), each with its one-line reason.
- Header "Settings". Shared design system: `.btn`, the segmented control, sentence case.

## Removed
- Job title, department, office, phone, the profile photo, and their two Graph calls (`/me`,
  `/me/photo/$value`; the photo also leaked an object URL per visit).
- Density (Jack: not wanted). A saved Compact or Roomy is ignored, so everyone gets the standard
  spacing; its CSS goes.
- Azure app registration, SharePoint list IDs, Portal info, System health, Operational watchlist, and
  their code (`setRenderHealth`, `setRenderWatchlist`, `setHealthPill`, the list-ID gathering). The
  details live in the code and CLAUDE.md; Overview › Needs attention does the watchlist's job with the
  current rules.

## Unchanged
How theme and accent are saved (`gecko.portal.preferences.v1`) and applied; both buttons' behaviour.

## Failure states
None new: nothing on the page loads data. Export backup reports its own errors (incomplete backup
named in the toast).

## Testing
Full suite (the accessibility smoke test reads the page markup). Browser preview: light, dark, 390px.

## Rejected
- Keeping a connections panel (Microsoft, database, Xero, feed): Jack didn't pick it; each section
  already says when its source fails.
