/* Files attached to timesheet entries (Jack, 12 Oct 2026). Tested in tests/timesheet-files.mjs.
   Design: docs/superpowers/specs/2026-10-12-timesheet-files-design.md

   The file itself goes into the Gecko Docs library in SharePoint (the upload is in index.html, beside
   the renewal's archive copy); the database keeps one row per file saying which entry it belongs to
   and where it is. Nothing here touches hours or balances. */

import { connectSupabase } from './supabase.js';

export const MAX_FILE_MB = 25;   // ponytail: one plain PUT per file; an upload session if bigger files are ever needed
export const MAX_FILES = 10;     // per entry

/** A file name SharePoint will take: its forbidden characters become "-", the extension is kept. */
export function safeName(name) {
  const s = String(name ?? '').replace(/["*:<>?/\\|]/g, '-').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  return s.slice(-120).trim() || 'file';
}

/** Path segments in Gecko Docs: with the client's other documents when it has a folder there. */
export function pathFor(client, entry, fileName) {
  const leaf = safeName([entry?.date, `#${entry?.id}`, safeName(fileName)].filter(Boolean).join(' '));
  return client?.clientFolder
    ? ['clients', client.clientFolder, 'Timesheet files', leaf]
    : ['Timesheet files', safeName(client?.name), leaf];
}

/** Which of the picked files can go up, and a sentence for each that cannot. */
export function checkFiles(files, already = 0) {
  const ok = [], errors = [];
  let full = false;
  for (const f of files) {
    if (!(f.size > 0)) errors.push(`${f.name} is empty.`);
    else if (f.size > MAX_FILE_MB * 1024 * 1024) errors.push(`${f.name} is ${fmtSize(f.size)}; the limit is ${MAX_FILE_MB} MB a file.`);
    else if (already + ok.length >= MAX_FILES) full = true;
    else ok.push(f);
  }
  if (full) errors.push(`An entry holds up to ${MAX_FILES} files; the rest were left out.`);
  return { ok, errors };
}

export function fmtSize(bytes) {
  const kb = (Number(bytes) || 0) / 1024;
  return kb < 1000 ? `${Math.ceil(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** The row to keep for a file SharePoint has just taken (`item` is Graph's driveItem). */
export function fileRow(entryId, item, file, uploadedBy) {
  if (!item?.id || !item.parentReference?.driveId) throw new Error('SharePoint did not say where it put the file');
  return { entry_id: Number(entryId), name: file.name, size: Number(item.size ?? file.size) || 0,
    drive_id: item.parentReference.driveId, item_id: item.id, web_url: item.webUrl || '', uploaded_by: uploadedBy || '' };
}

/** A stored link is only ever opened if it is a web address. */
export const safeUrl = url => /^https:\/\//i.test(String(url ?? '')) ? String(url) : '';

function must({ data, error }) {
  if (error) throw new Error(error.message || 'Database request failed');
  return data;
}
/** ponytail: one read of up to 5,000 rows; page it like timesheets.js `all` if attachments ever get near that. */
export async function loadFiles() {
  const sb = await connectSupabase();
  return must(await sb.from('timesheet_files').select('*').order('id').range(0, 4999)) || [];
}
export async function insertFile(row) {
  const sb = await connectSupabase({ interactive: true });
  return must(await sb.from('timesheet_files').insert(row).select('*').single());
}
export async function deleteFile(id) {
  const sb = await connectSupabase({ interactive: true });
  must(await sb.from('timesheet_files').delete().eq('id', id));
}
