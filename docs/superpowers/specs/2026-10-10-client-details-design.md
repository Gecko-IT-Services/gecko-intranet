# Client details: address & map, office number, emails, conversation log

Philip, 9 Oct 2026: "add the customer's address and have a linked map to where they are located, add office number so
that we can call them from our VoxOne, maybe have recent correspondence, maybe emails, and an area to record
conversations with date and time stamps."

## What changes on the client page
- **Details & contacts** tab (was Contacts) starts with **Address & office**: address, postcode (checked, tidied), office
  number, website, visiting notes. Shows a map (OpenStreetMap embed from the postcode's coordinates, looked up once on
  save from postcodes.io, free and keyless), **Directions** and **Google Maps** links, **Call** and **Website**.
- Visiting notes refuse anything that looks like a password or door/alarm code (Cyber Essentials: those belong in the
  password manager).
- **Calling**: every office and contact number is a `tel:` link in international form (+44…), so a click hands it to
  whatever handles phone links on that computer: VoxOne's desktop app when it's set as the default calling app, a
  mobile, or Teams. The click also gets a call log ready on **Activity** (Call, outgoing, who, start time), and on save
  "how long" is filled in from the time since the click.
- **Activity** gains **When** (date and time, defaults to now, not in the future), **How long** (minutes) and **Which
  way** (we called/wrote, they called/wrote). The timeline is ordered by when it happened and shows "Thu 8 Oct, 10:32 ·
  ↗ outgoing · 15 min". Existing entries take their logged time.
- **Emails** tab: recent correspondence, read-only, from your mailbox and support@ (Graph `$search` per client domain and
  per free-mail contact address, `Mail.Read.Shared`, the permission Backups/Alerts already use). Only mail from or to the
  client's domains/contacts is kept (a newsletter that merely mentions the domain is dropped), duplicates across the two
  mailboxes merged, newest first; each has **Open in Outlook** and **Log it** (adds it to Activity as an email with its time
  and direction). Nothing is sent or changed.
- Header: address (links to directions), office number (call).

## Data
`client_profiles` (RLS, staff; one per client by name). `client_activity` gains `happened_at` (backfilled from
`created_at`), `duration_min`, `direction`. Logic `src/core/profile.js` (tests `tests/profile.mjs`), activity changes in
`src/core/activity.js` (tests `tests/activity.mjs`).

## Not now
Multiple sites per client; reading Teams/VoxOne call history automatically (VoxOne CDRs would need its API); attaching emails.
