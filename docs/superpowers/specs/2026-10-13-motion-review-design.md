# Motion review: six fixes — Design

Date: 2026-10-13 (Jack). Follows `2026-10-10-icons-and-motion-design.md` (the standard) and the
maximise work of the same day.

## Why
Jack, 13 Oct: "review the animations across the whole app", then "fix 1 to 3 and do 4 to 6 too".

## What was measured
Every page, tab, pop-up and toast in the preview harness: which animations start on each change of
view, and for how long (`getAnimations()`), plus a scan of every stylesheet. The stylesheets were
already sound: one curve, three speeds, no hard-coded transition time, no `transition: all`, no
unused keyframes, reduced motion covered. The six findings were all about a redraw either losing a
movement or repeating one.

## The fixes
1. **Opportunities had no change-of-view motion.** Its five tabs now slide in from the side the tab
   is on, like every other strip (`direction()` from `core/tabs.js`, an `.app-pane` wrapper round the
   tab's content, one-shot `OPP.enter`). Board / List and Map / Clients rise (`.app-pane.rise`).
   Filters still redraw at once, as the standard says.
2. **Coming back to a page replayed the last tab's slide** under the page's own arrival (an
   animation starts again when its element is shown again, and the `from-left` / `from-right` /
   `job-enter` class was still on the pane). `navTo` now clears those classes from a page as it
   returns to it. Measured before on Analytics, Overview, Jobs and Mileage.
3. **A picked card blinked on every redraw** of either whiteboard (Add a job, Cancel, a sticky's
   arrow). `redraw(mount, html)` in the new `src/core/motion.js` notes what was pinned open
   (`data-pin`) before it replaces the markup and marks the same thing `.still` afterwards. It reads
   the page, so there is no second record of "what is open" to keep in step.
4. **Hub tabs (Clients, Monitoring, Team) moved differently from page tabs.** Along a hub the page
   now slides in from its tab's side (`navTo` puts `from-left` / `from-right` on the section), and
   `renderHub` keeps the strip while its tabs are the same, so the green marker slides from the tab
   just left instead of being rebuilt at the left edge. Desktop widths only (from 881px): on a phone
   the page fills the screen, and 12px sideways widened the document for the length of the slide
   (measured: 387px in a 375px window), so there it rises as before.
5. **Stickies jumped between columns.** Moved by its arrow, a sticky now glides to its column and
   the others close up: the browser's view transitions (`glide(draw)` in `core/motion.js`; each
   sticky carries a `view-transition-name`; speed and curve are the app's own via
   `view-transition-class`). Where the browser has none, or the person has asked for less motion, it
   is the plain redraw. **Not when dragged**: the sticky is already where it was put, and flying in
   from its old column would be a second movement. An idea turning into a job is a different sticky
   and fades.
6. **Older pop-ups closed at once; Profitability's rows opened at once.** The six `.show` pop-ups
   (Clients, Timesheets, Mileage ×2, Leave, Profitability) fade out in `--dur-1` as they close, the
   same way as the two native dialogs (`display … allow-discrete`; at once where the browser cannot).
   A Profitability row's lines rise as it opens (`prfToggleCard`).

## Left out on purpose
- **The Alerts pop-up.** It is shown with `hidden`, not `.show`, and the preview has no alert to open
  it with, so it keeps its entrance and closes at once. Not changed blind.
- **A closing animation for rows and lists.** Collapsing needs a height to animate; opening is the
  part that says "this is new".
- **One set of keyframes.** About 29 where 10 are distinct (eight "grow", five "rise"), and Jobs
  slides 18px where the rest slide 12px. Not visible; left for a tidy-up of its own.
- **The sidebar's collapse and filter redraws** stay instant: both are deliberate and written down.

## Failure states
- No view transitions, or the browser skips one (tab in the background, window resized mid-way):
  the redraw has still happened; nothing is reported.
- No `allow-discrete`: the pop-ups close at once, as they did.

## Tests
No pure logic. Measured in the preview at 1440 and 375 wide after the change: Opportunities tabs and
views, return visits to five pages, the picked card across three redraws on Jobs and one on
Opportunities, both hubs' tabs and marker, an arrow move on each whiteboard (the view transition
starts and the sticky lands in the right column), the Clients pop-up (the other five share its rule) opening, closing and opening
again, a Profitability row. All test files pass.

The preview pane was not on screen, so nothing was watched: the measurements say what moves and for
how long, not how it feels. The glide in particular is to be looked at on the live site.
