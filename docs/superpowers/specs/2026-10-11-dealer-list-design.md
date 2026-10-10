# VoIP Unlimited dealer list, October 2026

Philip, 11 Oct 2026: the VoIP Unlimited account manager sent "Gecko IT - Dealer Customers (Commission)" (email "Customer
List", 10 Oct) listing every dealer customer's voice, connectivity, notes and fixed monthly commission, and asked which
upsells to look at. Philip: "perhaps we should integrate this too"; "exclude Cowans and MSA as they are moving over to
VoxOne anyway; Cowans already has and MSA are scheduled for the upgrade on the 29th".

## What changed
- `voip_dealer_services` (migration `20261011090000_dealer_list_oct.sql`): the rows for the 15 customers on the sheet are
  replaced by one row per service with the sheet's commission. 8 customers were "services not yet recorded"; now only
  Mr and Mrs Hobbs (not on the sheet) are. Per-customer commission matches the sheet's Monthly Total on every row;
  total £613.50/month. Checked on a local Postgres with every migration applied.
- Cowan Consultancy recorded as 13 × VoxOne (moved), MSA Safety as 4 × VoxOne with the 29 Oct upgrade in the notes, so
  neither raises a VoIP Exchange migration. MSA's existing deal stays Won; no Cowan migration deal existed.
- P&M Packing: the sheet's total (£35.50) doesn't match its parts (7 × £3.50 + 6 maintenance × £3 = £42.50). The sheet
  total is stored and the note says to check with VoIP Unlimited.
- Rules (`src/core/opportunities.js`):
  - VoIP Exchange migration: a site with call recording is marked **Priority** first in the reasons (the account manager:
    the call-recording platform is no longer in use; Waterside and Freeston).
  - Renewal: PSTN lines (Brazier, Clarke Lane) raise a renewal, because the analogue network is due to be switched off by
    31 January 2027.
- Opportunities › VoIP Unlimited: the commission line also shows the fixed commission on the list, beside what Xero
  invoiced (Sep 2026: £638.36 invoiced vs £613.50 fixed; the difference is presumably call usage).

## Connectivity for dealer customers (Philip, 11 Oct: "a good idea to offer Internet connections")
- A dealer customer with no connectivity through VoIP Unlimited (Cutler, Access Instrumentation, Waterside, Bobby Biggs
  today) gets the Connectivity gap with a dealer reason (their phones are through us; VoIP Unlimited call it a quick win,
  for commission; they may be in contract elsewhere, so ask when it ends) and is ranked as a real gap, not the weak
  "not something they buy from us". Customers whose internet is already through VoIP Unlimited are never offered it.

## Not done (Philip to decide)
- Mr and Mrs Hobbs are not on the sheet; left as they were until Philip confirms they have gone.
