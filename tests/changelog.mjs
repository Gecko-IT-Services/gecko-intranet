import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEARCH_URL, toEntries, byDay, unseen, dayLabel, fetchEntries } from '../src/core/changelog.js';

const pr = (number, login, merged_at, title = `Change ${number}`) =>
  ({ number, title, user: { login }, html_url: `https://github.com/Gecko-IT-Services/gecko-intranet/pull/${number}`, pull_request: { merged_at } });

// GitHub's rows → entries: merged only, newest first, the account turned into the person
const entries = toEntries([
  pr(120, 'PhilipGecko99', '2026-10-11T12:00:00Z', 'Clients › Atera: the bill against what clients pay'),
  pr(126, 'Gecko-IT', '2026-10-12T12:11:04Z', '  Timesheets: attach files\n to an entry '),
  pr(999, 'Gecko-IT', null),
  pr(125, 'dependabot[bot]', '2026-10-12T11:00:00Z'),
  { number: 7, title: 'No link', user: null, html_url: 'javascript:alert(1)', pull_request: { merged_at: '2026-10-01T12:00:00Z' } }
]);
assert.deepEqual(entries.map(e => e.number), [126, 125, 120, 7]);
assert.deepEqual(entries[0], { number: 126, title: 'Timesheets: attach files to an entry', who: 'Jack', at: '2026-10-12T12:11:04Z',
  url: 'https://github.com/Gecko-IT-Services/gecko-intranet/pull/126' });
assert.equal(entries[2].who, 'Philip');
assert.equal(entries[1].who, 'dependabot[bot]', 'an account nobody listed shows under its own name');
assert.deepEqual([entries[3].who, entries[3].url], ['', ''], 'only a GitHub address is ever a link');
assert.deepEqual(toEntries(null), []);

// Grouped by the day it was merged, days and entries newest first
const key = at => at.slice(0, 10);
assert.deepEqual(byDay(entries, key).map(d => [d.day, d.entries.map(e => e.number)]),
  [['2026-10-12', [126, 125]], ['2026-10-11', [120]], ['2026-10-01', [7]]]);
assert.equal(dayLabel('2026-10-12', '2026-10-12'), 'Today');
assert.equal(dayLabel('2026-10-11', '2026-10-12'), 'Yesterday');
assert.equal(dayLabel('2026-10-09', '2026-10-12'), 'Fri 9 Oct');
assert.equal(dayLabel('2026-09-30', '2026-10-01'), 'Yesterday', 'across a month end');

// What is new to me: the other person's changes since I last looked
const seen = '2026-10-11T18:00:00Z';
assert.deepEqual(unseen(entries, 'Philip', seen).map(e => e.number), [126, 125]);
assert.deepEqual(unseen(entries, 'Jack', seen).map(e => e.number), [125], 'never my own');
assert.deepEqual(unseen(entries, 'Jack', '2026-10-12T13:00:00Z'), []);
assert.deepEqual(unseen(entries, '', seen), [], 'nobody recognised: nothing is flagged');
assert.deepEqual(unseen(entries, 'Jack', ''), [], 'never looked before: nothing is flagged');

// Reading GitHub: the answer, or a sentence that says what went wrong
assert.match(SEARCH_URL, /^https:\/\/api\.github\.com\/search\/issues\?q=repo%3AGecko-IT-Services%2Fgecko-intranet%20is%3Apr%20is%3Amerged&/);
const answer = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
assert.deepEqual((await fetchEntries(answer(200, { items: [pr(1, 'Gecko-IT', '2026-10-01T09:00:00Z')] }))).map(e => e.number), [1]);
await assert.rejects(fetchEntries(answer(403, {})), /limiting requests/);
await assert.rejects(fetchEntries(answer(429, {})), /limiting requests/);
await assert.rejects(fetchEntries(answer(500, {})), /GitHub answered 500/);
await assert.rejects(fetchEntries(answer(200, { message: 'nope' })), /not with a list/);
await assert.rejects(fetchEntries(async () => { throw new TypeError('Failed to fetch'); }), /Could not reach GitHub/);

// The page has somewhere to draw it, the sidebar has the link the dot sits on, and quick find knows it
const html = readFileSync('index.html', 'utf8');
assert.ok(html.includes('id="setChangelog"'), 'Settings has the change log card');
assert.ok(html.includes('class="sb-link" type="button" data-section="settings"'), 'the sidebar has the Settings link');
assert.ok(readFileSync('src/core/find.js', 'utf8').includes("['Settings › Change log', 'settings']"), 'quick find lists the change log');

console.log('changelog: ok');
