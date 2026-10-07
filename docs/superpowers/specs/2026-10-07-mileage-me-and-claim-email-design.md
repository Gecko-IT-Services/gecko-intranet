# Mileage: default to the signed-in driver, and "Email my claim" — Design

Date: 2026-10-07. Asked for by Philip.

## Design
- **Driver default.** `milCurrentDriver()` matches the signed-in account's name/username against the first names of the two drivers (Philip / Jack). The Driver picker is set to that person on load and after each journey is added. Nothing else changes; the picker can still be overridden.
- **Email my claim** (button in the Mileage header). Sends, from the signed-in person's own mailbox via Graph `/me/sendMail` (the `Mail.Send` scope already in `CONFIG.SCOPES`), their unclaimed journeys to `CONFIG.MILEAGE_CLAIM_EMAIL` (philip@gecko-it.com). "Since last claim" = every journey of theirs with no ClaimedDate; the latest ClaimedDate is quoted for context. The email carries a table (date, destination, purpose, miles, rate, amount), totals, and a link back to the portal. Confirm dialog before sending. Nothing is marked claimed by sending; that stays with the person who pays (Mark Claimed…).

## Failure states
- Signed-in account matches neither driver → toast, nothing sent.
- No unclaimed journeys → toast, nothing sent.
- Graph refuses → toast with the error; button re-enabled.

## Non-goals
- No attachment/PDF; the table in the body is enough for a two-person company and reads on a phone.
- No auto-mark-claimed on send.

## Deferred (trigger)
- If Philip wants the claim to also go to Claire/accounts, add a second recipient in CONFIG.
