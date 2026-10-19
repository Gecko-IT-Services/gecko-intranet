import assert from 'node:assert/strict';
import { readAll } from '../src/core/rows.js';

// A fake query that, like the database, hands out at most `cap` rows per request.
const table = Array.from({ length: 2345 }, (_, i) => ({ id: i }));
const asked = [];
const make = () => ({ range: async (from, to) => { asked.push([from, to]); return { data: table.slice(from, Math.min(to + 1, from + 1000)), error: null }; } });
const rows = await readAll(make);
assert.equal(rows.length, 2345, 'every row, not the first 1,000');
assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999]]);
asked.length = 0;
await assert.rejects(readAll(() => ({ range: async () => ({ data: table.slice(0, 1000), error: null }) })), /more than 200,000/, 'a query that never ends stops');
await assert.rejects(readAll(() => ({ range: async () => ({ data: null, error: { message: 'boom' } }) })), /boom/);

// No page reads one of the big tables in one go any more.
const { readFileSync, readdirSync } = await import('node:fs');
const dir = new URL('../src/sections/', import.meta.url);
for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  for (const m of src.matchAll(/(.{0,20})sb\.from\('(acronis_items|atera_seen_days)'\)/g))
    assert.ok(/readAll\(\(\) => $/.test(m[1]), `${f} reads ${m[2]} through readAll`);
}
console.log('rows: ok');
