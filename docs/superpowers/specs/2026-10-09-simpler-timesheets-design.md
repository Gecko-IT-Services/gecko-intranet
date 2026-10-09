# Timesheets: simpler Log time — Design

Date: 2026-10-09 (Jack). Same pass as the Profitability and Settings pages the same day; builds on
2026-10-09-timesheets-entry-design.md (the checks and draft it describes are kept).

## Why
Jack, 9 Oct: "we've only started using it — we just want to make it as easy and fuss free as possible
to log a job." What they use: logging time quickly and looking back at what was done. Detailed notes
should go: "that can be inputted into the normal notes area".

## Design (Log time tab)
- One form: Client (with the SSA balance hint) · Engineer · Date · Time with its shortcuts (15m … 2h) ·
  Work type · Description, then the summary line, the checks and Log time. Then Recent entries, as now.
- Engineer starts as whoever is signed in; the list is Philip and Jack ("System" entries are only made
  by Adjust… and renewals). Date starts as today. Picking a client still pre-picks its last work type.
- Description is a two-line box (longer text is visible as you type), still at most 250 characters:
  every entry is copied to the SharePoint Timesheets list, whose description column is single-line.
  For the same reason Enter logs the entry and pasted line breaks become spaces; Ctrl/⌘ + Enter also logs.
- The restored-draft note ("Unsaved entry restored. Discard") stays; the draft itself is unchanged.

## Removed
- The week time card above the form, and the Leave read that only fed it (Weekly summary lists days
  with nothing logged).
- Recent-client chips and the "logged today" line; the date shortcuts; "Add detailed notes" (new
  entries carry no internal notes; existing ones keep theirs and the edit dialog still shows them);
  the past-descriptions suggestions (a two-line box can't carry them); the Ctrl/⌘ + Enter hint.
- "Copy to Supabase" in the header and `tshCopyToSupabase`: the one-off copy was done on 8 Oct and
  the flag is on the database (the same button went from Clients in #86).
- `recentClients` from `src/core/timelog.js` (only the chips used it).

## Unchanged
SSA dashboard and Weekly summary tabs; saving, the Lists backup and sync; the checks (`checkEntry`:
errors stop, warnings need Log anyway); one save at a time; Log time from a client page or an SSA card
(`tshPreselect`); the SSA rules (no HoursUsed writes).

## Testing
Full suite (`tests/timelog.mjs` covers the checks). Browser preview: light, dark, 390px.
