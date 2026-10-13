# Jobs: "In Xero" off the board, and invoicing a job marked invoiced by hand

Philip, 13 Oct 2026 (screenshot of the board): "when a job has been sent to Xero it should go to an archive section, I want
it removed from that board. I want to create that Xero invoice but I can't for some reason… I need to do that so that it sits
in drafts."

## What was happening
- **Opportunities and Quote Zone (MSA, £1,600)**: Invoice in Xero made draft INV-0306, but a job only left the board once Xero
  *approved* its invoice (the hourly sync moves it to Invoiced), so it sat in To invoice with "Draft in Xero".
- **Plaud integration Module (MSA, £1,100)**: Mark invoiced was pressed (13 s after the other draft) before any Xero invoice
  existed. Invoice in Xero was only offered on Agreed / In progress / To invoice, so the job could no longer be drafted.

## Now
- A job whose **whole value is in Xero** (drafts included, voided not; `sentToXero` in `src/core/jobs.js`) leaves the board and is
  listed under **In Xero** beside Invoiced and Lost ("Approve and send the drafts in Xero; each moves to Invoiced by itself once
  approved"). Its stage is unchanged, so Sales this month / On course for count it exactly as before; part-invoiced jobs stay on
  the board for the rest. In Xero is a list, not a drop zone.
- **Invoice in Xero** is also offered on a job marked invoiced that has **no invoice number yet** (`canInvoiceInXero`), and never
  on one whose whole value is already in Xero (a second draft would double-bill).
- The Invoiced list starts with **Not in Xero yet** (was "Not matched to a Xero invoice"), then **Draft in Xero** (approve and send
  it; a draft is no longer listed as "Awaiting payment"), Awaiting payment, Paid.

## Rejected
- Moving a job to Invoiced the moment its draft is made: the draft isn't counted by Xero, so the job would drop out of Sales this
  month until approved, and a draft deleted in Xero would leave an "invoiced" job with nothing behind it.
