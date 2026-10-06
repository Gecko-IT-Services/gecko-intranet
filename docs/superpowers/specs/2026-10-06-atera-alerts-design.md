# Alerts (Atera triage) — Design

**Date:** 2026-10-06
**Branch:** `feat/atera-alerts`
**Status:** Built, for review
**Author:** drafted by Claude (Felix persona) for Philip; for Jack to review

---

## Why this exists

Atera emails every Critical alert to `support@gecko-it.com`. Between 22 Sept
and 6 Oct 2026 that was 134 emails, about nine a day. When I went through
them, about 125 were noise and four needed a person:

| Noise | Approx. emails |
|---|---|
| Printer "No SNMP response" (three Onsite printers) | 30 |
| Disks hovering at 90.0–92% (Warranty PC alone: 15) | 55 |
| Laptop CPU / memory over 95% | 16 |
| Bob's Home PC offline | 9 |
| One-off "Acronis service stopped", 1–3 Oct (agent update) | 14 |

What needed a person: Hillcrest – Jenny's PC with D: 100% full since 22 Sept;
WCF FP Server with its backup agent stopped; WCF Vicky's laptop at 99.5%
(since cleared to 94%); Clarke Lane Sage PC offline (likely retired).

**The one job:** show what needs a person and hide everything else.

### Non-goals

Not a replacement for Atera's alert console. It does not resolve alerts or
raise tickets; it links to the device in Atera and the email.

## Data source

The same approach as Backups, and for the same reason: Atera's API key can't
live in a public static site. The section reads
`/users/support@gecko-it.com/messages` from `noreply@atera.com` with
`Mail.Read.Shared` (incremental consent, already granted). It needs `body`,
not `bodyPreview`, because one email can carry several devices ("Alert;
Problem" with no device in the subject). The HTML body also gives the
Atera device link.

## Model

- **Entry** = one "Device:" block in an email: client, device, device link,
  status, message.
- **Issue** = all entries for one client + device + kind (+ drive / service).
  Repeats are counted ("6 alerts over 3 days"), never listed.
- Kinds are parsed from the message: `disk` (drive, %), `cpu`, `memory`,
  `service` (name, state), `offline`, `snmp`, `other`.

## Triage rules — `assess()`

| Rule | Level |
|---|---|
| Printer SNMP | noise, always |
| Server (name has "Server", "SRV", "DC"), anything except a one-off CPU/memory spike | **critical** |
| Disk ≥ 98% (latest reading) | **critical** |
| Disk 95–98% | important |
| Disk < 95% | noise |
| Backup agent stopped on a key machine (Sage / File / Database / Accounts / NAS) | important |
| Backup agent stopped on a workstation on 2+ separate days | important |
| One-off agent stop on a workstation | noise |
| Key machine offline | important |
| Home PC or ordinary workstation offline | noise |
| Workstation CPU / memory | noise, always |
| Server CPU / memory on 2+ days | important |
| Unrecognised alert type | important (surface, don't hide) |

Disks are judged on the **latest** reading, so a drive someone cleared from
99% to 94% stops nagging; the peak still shows in the label.

**No "Resolved" emails.** Atera's email setting is Critical-only with
Resolved off (set 6 Sept 2026), so there is no proof an alert cleared. An
*important* issue with no new alert for 3 days drops to noise with a "quiet
for N days" note. *Critical* issues stay until resolved. If Resolved emails
are switched on in Atera, `buildIssues()` already closes issues on them.

Noise is never deleted: "Show filtered" lists it with counts.

## Architecture

Identical to Backups: `src/sections/alerts.js` + `src/styles/alerts.css`
(shares the `.bkp-*` look from `backups.css`), registered in `main.js`,
sidebar entry under Operations after Backups, `SECTION_TITLES.alerts`.
Window 7 / 14 / 30 days, remembered per browser.

## Testing

`node tests/atera-alerts.mjs`: HTML and plain-text parsing (multi-device
emails, brackets in device names, entities), classification, every
`assess()` rule, and a replay of the real fortnight's pattern asserting that
only Jenny's PC and the FP Server surface, the quiet Sage PC drops out, and
a Resolved email closes an issue.
`tests/portal-accessibility-smoke.mjs` nav count 11 → 12.

## Resolved button (added 6 Oct 2026)

Atera sends no "Resolved" email (setting is Critical-only), so without this
a critical issue stays until it ages out of the window.

- SharePoint list **`GeckoAlertResolutions`**, created by hand: `Title` (the
  issue key: client|device|kind|drive|service, lower case) and `Note`
  (multi-line plain text). Who and when come from SharePoint's own
  Created / Created By, so there is nothing to fill in or fake.
- An issue whose latest resolution is after its last alert is `resolved`:
  hidden, viewable via "Show resolved", with Undo (deletes that row).
- An issue that alerts again after being resolved comes back flagged
  "Back again" and is never filtered as noise, so a fix that didn't hold
  can't hide.
- The resolve dialog links to Atera's own "Mark alert as resolved" URL from
  the email, so the Atera console can be cleared in the same step.
- List missing → a one-off setup note on the page; the rest of the page
  still works.

## Email client (added 6 Oct 2026)

"Email client" drafts a plain-English message asking permission to fix the
issue, prefilled from the `Clients` list (`PrimaryContact`, `Email`),
greeting the person named in the device ("Jenny's PC" → "Hi Jenny"). Opens
in Outlook on the web; never sends by itself; no new permissions.

## Fix at source (recommended, separate)

Turn off SNMP monitoring for the Onsite printers, and either raise the Atera
disk threshold to 95% or keep this filter. Fewer emails is better than
better filtering.
