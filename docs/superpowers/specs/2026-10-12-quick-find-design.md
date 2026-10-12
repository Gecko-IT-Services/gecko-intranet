# Quick find

Jack, 12 Oct 2026. Gecko HQ has nine sidebar entries, three hubs and a tab strip on almost every page, and no
search. Getting to one client, one job or one invoice means knowing which page and tab it lives on. Quick find
is one box that goes straight there.

Jack's choices: it finds clients and their contacts, jobs, deals and prospects, open tasks, invoices by
number, and timesheet entries, as well as pages and the three everyday actions. Renaming Jobs to Projects is
on hold; this note says "Jobs".

## Opening it
- **⌘K** (Ctrl+K on Windows) from anywhere in the app, including while typing in a field. It does nothing
  when signed out or while another dialog (the task dialog) is open.
- A **Find** row at the top of the sidebar, above Home, with the shortcut shown beside it.
- On the phone, a search button in the top bar beside the menu button.

## The box
A native `<dialog>` in the top third of the screen (not centred, so results grow downwards without the box
jumping), 560px wide, full width on a phone. One text field; results underneath in groups with a small
heading each. The first result is selected (a green tint; no side stripe, as the design system rules). **↑ ↓**
move through every result across groups, and so does the pointer: there is one selection, not a separate
hover. **Enter** opens the selected one, **Esc** or a click outside the box closes it. A click or tap opens a
result. Opening a result closes the box.

With nothing typed it lists the three actions and one line: "Type to find a client, person, job, task,
invoice or timesheet entry."

## What it finds
Up to five results per group, groups in this order.

| Group | Matches on | The row shows | Opening it |
| --- | --- | --- | --- |
| Clients | client name | name | the client's page |
| People | contact name, email | name · client · role | that client › Details & contacts |
| Jobs and deals | title, client | title · client · "job" or "deal", stage · value | an open job: Jobs board with it picked. An open deal: Opportunities › Pipeline with it picked. One that is finished (invoiced, won, lost): that client's Jobs or Opportunities tab |
| Prospects | company, contact name | company · contact · stage | Opportunities › Prospects, scrolled to it |
| Tasks | title, note, client | title · client · who · due | the task dialog |
| Pages | page and tab names | "Clients › Licences" | that page on that tab |
| Actions | the action's words | "Log time" | Log time: Timesheets › Log time. Add task: the task dialog. Add a job: Jobs with the add form open |
| Invoices | invoice number, contact, reference | number · contact · date · total · paid / due / overdue / draft | that client › Invoices |
| Timesheet entries | title, work description | description · client · date · engineer · hours | that client › Support hours |

Timesheet entries are work only: deleted entries and System entries (renewal credits, adjustments) are left
out, as Weekly Summary leaves them out. Internal notes are not searched or shown.

## How matching works
One rule everywhere: **every word typed must match the start of a word in the row's text**, ignoring case.
"harb lane" finds Harbour Lane Architects; "king" finds Kingdom Products but not "checking the backup".
Within a group, a match in the name comes before a match in the supporting text, then shorter names first;
dated things (invoices, timesheet entries) are newest first.

One exception: a query that is only digits also matches the end of an invoice number, so "131" finds
INV-0131.

No typo tolerance and no fuzzy matching: with a few dozen clients, the start of a word is enough and never
surprises.

## Where the data comes from
Two kinds, because two of the lists are large and grow for ever.

- **Read once, searched in the browser** (small): client names (`gecko_clients`, `ssa_clients`), contacts,
  jobs, deals, prospects. Read the first time the box opens, and again on opening if the last read is more
  than five minutes old. Tasks come from the tasks module, which already holds them (they are only read
  here if no page has read them yet, so opening the box never disturbs a task ticked a moment ago). Typing
  filters instantly, with no request.
- **Asked for as you type** (large): invoices (`xero_invoices`) and timesheet entries (`timesheet_entries`,
  1,100+ and growing). From three characters (two if they are digits), 250ms after the last keystroke, the
  database is asked for the newest 50 rows containing each word, and the same start-of-word rule is applied
  to what comes back. A reply to an older query is discarded.
  `ponytail:` "contains" on the server, "start of a word" in the browser; if a word is so common that the
  right row is not in the newest 50, the answer is to type one more word.

Pages and actions are a fixed list in the code. A test checks that every page it lists exists in
`index.html`, so the list cannot quietly go stale when a tab is added or removed.

What is typed is tidied before it is sent to the database: only letters, digits, spaces and `- . @ &` are
kept, so nothing typed can alter the database filter. Access is unchanged: staff only, by the existing rules.

## When things go wrong
- **The lists have not arrived yet**: actions and pages work at once; a line says "Loading clients, jobs and
  tasks…".
- **One list fails to load**: the rest are searched, and a line at the foot names it: "Not searched: jobs
  (reason)". A failed list never reads as "no matches", and it is read again the next time the box opens
  rather than after five minutes.
- **The invoice or timesheet search fails**: that group shows "Invoices could not be searched: reason".
- **Not connected to the database**: pages and actions still work; the foot says to connect.
- **Nothing matches**: "Nothing matches “xyz”." Only shown when every list was searched; if something was
  not, the foot line is shown as well.

## Code
- `src/core/find.js` (pure, tested in `tests/find.mjs`): the pages and actions lists, the matching rule,
  ranking and grouping (`search(index, query)`), tidying text for the database, and an invoice's state.
- `src/sections/find.js`: the dialog, reading the lists, the two database searches, the keyboard, and
  opening a result through `geckoGo` / `openClient`. Registered as `window.GeckoFind` with `open()`.
- Small additions so a result can be opened: `open(id)` exported by `sections/jobs.js` and
  `sections/opportunities.js` (pick that card, the same as clicking it), `openTask(id)` by
  `sections/tasks.js`, and an "add" hook in Jobs for the Add a job action.
- `src/styles/system.css` "11 · Quick find": it belongs to the shell, not to a section. Existing tokens,
  `icon()` for the group icons (a `search` icon joins `src/core/icons.js`), and the listbox pattern for
  screen readers (`role="combobox"` on the field, `role="listbox"` / `option` on the results,
  `aria-activedescendant`).
- `index.html`: the Find row in the one `.sidebar` block, the top-bar button, and the ⌘K listener.

## Not now
- Recently opened items when nothing is typed.
- Searching client notes, activity or emails.
- More actions (log mileage, book leave, new prospect). The list is three lines of data each; add one when
  it is missed.
- Typo tolerance, or ranking by how often something is opened.
- A database search function. One query per large list is enough for two people.
