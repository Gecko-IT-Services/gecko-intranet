# Whiteboards on a phone or tablet: drag by touch, and the pop-up fits — Design

Date: 2026-10-14 (Jack: "add the same move and edit features on mobile").

## Before
- Moving: the browser's drag and drop needs a mouse or trackpad, so on a phone a sticky could only change
  column by its button or Move to…, and never be put in a spot (reordering).
- Editing: a tap already opened the pop-up, but its form kept the desktop's four columns, about 50px each
  on a phone, too narrow to read what was typed.

## Design
- **Press and hold a sticky (about a third of a second) to lift it**, then drag it to a column and a spot
  and let go: the same as a mouse drag (the green line shows where it lands; the same drop rules, saved
  the same way). A quick swipe still scrolls the board, a tap still opens the sticky, and the tap that ends
  a drag does not. On a phone the columns are a sideways rail: holding the sticky near its left or right
  edge scrolls the rail, near the top or bottom of the screen the page. A light buzz on lifting where the
  phone supports it (Android).
- Both whiteboards: `touchDrag(section, drop)` in `src/core/board.js`, used by Jobs and Opportunities with the
  drop each already had for the mouse (`dropOn`, `moveDeal`). Pointer events, so a mouse is untouched.
- **The pop-up fits**: its body is a size container with the same names as the board's (`jobwrap`, `oppwrap`),
  so the card and form use the narrow layouts they already have: two columns on a phone.

## Details
- While lifted, the finger's movement is kept from scrolling the page (`touchmove` cancelled), a long press
  is not a menu (`contextmenu`), and the sticky's own `draggable` is off so iOS does not start its drag on top.
  Stickies are not selectable text and their logos can't be dragged out.
- The copy that follows the finger is a clone without the sticky's inline style, so it carries no view
  transition name of the original.
- Released without moving (held, then let go): nothing happens and the pop-up does not open.

## Not tested on a real phone
Checked in the preview at phone size with simulated touches (pointer events of type touch): a tap opens the
pop-up, a swipe does not lift, hold-and-drag reorders Ideas, an idea dragged across the rail onto Quoted
becomes a job, a deal dragged from Proposed to Idea, scroll blocked while lifted, the pop-up forms in two
columns. How the hold and the scrolling feel, and that iOS and Android let go of their own gestures as
intended, needs a try on a real phone.

## Left out
- Touch reordering without the hold (dragging straight away would fight the board's own scrolling).
