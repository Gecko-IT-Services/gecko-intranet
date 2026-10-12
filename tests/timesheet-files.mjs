import assert from 'node:assert/strict';
import { MAX_FILE_MB, MAX_FILES, safeName, pathFor, checkFiles, fmtSize, fileRow, safeUrl } from '../src/core/timesheet-files.js';

// A name SharePoint will take, extension kept
assert.equal(safeName('router: before/after?.jpg'), 'router- before-after-.jpg');
assert.equal(safeName('  .hidden. '), 'hidden');
assert.equal(safeName('a\tb\n c.pdf'), 'a b c.pdf');
assert.equal(safeName(''), 'file');
assert.equal(safeName('***'), '---');
const long = safeName('x'.repeat(300) + '.xlsx');
assert.ok(long.length <= 120 && long.endsWith('.xlsx'), 'a long name is cut from the front, so the extension survives');

// Where a file goes in Gecko Docs: the client's folder when it has one, a shared folder when it does not
const entry = { id: 1187, date: '2026-10-12' };
assert.deepEqual(pathFor({ clientFolder: 'Technix', name: 'Technix Ltd' }, entry, 'photo.jpg'),
  ['clients', 'Technix', 'Timesheet files', '2026-10-12 #1187 photo.jpg']);
assert.deepEqual(pathFor({ clientFolder: '', name: 'A/B Motors' }, entry, 'quote?.pdf'),
  ['Timesheet files', 'A-B Motors', '2026-10-12 #1187 quote-.pdf']);
assert.deepEqual(pathFor(null, { id: 5, date: '' }, 'x.txt'), ['Timesheet files', 'file', '#5 x.txt']);

// What may be attached
const f = (name, mb) => ({ name, size: Math.round(mb * 1024 * 1024) });
let res = checkFiles([f('a.jpg', 1), f('big.mov', MAX_FILE_MB + 1), f('empty.txt', 0)]);
assert.deepEqual(res.ok.map(x => x.name), ['a.jpg']);
assert.equal(res.errors.length, 2);
assert.match(res.errors[0], /big\.mov.*25 MB/);
assert.match(res.errors[1], /empty\.txt is empty/);
assert.equal(checkFiles([f('edge.bin', MAX_FILE_MB)]).ok.length, 1, 'exactly the limit is allowed');
res = checkFiles(Array.from({ length: 4 }, (_, i) => f(`n${i}.png`, 1)), MAX_FILES - 2);
assert.equal(res.ok.length, 2, 'only as many as there is room for');
assert.match(res.errors[0], /10 files/);
assert.deepEqual(checkFiles([], 0), { ok: [], errors: [] });

assert.equal(fmtSize(0), '0 KB');
assert.equal(fmtSize(900), '1 KB');
assert.equal(fmtSize(340 * 1024), '340 KB');
assert.equal(fmtSize(2.14 * 1024 * 1024), '2.1 MB');

// The record kept for an uploaded file: what SharePoint called it (it renames on a clash), not what was picked
assert.deepEqual(
  fileRow(1187, { id: 'ITEM', name: '2026-10-12 #1187 photo 1.jpg', size: 2048, webUrl: 'https://x.sharepoint.com/f', parentReference: { driveId: 'DRIVE' } }, { name: 'photo.jpg', size: 2048 }, 'Jack Morris'),
  { entry_id: 1187, name: 'photo.jpg', size: 2048, drive_id: 'DRIVE', item_id: 'ITEM', web_url: 'https://x.sharepoint.com/f', uploaded_by: 'Jack Morris' });
assert.throws(() => fileRow(1, { name: 'x' }, { name: 'x', size: 1 }, ''), /SharePoint did not say where/);

// Only a web address is ever put in a link
assert.equal(safeUrl('https://x.sharepoint.com/a b'), 'https://x.sharepoint.com/a b');
assert.equal(safeUrl('javascript:alert(1)'), '');
assert.equal(safeUrl(null), '');

console.log('timesheet-files: ok');
