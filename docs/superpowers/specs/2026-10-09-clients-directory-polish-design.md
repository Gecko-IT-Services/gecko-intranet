# Clients › Directory polish (9 Oct 2026)

## Why
The directory is the way into every client page, but it was the oldest-looking list in Gecko HQ:
a table/cards switch nobody needs (phones already get cards), a delete button on every row next
to Edit, a finished one-off "Copy to Supabase" button, Title Case labels, and no quick way to see
"who is running low on SSA hours" or "who has no SSA".

## What changed
- **Filter chips with counts** beside the search: All · Active · New · Winding down · Low on hours
  · No SSA. "Low on hours" = an amber or red hours pill (under 2h), archived SSAs excluded. A chip
  with nothing in it is hidden unless selected. Chips and search combine; the empty result says
  which and offers **Show all clients**.
- **The whole row opens the client page** (links and buttons in the row keep their own job).
- **Delete moved into Edit** (left of Cancel/Save, red), then the existing confirm dialog. Rows keep
  View in Profitability and Edit only.
- Archived SSA clients show **SSA archived** instead of their last balance.
- Sentence case: Contact, SSA hours left, Monthly sell, Winding down.

## Removed
- Table/Cards switch and the card renderer: the container query already turns the table into
  cards on a phone.
- Copy to Supabase (clients have been on the database since 7 Oct).

## Not changed
- Balances, revenue and the join are untouched; "Monthly sell" is the same service-line sum as
  before (not Xero).
- Filter and sort are remembered per browser (`gecko.clients.view` in localStorage); the search is not.
