import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.window = { escapeHtml: s => String(s) };

const { FIELD_COLUMNS, fieldsToRow, rowToProject, spItemToRow, reconcile, STATUSES } =
  await import('../src/sections/projects.js');
const { sha256Hex } = await import('../src/core/supabase.js');

// — Every table in every migration has RLS on and at least one policy. The site
//   is public and its key is public: a table without RLS is readable by anyone. —
const dir = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  .map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n').toLowerCase();
const tables = [...sql.matchAll(/create table (public\.\w+)/g)].map(m => m[1]);
assert.ok(tables.length > 0, 'migrations create tables');
for (const t of tables) {
  assert.ok(sql.includes(`alter table ${t} enable row level security`), `${t} has RLS on`);
  assert.ok(new RegExp(`create policy \\w+ on ${t.replace('.', '\\.')}`).test(sql), `${t} has a policy`);
}
// Status check constraint must match the board's columns exactly.
for (const s of STATUSES) assert.ok(sql.includes(`'${s.toLowerCase()}'`), `status ${s} allowed`);

// — Mapping: form fields → row → board shape round-trips every field. —
const fields = {
  Title: 'Server move', ClientName: 'Technix', Owner: 'Jack', Status: 'In progress',
  WaitingOn: 'Client', NextAction: 'Book date', AteraRef: '1234', Notes: 'a\nb'
};
const row = fieldsToRow(fields);
assert.deepEqual(Object.keys(row).sort(), Object.values(FIELD_COLUMNS).sort(), 'no field dropped');
const p = rowToProject({ id: 7, ...row, modified_at: '2026-10-01T00:00:00Z' });
assert.equal(p.id, '7', 'ids are strings, like SharePoint ids');
assert.deepEqual(
  [p.title, p.client, p.owner, p.status, p.waitingOn, p.nextAction, p.ateraRef, p.notes],
  Object.values(fields)
);
assert.equal(p.modified, '2026-10-01T00:00:00Z', 'staleness reads modified_at');
assert.deepEqual(fieldsToRow({ Status: 'Done' }), { status: 'Done' }, 'partial patch stays partial');

// — Import keeps SharePoint's dates and id, and tolerates missing columns. —
const sp = spItemToRow({
  id: '12',
  fields: { Title: 'Old', Status: 'Agreed', Created: '2026-07-01T09:00:00Z', Modified: '2026-08-01T09:00:00Z' }
});
assert.equal(sp.sharepoint_id, '12');
assert.equal(sp.modified_at, '2026-08-01T09:00:00Z', 'Modified carried over (21-day flag)');
assert.equal(sp.created_at, '2026-07-01T09:00:00Z');
assert.equal(sp.client_name, '', 'missing column becomes empty text');
assert.equal(spItemToRow({ id: '1', fields: { Status: 'Weird' } }).status, 'Quoted', 'unknown status');
assert.equal(spItemToRow({ id: '1', fields: {} }).title, '(untitled)', 'title is required in the table');

// — Reconcile: exact match passes; any difference or count gap fails. —
const db = [{ ...sp, id: 1 }];
assert.equal(reconcile([sp], db).ok, true);
const off = reconcile([sp], [{ ...sp, id: 1, notes: 'changed' }]);
assert.equal(off.ok, false);
assert.deepEqual(off.mismatches, [{ sharepointId: '12', problem: 'notes differs' }]);
const missing = reconcile([sp], []);
assert.equal(missing.ok, false);
assert.equal(missing.mismatches.length, 2, 'missing row and count gap both reported');
assert.equal(reconcile([], [{ ...sp, id: 1 }]).ok, false, 'extra row in Supabase fails');

// — Nonce hash: what Supabase compares against the ID token's nonce claim. —
assert.equal(
  await sha256Hex('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
);

console.log('supabase-migration: ok');
