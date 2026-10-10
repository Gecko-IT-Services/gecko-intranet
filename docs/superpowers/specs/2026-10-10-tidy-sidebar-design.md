# A tidier sidebar

Jack, 10 Oct 2026: "make the app's desktop sidebar much better and more SaaS like, neat and tidy. I don't
like the Gecko HQ, Gecko IT Services text (logo is fine)."

## What was wrong
- Seven blocks of CSS in `index.html` each restyled the sidebar the one before had left: gradients, a green
  edge, a drop shadow, a boxed tile behind every icon, and an active item with a gradient, a border, a glow
  and a filled green tile all at once.
- The brand said "Gecko" three times (logo, "GECKO HQ", "GECKO IT SERVICES"), in tracked capitals.
- Group captions were tracked capitals too, against the design system's sentence-case rule, and sat
  hard up against the item above them on a laptop-height screen.
- The footer was two boxes (a user card, then a bordered Sign out button) for one job.

## What it is now
- **One block** of sidebar CSS near the top of the file; the later layers are deleted (about 300 lines
  net). Both themes come from the tokens, so there is no light-theme copy of the rules.
- **Surface**: flat `--black`, one hairline on the right. No gradient, shadow or blur.
- **Brand**: the logo (28px), "Gecko IT Services" in mixed case at weight 700 and a small green "HQ" badge
  (the shared `.badge badge-green`), all on one line. No second line.
- **Width**: 260px, was 244. That line plus the collapse button does not fit in less.
- **Rows**: 34px, 8px radius, a bare 16px icon and the label. Hover is a 5% ink wash. The active row is an
  8% ink wash with ink text at weight 600 and a green icon: green stays the signal, without a green box.
- **Group captions**: sentence case, 11.5px, `--faint`, 18px of air above.
- **Footer**: one row. Avatar, name, email (as typed, not capitals) and a sign-out icon button with a
  title and `aria-label`. `#userName` and `#userRole` are kept: sections read them.
- **Rail** (collapsed): 60px, was 76. Captions become hairlines between the groups.
- **Phone drawer**: same look, 44px rows and a 44px sign-out target.

## Brand text: what was considered
1. "Gecko HQ", one line. The logo already carries "Gecko IT Services"; the app's name is Gecko HQ
   (Philip, 8 Oct). Built first, then replaced by 4.
2. "HQ" alone beside the logo. Shortest, but reads as a fragment when the logo is small.
3. "Gecko HQ" with the signed-in person or "Internal" beneath. A second line is what made it untidy.
4. **"Gecko IT Services" with a small "HQ" badge** (Jack's pick, built). Company first, product as the tag.

## Clients filter (same change)
Jack: "fix the clients sliding animation". The All / Active / New / Low on hours chips were redrawn on every
click, so the green jumped where every tab strip slides. The strip now goes through `geckoInkify()` like
the Mileage, Timesheets and Opportunities strips, and `cliRenderFilter()` keeps the ink across the redraw.
At phone width the chips now scroll inside the pill; they used to spill out of its right edge.

## Not done
- No user menu (theme, settings, sign out in a popover). One icon does the one thing the footer had.
- No search or command bar in the sidebar: nine destinations do not need one.
- The sign-in screen and the browser tab title still read "Gecko HQ — Gecko IT Services".

## Checked
1440×900, 900×760 (no sideways scroll on five sections, sidebar does not scroll) and the pane's own width, light and dark, expanded and rail; 375px drawer. All 28 test files pass
(`portal-accessibility-smoke.mjs` covers the nine semantic buttons and the closed-drawer `inert`).
