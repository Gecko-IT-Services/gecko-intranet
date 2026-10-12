# Change log — Design

Date: 2026-10-12 (Jack).

## Why
Jack, 12 Oct: "add a change log to the app so I can keep track of the changes dad has made and dad
can keep up with mine." Both work on Gecko HQ in separate Claude sessions, several merges a day (126
pull requests in the first week); neither sees what the other shipped unless they go to GitHub.

## Where the entries come from (Jack's choice)
The repository's **merged pull requests**, read from GitHub by the browser. The repository is public,
so there is no key, no sign-in and no server piece; every change either of them merges appears on its
own, and the history is there from the first day. The GitHub account says who: `Gecko-IT` is Jack,
`PhilipGecko99` is Philip (`AUTHORS` in `src/core/changelog.js`; any other account shows under its
own name).

- One request: GitHub's search (`repo:… is:pr is:merged`, newest 100). Kept in the browser for 15
  minutes (`gecko.changelog`), so a reload or a second tab does not ask again. GitHub allows 10
  unauthenticated searches a minute per connection; this asks at most 4 an hour per browser.
- The wording is the pull request's title. A row links to the pull request for the detail.

Rejected: **hand-written entries** in a file. Better wording, but complete only if every session, on
both sides, remembers its line, and the past would need writing up. **A database table**: something
would have to write to it on merge, which means a secret or a workflow.

## Design (Jack's choice: Settings, with a dot)
- **Settings › Change log**: a card between Appearance and Data. Newest first, grouped by day (Today,
  Yesterday, then "Fri 9 Oct"), each row the person's initial in their colour and the title. A filter:
  Everyone / Philip / Jack. The list scrolls inside the card. Foot: "Checked 18:20", **Check now**,
  and "Every change on GitHub" for anything older than the newest 100.
- **New**: the other person's changes since you last had Settings open carry a green "New" badge, for
  that visit. Your own never do.
- **The dot**: the sidebar's Settings link shows a green dot on its icon while there is anything new
  (its tooltip says how many and whose). Asked at sign-in and on coming back to the tab. Opening
  Settings clears it.
- "Last looked" is kept per browser (`gecko.changelog.seen`). The first time on a device, everything
  up to that moment counts as seen, so the whole history is not flagged.
- Quick find lists "Settings › Change log".

## Failure states
- GitHub cannot be reached, or is limiting requests, and nothing is kept: a red box "The change log
  didn't load." with the reason and Try again. Never an empty list.
- The same with an earlier copy kept: the list stays, and the foot says "Not refreshed: … Showing 18:20."
- The signed-in person is not recognised as Philip or Jack: no dot and no "New" (nothing to compare).
- Storage blocked: the list still works; no dot, and it is re-read on every visit.

## Left out on purpose
- The pull request's description, shown in the app (titles are written to stand alone).
- A dot on the phone's menu button: on a phone the dot shows once the menu is open.
- "Last looked" shared between a person's devices (would need the database).
- Emails or notifications; grouping several small changes into one line; changes pushed without a
  pull request (the convention is feature branch → PR → merge).
- More than the newest 100 in the app.

## Depends on
The repository staying public, and both people merging from their own GitHub account. If either
changes, this needs a key or a different source.

## Code
`src/core/changelog.js` (`toEntries`, `byDay`, `dayLabel`, `unseen`, `fetchEntries`), tests
`tests/changelog.mjs`. `src/sections/changelog.js` (`window.GeckoChangelog`: `render` from
`renderSettings`, `check` from `onSignedIn`). Styles: `system.css` "12 · Change log"; the dot is in
the sidebar block of `index.html`. Person colours now reach `#section-settings` (`team.css`).

## Testing
Full suite. Browser preview against the real repository: first visit (no dot), last looked two days
ago (dot, nine "New"), filter, a refused request with and without a kept copy; dark, 390px.
