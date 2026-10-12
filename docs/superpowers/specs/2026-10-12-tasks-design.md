# Tasks: client promises and handing work over

Jack, 12 Oct 2026. Philip pitches and Jack delivers, with some crossover. What gets lost today is the promise
made to a client ("ring Pam back about the Wi-Fi") and the handoff between the two of them ("Jack, can you set
up the new starter"). Gecko HQ works out most of Needs attention from Xero and Jobs, but the only to-do anyone
can write is a follow-up date on a client note, which has no "who".

Jack's brief: everything the two of them need, clear in how it is displayed and organised. His choices:
tasks live in the lists already used (no new page), the other person finds out in Gecko HQ only (no email),
client follow-ups become tasks, and a deal's or prospect's chase date stays where it is.

## What a task is
One line of what needs doing, **who** does it, **when** it is due, and usually **which client**. Optionally
a one-line note. Every task has a person and a date: the date defaults to today, so it costs nothing, and a
task with no date is how a list rots.

Anyone can tick, edit, move or delete any task. There are two of them; permissions would only get in the way.

## Overview › Today
The page header gains **Add task** beside Log time. The Needs attention card gains a **Mine / Everyone**
switch (remembered in the browser, `gecko.tasks.who`). "Mine" is the signed-in person, matched by first name
as Mileage does; if the name is neither Philip nor Jack the card shows Everyone and no switch.

The card reads top to bottom, in this order:

1. **The one list**, as now, with tasks in it. A task row has a round tick where a worked-out row has its dot.
   - Order: red, then new handoffs, then amber, then info. Within a colour, tasks come before worked-out rows.
   - A task is **amber** on its due date and after, **red** once it is more than 7 days overdue (the rule
     follow-ups already use).
   - A task someone else gave you is **new** until you open or tick it. It shows a "New from Philip" badge and
     sits in the list straight away, whatever its date.
   - Row: tick · title · under it `client (link) · from Philip · note` · due on the right ("today",
     "2 days overdue", "tomorrow", otherwise "Fri 16 Oct").
2. **Later**: your tasks due after today that you have already seen, by date. No colour. The first five, then
   "Show all 9".
3. **Waiting on Philip**: open tasks you gave him. Each says "not seen yet" or "seen Mon 12 Oct", and its due
   date, in red text once overdue. This is how you know a handoff was picked up.
4. **Done**: a link at the foot, "Done · 6 in the last 30 days". It opens the list with who ticked it and when,
   and **Reopen**.

With **Everyone**, the list and Later hold both people's tasks, each with the person's initial in their
colour (`--who`, as on the job stickies), and the Waiting group is hidden because everything is already shown.

**Add task** opens a short form at the top of the card: What (one line, 140 characters) · Client (the client
list, or "No client") · Who (Philip | Jack, defaults to you) · Due (Today · Tomorrow · Next week · a date) ·
Note (optional, one line). Enter saves, Esc closes.

**Clicking a task** opens it in place with the same fields, **Save** and **Delete** (asks once). Opening a
task that was given to you marks it seen. Changing Who hands it over: it becomes new for the other person.

**Ticking** a task strikes it through and leaves it where it is with **Undo** until the page is next
refreshed, so a slip of the thumb on the phone costs nothing.

The card's count and the red figure on the Today tile include tasks the same way they include every other row.

## Client page › Activity
- A **Tasks** panel replaces Follow-ups and moves to the top: this client's open tasks for both people, the
  same rows, and **Add task** with the client already filled in.
- **Log activity** keeps its Follow up row (No · Tomorrow · Next week · In 2 weeks · In a month · a date).
  Picking a date shows two more fields: **Who** (defaults to you) and **What needs doing** (one line; left
  empty, it is the first line of the note, cut at 140 characters). Saving the note then makes the task, linked
  to the note.
- The timeline shows the linked task on its note: "task for Jack, due 16 Oct", then "done 14 Oct by Jack".
- The Activity tab's badge counts this client's tasks due by today (red when any are overdue), as it counted
  follow-ups.

## What happens to the follow-ups already there
The migration copies every follow-up on `client_activity`, open and done, into `tasks`: title is the first
line of the note (140 characters), due date and done state as they were, given to whoever logged the note,
already seen, linked to the note. From then on the site neither reads nor writes
`client_activity.follow_up_on / follow_up_done_at / follow_up_done_by`. The columns stay; nothing is deleted.

Deal follow-ups (Opportunities › Pipeline) and prospect chase dates are untouched and stay in the one list
as worked-out rows.

## Data
```sql
create table public.tasks (
  id           bigint generated always as identity primary key,
  title        text not null check (title <> ''),
  note         text not null default '',
  client_name  text not null default '',               -- '' = not about one client
  assigned_to  text not null check (assigned_to <> ''), -- 'Philip' | 'Jack' (PEOPLE in core/team.js)
  assigned_by  text not null default '',               -- who last chose assigned_to
  seen_at      timestamptz,                            -- null = new to assigned_to
  due_on       date not null,
  done_at      timestamptz,
  done_by      text not null default '',
  activity_id  bigint unique references public.client_activity(id) on delete set null,
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  modified_at  timestamptz not null default now()
);
```
RLS on, staff policy, `touch_modified_at` trigger, an index on open tasks by due date: the same as
`client_activity`.

- A task you give yourself is seen from the start (`seen_at` = now). Giving it to someone else sets
  `assigned_by` to you and clears `seen_at`.
- "New from X" = `assigned_by` is not `assigned_to` and `seen_at` is null. "Waiting on X" = open,
  `assigned_by` is you, `assigned_to` is X.
- Names are the first names in `PEOPLE`, as Leave stores them. The table does not check the name, so a third
  person needs no migration.

## Code
- `src/core/tasks.js` (pure, tested in `tests/tasks.mjs`): `cleanTask` (what was typed → a row or an error),
  `level` (red / new / amber / none), `groups(tasks, me, today, everyone)` → `{ now, later, waiting }`,
  `dueLabel`, `titleFromNote`. It reuses `dueText` and `followUpChoices` from `core/activity.js`.
- `src/sections/tasks.js`: the reads and writes (open tasks, done in the last 30 days, add, save, done,
  reopen, delete, seen) and the one row and one form used on both pages. Registered as `window.GeckoTasks`
  for Overview's classic script; imported by `sections/client.js`.
- `src/core/overview.js` `attention()` takes `tasks` and `me` and returns task rows among its items, so the
  counts stay in one place. Its `follow_up` rows go, with `dueFollowUps` and the client page's Done / +1 week.
- `src/sections/overview.js` `loadDb()` reads open tasks instead of due follow-ups.
- `src/styles/system.css` gains "10 · Tasks" (row, tick, group heading). It is a shared component on two
  pages, so it lives with the design system and uses its tokens, `.btn`, `.badge` and `icon()`. The tick is
  a real checkbox. `team.css` adds `#section-client` to the sections that get the person colours.
- CLAUDE.md gets a short Tasks paragraph.

## When things go wrong
- **Tasks can't be read**: Overview says "Not checked: tasks (reason)" under the list, as it does for every
  other source; the client page's panel shows the red error box with Retry. Neither ever reads as "no tasks".
  If the table is not there yet (the site went live before the migration), the message says so.
- **A save fails**: a toast gives the reason and the form stays open with what was typed. A tick that fails
  is un-ticked and says why.
- **The note saved but its task didn't**: the toast says exactly that ("Note saved. The task was not:
  reason"), and the task can be added from the Tasks panel above.
- **Both edit one task**: last save wins. Two people, short rows.
- **The page was left open**: tasks are re-read when you come back to the tab, if the last read is more than
  five minutes old. Without this, an in-app-only handoff can sit unseen behind a stale page all day.
- **Going live**: a follow-up logged from a cached copy of the old site after the migration has run would
  write to the old columns and not appear as a task. Merge when neither of you is logging, then both
  hard-refresh. `ponytail:` accepted for a ten-minute window and two users.

## Not now
- A Tasks page or board. Tasks are promises and handoffs, not projects; a board adds a "Doing" column nobody
  would keep up to date, and a second place to look.
- Email, Teams or phone notifications. Jack chose Gecko HQ only. Add an "Email them too" tick if a handoff is
  missed.
- Steps inside a job. Jack did not pick it. When wanted, it is a `job_id` on this table and "2 of 5" on the
  sticky, replacing `jobs.next_step`.
- Tasks with no client beyond the plain "No client" choice: no categories, labels or projects.
- Turning deal and prospect chase dates into tasks. They belong to the pipeline, and a deal could be left
  with no date.
- Repeating tasks, priorities, comments, attachments, Outlook calendar entries.
- A ⌘K quick find that can add a task. Separate piece of work.
