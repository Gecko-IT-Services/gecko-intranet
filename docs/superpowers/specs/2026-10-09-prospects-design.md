# Prospects (new business)

Philip, 9 Oct 2026: last of the contacts/sales improvements (contacts → activity & follow-ups → sharper pipeline →
prospects). Opportunities so far were only for existing clients (plus VoIP Unlimited dealer customers on Gaps); there
was nowhere for a company that isn't a client yet.

## What it does (Opportunities › Prospects)
- **Add prospect**: company (required), contact name/email/phone, where they came from (Referral, Website, VoIP Unlimited
  customer, Networking, Someone we know, Cold approach, Other), what they're interested in, stage (New → Contacted →
  Meeting → Proposal, or Lost), worth £/month (estimate), next step, follow-up date (same shortcuts as elsewhere), notes.
- Open / Won / Lost / All views; counts and £/month per open stage; "£x/mo if they all sign"; follow-ups due.
- Follow-ups: amber when due, red after a week; also on Overview › Today ("Chase prospect Acme today", up to three then
  "n more prospects to chase"), opening this tab.
- **Make client**: adds them to Clients (`gecko_clients`, status New, client since today, interest + notes in the
  client's notes), the contact as main contact (`client_contacts`), a first Activity line saying where they came from,
  and marks the prospect Won with the client name; then opens their client page. Refused when a client with that name
  already exists under any spelling (`sameClient`).

## Data
`prospects` (RLS, staff). Logic `src/core/prospects.js` (tests `tests/prospects.mjs`; Overview in `tests/overview.mjs`).
The Opportunities section loads prospects separately, so the rest of the section still works if they fail to load.

## Not now
Turning VoIP Unlimited dealer prospects into prospects automatically; importing leads from the website form or email.
