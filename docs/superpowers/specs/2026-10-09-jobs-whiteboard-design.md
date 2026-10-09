# Jobs › Whiteboard

Jack, 9 Oct 2026: "an engaging way to show and create opportunities, projects, and keep track of things we
normally keep on a whiteboard. The current setup is quite good so just improve it."

## What changed
- The Jobs tab opens on a **whiteboard** (List is one click away; the choice is remembered in this browser).
  Columns: **Ideas**, Quoted, Agreed, In progress, To invoice, each with its £ total and count. Invoiced and
  Lost are drop zones under the board (with "See them", which opens the list at that stage).
- **Stickies**: client, job, next step, value, target date (red when late), the Xero state when there is one,
  a strip of tape and an initial in the owner's colour (Philip blue, Jack purple). Each leans slightly (the
  same way every time) and straightens under the pointer.
- **Move**: drag a sticky to another column, or tap its arrow (the next stage, as on the list cards). Phones
  use the arrows; the columns become a rail you swipe through.
- **Pick**: clicking a sticky (or Enter) shows its full card under the board: Edit, Invoice in Xero, notes.
- **Ideas** are opportunities with one-off work (idea, proposed, or won without a job) that no job came from.
  **+ Idea** adds one (client, idea, rough one-off £, next step) to the Opportunities pipeline. An idea
  dropped on **Quoted** becomes a quoted job and the deal becomes Proposed; on **Agreed** or later, a job at
  that stage and the deal is Won; on **Lost**, the deal is Lost. The job carries `source_ref = opp:<id>` and the
  deal its `job_id`, the same link Opportunities' "Create job" makes, so neither side duplicates.
- **+ Add** under a column opens the usual job form with that stage chosen.

## Not changed
List view, stage filters, the Invoiced grouping, Invoice in Xero, the other tabs, every saved field.
Monthly-only deals (no one-off) stay on Opportunities: they are billing, not jobs.

## Logic
`boardLanes`, `ideaMove`, `tilt` in src/core/jobs.js (tests in tests/jobs.mjs). If opportunities can't be
read the Ideas column says so; the jobs still show.
