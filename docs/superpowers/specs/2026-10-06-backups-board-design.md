# Backups Board — Design

**Date:** 2026-10-06
**Branch:** `feat/backups-board`
**Status:** Built, awaiting review and the Entra permission below
**Author:** drafted by Claude (Felix persona) for Philip; for Jack to review

---

## Why this exists

Acronis emails `support@gecko-it.com` after every backup job: about 90 a day
across all clients. Nobody reads them all, so a failure or a dead machine sits
unnoticed among the successes. On 6 Oct 2026 the mailbox showed West Country
Fires' `Tserver.wcf.local` had not backed up for 97 days, visible only in a
daily report email.

**The one job:** answer "are all client backups OK?" at a glance.

### Non-goals

Not a replacement for the Acronis console. No restores, no plan changes, no
writes anywhere. Read-only.

## Scope decision: why emails, not the Acronis API

Same reasoning as Atera in the Projects spec. The Acronis Cyber Protect Cloud
API needs a client secret, and this is a public static site, so any secret in
it is readable by anyone. The emails already exist, already reach a mailbox the
portal can sign in to, and carry everything needed in the subject line.

## Architecture

Follows the Projects board exactly: an ES module registered through
`window.GeckoSections`, lazy `init()` on first visit, manual Refresh, no
bundler.

```
src/sections/backups.js   parse, fetch, render, init
src/styles/backups.css    section-scoped, existing tokens only
tests/backups-board.mjs   pure-function tests, imported directly
```

Shell changes in `index.html`, kept small:

- sidebar entry `Backups`, last under Operations
- `#section-backups` mount after Projects
- `SECTION_TITLES.backups`
- `<link>` to `src/styles/backups.css`
- `getScopedToken()` and an optional `scopes` option on `graphFetch()`

`src/core/ui.js` gains a `syncTableLabels` re-export so the job tables get the
existing phone-card treatment.

### Data source

`GET /users/support@gecko-it.com/messages`, filtered on `receivedDateTime` and
sender `noreply-abc@cloud.acronis.com`, `$select=subject,receivedDateTime,
bodyPreview,webLink`, following `@odata.nextLink`, capped at 3,000 messages.
Window: 24 h (default), 48 h or 7 days, remembered per browser.

### Permission: incremental consent, not a new sign-in scope

Reading another mailbox needs delegated **`Mail.Read.Shared`**. It is not added
to `CONFIG.SCOPES`. If it were, every `acquireTokenSilent` in the app would ask
for it, and until consent was granted every section, and sign-in itself, would
fail.

Instead `getScopedToken(scopes)` asks for it only when Backups loads:

- consent present → silent token, section loads
- consent missing → throws `CONSENT_REQUIRED`, the section shows a "Grant
  mailbox access" button; the button retries with `interactive: true`
  (popup, or redirect in the installed app)
- it never calls `markAuthExpired()`, so a missing mailbox permission can
  never sign the user out of the portal

`graphFetch()` only skips its 401 → sign-out handling when `scopes` is passed.
Every existing call is unchanged.

**One-off setup (Philip, Entra admin):** App registrations → Gecko Mileage
Tracker → API permissions → Add → Microsoft Graph → Delegated →
`Mail.Read.Shared` → Grant admin consent for Gecko. Users also need Full Access
to the support mailbox in Exchange (Philip already has it; check Jack).

## Behaviour

- **Job identity** = client + resource/machine + plan, parsed from the subject.
  Status is the latest email in the window; earlier runs are tallied ("3 runs ·
  2 ok · 1 failed").
- **Statuses** map from the subject: `BACKUP SUCCEEDED` → Succeeded,
  `… WITH WARNINGS` → Warnings, `BACKUP FAILED` → Failed. Any other `BACKUP …`
  subject is shown as a warning, never dropped.
- **Client names** drop the reseller prefix `Gecko IT Services (#0191292) >`.
- **KPI strip** (Compliance-strip shape) doubles as the status filter.
- **Clients** sort failures first; healthy clients start collapsed.
- **Active alerts** come from the latest `DAILY STATUS REPORT` per client with
  any non-zero count. This is the only place an offline machine appears,
  because a machine that never runs sends no job email.
- Failure reasons come from `bodyPreview`, e.g. "The cloud storage is
  temporarily unavailable."

## Failure and edge cases

| Case | Behaviour |
|---|---|
| Permission not granted | Explains it; Grant button triggers consent from a tap |
| Graph 403 (no mailbox rights) | Says which mailbox and how to fix it in Exchange |
| Other Graph error | Error panel with Retry; never looks like an empty board |
| No emails in window | Empty state, not an error |
| Over 3,000 emails | Shows the newest, with a note to pick a shorter window |

## Known limits

- A job that stops completely and sends nothing drops off the board. Daily
  reports catch offline machines. A full fix is an "expected jobs" list:
  deferred until the board has been in use for a few weeks.
- Teams/mailbox jobs at MSA and Onsite warn daily with
  `C2CAgent.O365MailboxCalendarSkipped`. That is noise, but it is shown, not
  hidden. Suppressing known-benign warnings is a candidate next step.

## Testing

`node tests/backups-board.mjs`: subject parsing for all three real Acronis
shapes, daily-report parsing, preview parsing, board building (latest-wins,
tallies, sort order, zero-count reports ignored), Graph path shape, escaping.
`tests/portal-accessibility-smoke.mjs` nav count updated 10 → 11.
