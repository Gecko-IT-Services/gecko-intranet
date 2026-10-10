import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ICONS, icon } from '../src/core/icons.js';

// Every icon asked for by name exists: a typo would draw nothing, silently.
const files = ['index.html', ...readdirSync('src/sections').map(f => 'src/sections/' + f)];
const source = Object.fromEntries(files.map(f => [f, readFileSync(f, 'utf8')]));
for (const [file, text] of Object.entries(source)) {
  for (const [, name] of text.matchAll(/\b(?:gkIcon|icon)\('([a-z-]+)'/g)) {
    assert.ok(ICONS[name], `${file} asks for icon '${name}', which is not in src/core/icons.js`);
  }
}

assert.equal(icon('nope'), '');
assert.match(icon('check', 12), /^<svg class="ic" width="12" height="12" viewBox="0 0 24 24"[^>]*aria-hidden="true">/);

// Text characters that an iPhone draws as emoji, or that were standing in for an icon, stay out of the pages.
for (const [file, text] of Object.entries(source)) {
  const found = text.match(/[☎⚠↗↙✕▸]/u);
  assert.equal(found, null, `${file} uses the character ${found?.[0]} as an icon; use icon() from src/core/icons.js`);
}

// Motion runs on the shared tokens: no hard-coded duration in a transition, in any stylesheet.
const css = { 'index.html': source['index.html'].split('<link rel="stylesheet" href="src/styles/system.css">')[0] };
for (const f of readdirSync('src/styles')) css['src/styles/' + f] = readFileSync('src/styles/' + f, 'utf8');
for (const [file, text] of Object.entries(css)) {
  const bad = text.match(/transition:[^;}]*(?<![\w(-])\d*\.?\d+m?s\b[^;}]*/);
  assert.equal(bad, null, `${file}: "${bad?.[0].trim()}" should use --dur-1/2/3 and --ease (or --t-ui)`);
}

console.log('icons: ok');
