# Timesheets: files on an entry — Design

Date: 2026-10-12 (Jack).

## Why
Jack, 12 Oct: "Allow for attaching files in timesheets entries." A photo from a site visit, a
screenshot from a remote session or a PDF belongs with the entry that records the work.

## Where things live (Jack's choice)
- **The file** goes into the **Gecko Docs** library on the portal site, with the client's other
  documents: `clients/<Client Folder>/Timesheet files/<date> #<entry id> <file name>`. A client with
  no Client Folder on the SSA list gets `Timesheet files/<client name>/…` at the top of the library,
  so attaching never fails for that reason. The date and entry id in the name keep the folder in date
  order and tie a file back to its entry when browsing SharePoint.
- **The record** is one row in `public.timesheet_files` (entry, name as picked, size, drive id, item
  id, link, who attached it), staff only like every table. The files never go into Supabase.
- No new permission: `Sites.ReadWrite.All` already covers the library (the SSA renewal's archive copy
  writes there the same way; both now use `tshDocsDrive()`).

Rejected: **Supabase Storage**. One system per entry and easier for a future client portal, but the
free plan holds 1 GB in all (about 300 phone photos) and Philip wants no running cost; the migration
note already leaves documents off it. **List item attachments** on the Timesheets list: Graph cannot
write them, and the list is the backup, not the master.

## Design
- **Log time form**: an **Attach files** button under Description (the browser's own picker, so an
  iPhone offers camera, photos or files). Picked files are listed with their size and a remove button.
  On **Log time** the entry is saved first, then the files go up one at a time ("Uploading 1 of 2…").
  The toast adds "· 2 files attached". A file that does not go up never undoes the entry: a second
  toast names it, with the reason, and says to add it from the entry's Edit.
- **Recent entries**: a paperclip with the count beside the description; it opens Edit.
- **Edit dialog**: a **Files** list. A name opens the file in SharePoint in a new tab (its preview);
  the bin removes it after a confirm (the file goes to SharePoint's recycle bin, the row is deleted);
  **Attach files** adds more straight away, without Save changes.
- Limits: 25 MB a file, 10 files an entry, empty files refused (`checkFiles`). One plain upload per
  file. A name clash in the folder is renamed by SharePoint (`conflictBehavior=rename`); the row keeps
  the name as picked.
- Names: SharePoint's forbidden characters (`" * : < > ? / \ |`) become `-`; long names are cut from
  the front so the extension survives (`safeName`).

## Failure states
- `timesheet_files` cannot be read (or is not there yet): Timesheets loads as normal, the form's
  button is disabled with "Files are unavailable: …" and the Edit dialog says "Files could not be
  read"; neither looks like "no files".
- Upload fails: the file is named in the toast with Graph's reason; other files carry on.
- Uploaded but the row could not be saved: the file is deleted again, so nothing sits in SharePoint
  unlisted, and it is reported as not attached.
- Removing a file SharePoint no longer has (404) still removes the row.
- No "Gecko Docs" library: every file reports that, in those words.

## Left out on purpose
- Pasting a screenshot or dragging a file onto the form; thumbnails.
- Files on the client page, in Weekly summary, in the renewal's timesheet email, or anything a client
  sees. They are internal.
- Copying files to the Lists backup items: the file is already in SharePoint, and `timesheet_files`
  is in Settings › Backup.
- Picked files in the browser draft: only the text is kept across a reload.
- Entries on the old Lists backend (`CONFIG.DATA_BACKEND.timesheets` not `supabase`): no attach row.
- Deleting an entry leaves its files where they are (the entry itself is only marked deleted).
- Moving files when a client's folder or an entry's date changes: the row holds the item id, so the
  link still works; later files simply carry the new date.
- Uploads over 25 MB (would need an upload session).

## Code
`src/core/timesheet-files.js` (`window.GeckoTimesheetFiles`: `safeName`, `pathFor`, `checkFiles`,
`fmtSize`, `fileRow`, `safeUrl`, and the three database calls), tests `tests/timesheet-files.mjs`.
Migration `20261012210000_timesheet_files.sql`. The form, table and dialog are the `tsh*` code in
`index.html` ("Files on an entry"); styles in `src/styles/app.css`; `paperclip` added to the icon set.

## Testing
Full suite. Browser preview with a Graph mock that takes uploads: log with two files, attach and
remove from Edit, a failing upload from both places, the table unreadable; light, dark, 390px.
