# Nudge for payment, prices in opportunity emails, working Refresh (8 Oct 2026)

Philip: "it would be good to send a nudge email to the customers who have outstanding invoices, a
charming email draft to prompt for payment, we can just click on nudge and it will produce an email to
them chasing the money in a friendly way. Can you also (where you can) include pricings on the draft
email on opportunities, for example on hornet security its £7.50 per user." And: "refresh button
doesn't do anything in jobs and opportunities".

## Nudge (Jobs › Owed to us)
- Each client row has **Nudge**. It writes a reminder into the clicker's own Outlook Drafts (Graph
  `/me/messages`, Mail.ReadWrite, the same as Opportunities' Draft email). Nothing is ever sent by the
  portal; the person reads it and presses Send.
- Who to: the contact's email **in Xero** (where its invoices already go), cc the contact's "include in
  emails" people. Read by the `xero-invoice` function, action `nudge` (one `GET /Invoices/{id}` for the
  contact, one `GET /Invoices/{id}/OnlineInvoice` per invoice for the pay-online link, max 20). Read only;
  the existing `accounting.invoices` scope covers it. If Xero has no email, or can't be reached, the draft
  is still made without a recipient and the toast says why.
- Which invoices: the contact's overdue ones; if none are overdue, all unpaid ones (a heads-up instead).
- Tone (`nudgeEmail` in `src/core/jobs.js`): warm and never accusing ("it may well already be on its
  way"), every invoice with date, amount and due date, total incl. VAT, the pay-online link where Xero has
  one, bank transfer otherwise, "just reply" for copies or problems.
- Logged in `public.payment_nudges` (who, when, which invoices, to whom). The row shows "Nudged 8 Oct by
  Philip", **Open draft** (this session) and **Nudge again**, so nobody chases twice by accident.

## Prices in opportunity emails
- Products gain a **client price** (`unit_price`) **per** `price_unit` (user, seat, device, site, month,
  year, one-off). The email's {{price}} reads "Hornetsecurity 365 Total Protection is £7.50 per user a
  month, plus VAT." Give an opportunity its number of users / seats / devices / sites (`quantity`) and it
  adds "For your 12 users, that comes to £90.00 a month."; saving a new quantity re-works the deal's
  £/month from the client price (unless £/month was changed by hand in the same save).
- `default_mrr` (now labelled "Pipeline £/month") stays the pipeline value and is **never quoted**: for
  dealer products it is Gecko's commission.
- Seeded: Hornetsecurity £7.50/user (Philip), Exclaimer £1.40/user and VoxOne £15.00/seat (their product
  notes). Not seeded, for Philip to set on Products: Microsoft 365 (depends on the plan), connectivity
  (depends on the line), hosting ("typical £199"), Keeper, Acronis M365 backup, endpoint, SEO, support.
- Products without a client price keep the old sentence from the opportunity's own values, now with "plus VAT".

## Refresh
- Both buttons did reload, but silently, and Jobs re-read the hourly copy of Xero, so a payment just made
  in Xero didn't show. Now Jobs › Refresh asks Xero for changes first (as Sync now), then reloads; both
  buttons show "Refreshing…" and confirm ("Jobs refreshed · 3 invoices updated from Xero").

## Failure states
- Before the migration, `payment_nudges` missing is not an error (no "Nudged" shown; the insert fails
  quietly after the draft is made). Xero failing never blocks the draft.
