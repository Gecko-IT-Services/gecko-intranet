import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A `catch (err) { … e … }` throws a ReferenceError inside the handler, which
// turns a warning ("could not sync, refresh to retry") into a failed load.
// Five of these lived in index.html until 7 Oct 2026. Catches the one-line form,
// which is how this codebase writes its warn-and-continue handlers.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bad = [];
html.split('\n').forEach((line, i) => {
  const m = line.match(/catch \((\w+)\) \{(.*)$/);
  if (!m) return;
  const [, name, body] = m;
  if (name !== 'e' && /[(,\s]e\)/.test(body) && !/\be\s*=>/.test(body)) bad.push(`index.html:${i + 1}`);
});
assert.deepEqual(bad, [], 'catch blocks must log the variable they caught');

console.log('catch-variables: ok');
