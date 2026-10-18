# Commands page (18 Oct 2026)

**Why (Jack):** one place in Gecko HQ where Jack and Philip can copy the Windows commands they use day to day
(ipconfig, sfc, DISM, making an Entra ID user a local admin…), shown the way GitHub shows a README.

## What it is
- Sidebar › Operations › **Commands** (`src/sections/commands.js`, `src/styles/commands.css`). Also in Quick find.
- The content is one Markdown file, `docs/commands.md`, fetched by the page and drawn by `src/core/markdown.js`
  (tests `tests/markdown.mjs`). "Edit on GitHub" in the header opens that file in GitHub's editor; a merge to `main`
  updates the page (GitHub Pages cache, a few minutes).
- Every code box has a copy button (check mark for 1.5 s once copied).
- **Blanks:** `{name}` inside a code box becomes a box to type into, e.g.
  `net localgroup administrators /add "AzureAD\{email}"`, because the email changes every time. Copy takes what was
  typed; an empty blank stops the copy, is focused and a toast says "Fill in the blank first". The same blank is filled
  everywhere on the page. Enter in a blank copies. Braces with spaces or `$` (PowerShell script blocks) are left alone.
- Code boxes wrap rather than scroll, so a blank never goes out of sight on a phone.

## Rejected
- A Markdown library (marked etc.): another CDN dependency for six rules; ours escapes everything first.
- Editing in the app / a Supabase table: needs a form, RLS and a migration for a list that changes a few times a year.
  GitHub's editor already does it, with history.
- Search box on the page: Ctrl+F does it.

## Not built
- Tables, images, numbered or nested lists in the Markdown (add to `markdown.js` when the page needs one).
- Remembering what was typed in a blank between visits.
