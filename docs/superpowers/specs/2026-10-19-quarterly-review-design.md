# Quarterly review (19 Oct 2026)

## Why
Philip chose it ("1-3 i like very much"; "yes go ahead with the quarterly review"): turn a routine catch-up into a sales meeting:
what we did, what changed, what's at risk, what to propose.

## What it does
- Client page › Upgrades & advice › **Write quarterly review with AI** (beside the advice and IT-at-a-glance writers; same note,
  facts panel, check before sending and editable preview).
- Facts = IT at a glance (computers, protection, Microsoft 365 backup, email, services, not seen, ticked recommendations with prices
  and "What we keep fixing" evidence, left-out machines) + **lastThreeMonths** (`quarterFacts`): the last 91 days of the client's
  timesheet work, jobs and hours in total and by work type (Gecko HQ's sums), and up to 40 newest distinct job titles for the
  writer to pick highlights from. Shown in the facts panel as "Last three months".
- The writer (`email-writer`, kind `review`, Sonnet 5.5, ~4 to 6p): sections in order (the last three months; your IT now; worth
  keeping an eye on; what we'd recommend), ending with a suggested review call or visit. Kept in `client_insights` (kind review).
- **Draft email in Outlook** to the main contact (products in it become Proposed, as with advice), or **Print or save as PDF** (a
  clean page with the client, preparer and date) to take to the meeting.

## Not done
- No comparison with the previous quarter's review yet (they're kept, so it can be added).
- Xero (what they paid) is left out: a review is about their IT, and money conversations are Philip's.
