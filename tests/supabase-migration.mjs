import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { sha256Hex } = await import('../src/core/supabase.js');
const { TABLES } = await import('../src/core/store.js');

// — Every table the migrations leave in place has RLS on and a policy. The site
//   is public and its key is public: a table without RLS is readable by anyone. —
const dir = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  .map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n').toLowerCase();
const created = [...sql.matchAll(/create table (public\.\w+)/g)].map(m => m[1]);
const dropped = new Set([...sql.matchAll(/drop table (public\.\w+)/g)].map(m => m[1]));
const live = created.filter(t => !dropped.has(t));
assert.ok(live.includes('public.staff'), 'staff table exists');
for (const t of live) {
  assert.ok(sql.includes(`alter table ${t} enable row level security`), `${t} has RLS on`);
  assert.ok(new RegExp(`create policy \\w+ on ${t.replace('.', '\\.')}`).test(sql), `${t} has a policy`);
}

// — Every store mapping points at a live table and at columns that exist. —
for (const [table, { columns }] of Object.entries(TABLES)) {
  assert.ok(live.includes(`public.${table}`), `${table} is created by a migration`);
  const body = sql.split(`create table public.${table} (`)[1].split(');')[0];
  for (const [column] of Object.values(columns)) {
    assert.ok(new RegExp(`\\n\\s*${column}\\s`).test(body), `${table}.${column} exists`);
  }
  for (const column of ['sharepoint_id', 'created_at', 'modified_at']) {
    assert.ok(body.includes(column), `${table}.${column} exists`);
  }
}

// — Nonce hash: what Supabase compares against the ID token's nonce claim. —
assert.equal(
  await sha256Hex('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
);

console.log('supabase-migration: ok');
