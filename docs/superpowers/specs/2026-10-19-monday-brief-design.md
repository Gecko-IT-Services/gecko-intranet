# The Monday brief (19 Oct 2026)

## Why
Philip: "now lets build the monday brief". The week from Gecko HQ, readable in two minutes in Outlook.

## Decision
Philip chose **From Gecko HQ** over an automatic 7am server job: the server route needs a Microsoft "application" permission that can
write to mailboxes (admin consent and a secret), a broader access to justify for Cyber Essentials. Gecko HQ already has the delegated
Mail.ReadWrite it uses for every other draft.

## What it does
- The first time Overview finishes loading on a Monday (figures, then monitoring), the brief is put in **the reader's own Outlook
  Drafts**, addressed to themselves, never sent. Once per person per week, across devices: `weekly_briefs` (week_start, made_by) is
  claimed first; if the draft fails the claim is removed so it can be made again.
- A line under Today's status tiles: "Monday brief: in your Outlook Drafts (made Mon 08:12) · Make it again", or "Make this week's
  brief" (any day; makes one for the current week).
- Content (`core/brief.js`, figures only, no AI): Do next (top 8 with values); last week against the week before (invoiced, hours by
  person, deals won/added/lost, jobs invoiced, payment reminders; `review.weekReview` for last week); this week (who's away, jobs due,
  repeating invoices going out; `overview.thisWeek`); needs a look (red and amber, no tasks or info); sources not read are named;
  a link to Gecko HQ.

## Not done
- Arrives only once Gecko HQ is opened on the Monday (the trade-off chosen).
- No week-on-week comparison of Do next itself.
