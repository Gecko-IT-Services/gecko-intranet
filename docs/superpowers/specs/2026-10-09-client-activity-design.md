# Activity & follow-ups per client

Philip, 9 Oct 2026: second of the contacts/sales improvements he chose (contacts, activity & follow-ups, sharper
pipeline, prospects).

## What it does
- Client page › **Activity** tab (after Summary):
  - **Log activity**: Note · Call · Email · Meeting · Visit, a line of text, optionally who with (the client's
    contacts) and a follow-up date (No · Tomorrow · Next week · In 2 weeks · In a month, or pick a date).
  - **Follow-ups**: the open ones, soonest first, "3 days overdue" / "today" / "in 4 days", with **Done** and
    **+1 week**.
  - **Timeline**: everything logged, newest first, with who logged it, who it was with and the follow-up state.
- The client header adds "last in touch 7 Oct (call with Chris)" (calls, emails, meetings and visits; notes
  don't count). The Activity tab badge counts follow-ups due by today (red when any are overdue).
- **Overview › Today › Needs attention**: one line per follow-up due (amber; red once a week overdue), up to five
  then "n more follow-ups due"; Open goes straight to that client's Activity tab.

## Data
`client_activity` (RLS, staff): client name, kind, body, contact (kept by name if the contact is removed),
follow-up date, done at / by, created by. Logic `src/core/activity.js` (tests `tests/activity.mjs`, follow-ups in
`tests/overview.mjs`). Overview reads only follow-ups due by today and not done.

## Not now
Reminder emails, Outlook calendar entries, logging emails automatically from the mailbox.
