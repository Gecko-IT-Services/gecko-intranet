# Whiteboards: move a sticky anywhere; an idea needs no fee — Design

Date: 2026-10-14 (Jack).

## Why
Jack, 14 Oct: "make it so we can move any post it any where (not just to the right) and also, for ideas,
a fee should not be mandatory as it's an idea."

Dragging already went either way on a desktop, but each sticky's only button is its next step (to the
right), and on a phone or tablet the buttons are the only way to move: drag and drop needs a mouse or
trackpad.

## Design
- **Move to…** on every sticky, beside the next-step button, on both whiteboards. A native picker
  (`<select>`), so it works with a finger, a keyboard and a screen reader without a menu of our own,
  and lists every other place, either way:
  - a job: Quoted, Agreed, In progress, To invoice, Invoiced, Lost (`moveTargets` in `core/jobs.js`);
  - an idea: Quoted, Agreed, In progress, To invoice, Lost (the same rules as dropping it: `ideaMove`);
  - a deal on Opportunities › Pipeline: Idea, Proposed, Won, Lost.
  It does what a drop on that column does, and the sticky glides there like an arrow move. The picker
  goes back to "Move to…" at once, so a move the board refuses leaves nothing half-chosen.
- **An idea's fee is optional.** The New idea form no longer requires One-off £; an idea without one
  reads "no fee yet". Which opportunities are the board's Ideas (`isJobIdea`): those with one-off work,
  as before, **plus** those with no price at all and no product (an idea typed on the board). A
  monthly-only deal, or a catalogue product not yet priced, stays on the Opportunities pipeline only,
  so the Jobs board does not fill with recurring deals. A job made from an idea with no fee has no
  value ("no value"), which Edit can add.

## A job back to Ideas (Jack, later the same day: "I want to drag a quoted job to ideas")
Drag a job onto Ideas, or Move to… › Ideas (`jobToIdea` in `core/jobs.js`, `backToIdeas` in the section):
- The idea is an opportunity: the one the job was made from (`source_ref` 'opp:<id>') when it is still
  there, otherwise a new one. It takes the job's title, value (as its one-off fee) and next step; then
  the job is deleted (opportunity first, so a failure never loses both).
- A won deal stays won (it may carry monthly billing that was set up); anything else is an idea again.
- The job's target date and its own notes have nowhere to go on an idea, so when it has either the
  person is asked first ("…its target date will not be kept"); the "From the opportunity…" note the
  board writes itself does not count.
- Not with a Xero invoice number, and not once invoiced or lost (those are off the board).
- If the result is a monthly deal with no one-off fee, it is no longer one of the board's Ideas; the
  toast says it is on the Opportunities pipeline instead.

## Left out
- **Placing a sticky within its column.** A column is sorted by target date; holding a hand-placed order
  needs a new column in `jobs`.

## Tests
`tests/jobs.mjs`: `moveTargets` (either way, Ideas included, an idea never straight to Invoiced), `jobToIdea` (new idea or
its own deal, won stays won, what is lost, refused with an invoice or once invoiced) and
the Ideas rule (an unpriced idea shows, last; a catalogue product not priced and a monthly-only deal do
not). Preview, 1440 and 375 wide: a job moved left two columns and back, to Lost; an idea to In progress;
a deal Won → Proposed and Proposed → Idea; a new idea with no fee shows on both boards; the picker does
not open the sticky. On a phone the picker's text is 16px (the app's rule for form fields, so iOS does
not zoom), a size up from the button beside it.
