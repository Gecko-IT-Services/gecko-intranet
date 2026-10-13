# Jobs: maximise the whiteboard — Design

Date: 2026-10-13 (Jack).

## Why
Jack, 13 Oct: "I would like the ability to maximise the whiteboard view for maximum screen estate."
On a laptop the board starts a third of the way down the page (heading, tabs, figures) beside a
260px sidebar, under the browser's tabs and bookmarks bar. With nine jobs the lower stickies are
already off the screen.

## Design (Jack's choice: full screen too)
- **Maximise** in the Jobs header, after Refresh, on the Jobs tab only.
- It hides the sidebar, the top bar (phone), the "Jobs" heading, the tab strip and the three figures,
  lifts the page's 1400px width cap, and asks the browser for full screen, so the browser's own tabs,
  address bar and bookmarks go too. The header shrinks to its one row of buttons (Add a job, Refresh,
  Synced, Exit full screen). The board fills the rest of the window with the three drop zones (In Xero,
  Invoiced, Lost) still in view; columns stretch to the board's height, so there is more to drop on.
- Everything on the board works as before: drag, arrows, + Add, the picked card underneath, toasts,
  the task and quick-find dialogs.
- **Back**: Exit full screen (the same button), or Esc. In browser full screen Esc belongs to the
  browser, so the page follows `fullscreenchange` out; without it (below) the page's own Esc does it,
  except from inside a form field.
- Leaving the Jobs tab (quick find to Owed to us, say) leaves the maximised view. Going to another
  page shows that page normally.

## How
- `maximiser(sectionId, buttonId)` in `src/core/maximise.js` wires the header button and puts `.is-max`
  on the section; it returns a function the section's render calls with whether the whiteboard is on
  show. The styles are one block at the end of the whiteboard rules in `src/styles/jobs.css`. The
  shell is reached with `:root:has(….active.is-max)`, so nothing outside the two pages knows about it.
- Full screen is asked of the whole page (`document.documentElement`), not the board: toasts and the
  older pop-ups live outside the section and would not be drawn otherwise.
- Icons `maximize` / `minimize` added to `src/core/icons.js`.

## Failure states
- No full screen (iPhone has none) or the browser refuses: the app's own parts still step aside; no
  message, the button still reads Exit full screen and still works.
- Loading and error boxes show as usual inside the maximised page.

## Left out on purpose
- **Remembering it.** Jobs always opens as usual: a page that opens with no menu looks broken.
- **Columns that scroll on their own.** The page scrolls as it always has; one scrollbar.
- **A phone layout of its own.** It works (about 250px more board), but the buttons take two rows.

## Opportunities › Pipeline (Jack, later the same day: "add the same button")
The same button in the Opportunities header, shown on Pipeline in Board view only. Switching to List,
or to another tab, leaves the maximised view. The List / Board switch and the follow-up badges stay
above the board. That made two users, so the code moved from `jobs.js` into `core/maximise.js`.

## Motion (Jack, later the same day: "are the animations up to scratch?")
They were not: the change was a hard cut, where every other change of view in the app moves. Now,
going in and coming back, the page arrives in its new shape the way any page arrives: the section's
own entry animation (`fadeIn`, `--dur-3`) is played again. No new keyframes or timings, and the
global reduced-motion guard already covers it.

Rejected: **a class with its own animation on the section**. Tried first; taking the class off hands
the `animation` property back to `fadeIn`, which then plays as well, so the page faded twice.
**Sliding the sidebar away / growing the board**: the browser is resizing the window for full screen
at the same moment, and two size changes at once judder. The sidebar still returns without a fade.

## Tests
No pure logic to test. Checked in the preview at 1024, 1440 and 1920 wide and at 375 (phone): Esc,
leaving the tab, leaving the page; Opportunities at 1440 and 375, plus Board to List. `tests/icons.mjs` covers the two icon names.
The browser's own full screen does not engage inside the preview pane, so that half is to be
checked on the live site after the merge (one click).
