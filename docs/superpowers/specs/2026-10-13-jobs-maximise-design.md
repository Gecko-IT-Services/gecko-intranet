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
- `setMax` / `renderMax` in `src/sections/jobs.js` put `.is-max` on `#section-jobs`; the styles are one
  block at the end of the whiteboard rules in `src/styles/jobs.css`. The shell is reached with
  `:root:has(#section-jobs.active.is-max)`, so nothing outside Jobs knows about it.
- Full screen is asked of the whole page (`document.documentElement`), not the board: toasts and the
  older pop-ups live outside the section and would not be drawn otherwise.
- Icons `maximize` / `minimize` added to `src/core/icons.js`.

## Failure states
- No full screen (iPhone has none) or the browser refuses: the app's own parts still step aside; no
  message, the button still reads Exit full screen and still works.
- Loading and error boxes show as usual inside the maximised page.

## Left out on purpose
- **Remembering it.** Jobs always opens as usual: a page that opens with no menu looks broken.
- **Opportunities › Pipeline.** Same stickies, so the same few rules would do it. Not asked for.
- **Columns that scroll on their own.** The page scrolls as it always has; one scrollbar.
- **A phone layout of its own.** It works (about 250px more board), but the buttons take two rows.

## Tests
No pure logic to test. Checked in the preview at 1024, 1440 and 1920 wide and at 375 (phone): Esc,
leaving the tab, leaving the page. `tests/icons.mjs` covers the two icon names.
The browser's own full screen does not engage inside the preview pane, so that half is to be
checked on the live site after the merge (one click).
