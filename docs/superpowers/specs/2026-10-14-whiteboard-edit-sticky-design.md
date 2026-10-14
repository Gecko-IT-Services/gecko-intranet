# Whiteboards: click a sticky to edit it — Design

Date: 2026-10-14 (Jack: "I also need to be able to click on a sticky to edit it").

## Before
Clicking a job's sticky put its card under the board ("Picked from the board"), with Edit among its buttons:
two more steps and a scroll away from the board (out of sight when the board is maximised). An idea's
sticky did nothing. On Opportunities › Pipeline, a deal's card went under the board the same way, and its
Edit switched the page to List view.

## Design
- **Click a sticky: it opens in a pop-up over the board, already open to edit.** Both whiteboards:
  - a job: its card (stage buttons, Invoice in Xero, notes) with the edit form open: client, job, value,
    stage, target date, Xero invoice, next step, notes, Delete;
  - an idea on the Jobs board: client, idea, one-off fee (optional), next step;
  - a deal on the Pipeline: its card with the edit form open (£/month, one-off, quantity, stage, next
    step, follow-up, Delete), plus its won next steps.
- **Save** closes the pop-up and the board shows the change. **Cancel**, the cross, Esc or a click outside
  close it without saving.
- An idea saved with no fee that is a monthly product (it has a product or a £/month) leaves the Jobs
  board's Ideas (`isJobIdea`); the message says it is on the Opportunities pipeline only.
- Quick find opening a job or deal, and a deal opened from the Gaps map, open the same pop-up.
- **Moves never open it.** Before, dropping an idea on a column, or a deal on Won, opened that card under
  the board. As a pop-up that would interrupt every drag, so a move only shows its message; click the
  sticky to fill in what is missing.

## How
A native `<dialog>` (class `tk-dialog board-dialog`, so it has the task dialog's box and motion) added once
to each section by `init`, outside the board that is redrawn, so the section's existing click, submit and
change handlers reach its buttons and forms. `drawDialog()` fills it from `JOB.selected` / `JOB.selectedIdea`
/ `OPP.selected` on each draw and opens it when needed. Every way out goes through `closeDialog()` /
`closeDeal()`, which clears the picked sticky; Esc is caught from the dialog's `close` event. The card and
forms are the existing `jobCard`, `ideaForm` (now also for an existing idea, saved by `saveIdea`) and the
pipeline's `deal` card; nothing about saving changed.

## Left out
- Editing the title straight on the sticky (typing on the board). The pop-up has every field; a second
  way to edit two of them is not needed yet.

## Tests
No new pure logic. Preview (mock data), 1440 wide: a job opened, title and value changed and saved (pop-up
closes, sticky shows both); closing by the cross, Cancel, the backdrop and Esc each clear the picked sticky;
Move to… on a sticky does not open it; an idea opened (fee filled in), saved without a fee (it leaves the
board, message shown); a deal opened, next step saved. All test files pass.
