# Quick Find Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One box (⌘K, a Find row in the sidebar, a search button on the phone) that goes straight to a client, person, job, deal, prospect, task, page, invoice or timesheet entry, or runs an everyday action.

**Architecture:** Pure matching and grouping in `src/core/find.js` (tested under Node). `src/sections/find.js` owns the native `<dialog>`, reads the small lists once and filters them in the browser, asks the database for invoices and timesheet entries as you type, and opens a result through `geckoGo` and small `open(id)` hooks added to Jobs, Opportunities and Tasks. It is part of the shell, registered as `window.GeckoFind`.

**Tech Stack:** Static site, plain ES modules, no build step, no framework. Supabase JS (already loaded by `src/core/supabase.js`). Tests are plain Node scripts using `node:assert/strict`.

**Design note:** `docs/superpowers/specs/2026-10-12-quick-find-design.md`. Read it first.

## Global Constraints

- Branch `feat/quick-find` (already created; the design note is committed on it). Do not push or open a pull request without Jack saying so.
- No bundler, no framework, no TypeScript, no new dependency. No schema change: quick find only reads.
- Every rendered value goes through `escapeHtml`.
- An error state must never look like an empty state: a list that could not be searched is named ("Not searched: jobs (reason)"); "Nothing matches" is only shown when nothing is still loading.
- The one matching rule: every word typed must match the start of a word in the row's text, ignoring case. Up to five results per group.
- Text sent to the database is reduced to letters, digits and hyphens first (`remoteWords`).
- Existing CSS tokens only (`--card`, `--card-hover`, `--border-dim`, `--green`, `--amber`, `--muted`, `--faint`, `--white`, `--radius`, `--radius-sm`, `--overlay`, `--font-body`, `--font-mono`, `--sb-ink`). Transitions use `--dur-1/2/3` + `--ease` or `--t-ui`, never a raw duration (`tests/icons.mjs` fails otherwise). Buttons are `.btn` family. Icons come from `src/core/icons.js` (`icon(name, size)`); no text character used as an icon (`☎ ⚠ ↗ ↙ ✕ ▸` fail `tests/icons.mjs`).
- Sidebar look: there is one `.sidebar` CSS block near the top of `index.html`; sidebar rules go there, not in another layer further down.
- Sentence case for every label.
- `src/core/*.js` and `src/sections/*.js` must not touch `window`, `document` or `navigator` at module top level (they are imported under Node by the tests).
- A classic-script `const` in `index.html` is not on `window`; modules reach classic-script code only through `function` declarations (`geckoGo`, `navTo`, `closeSidebar`) or things explicitly put on `window`.
- Run the whole suite before every commit: `for t in tests/*.mjs; do node $t; done`. Every script ends with a line containing `ok` or `passed`; any stack trace is a failure.
- The local preview (`.claude/preview/`, git-ignored, mock sign-in as Jack Morris, in-memory database with clients Northgate Logistics, Alder & Finch Solicitors, Riverside Dental, Harbour Lane Architects, Pennine Joinery) is how pages are checked: `node .claude/preview/build.mjs` after every edit, then the `hq-preview` server on port 8803. Never commit anything from `.claude/preview/`.

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `src/core/find.js` | create | Pages and actions lists, the matching rule, grouping, tidying text for the database, invoice and timesheet rows |
| `tests/find.mjs` | create | Tests for the above, and that every listed page still exists |
| `src/core/icons.js` | modify | Six icons: search, building, user, briefcase, file, clock |
| `src/sections/tasks.js` | modify | `openTask(id)`, `newTask()` |
| `src/sections/jobs.js` | modify | `open(id)`, `add()` |
| `src/sections/opportunities.js` | modify | `open(id)`, `openProspect(id)`, the found prospect's outline |
| `src/styles/opportunities.css` | modify | The outline |
| `index.html` | modify | `geckoGo` switches Overview's tabs; the sidebar Find row; the top-bar search button |
| `src/sections/find.js` | create | The dialog, reading, the two database searches, the keyboard, opening a result |
| `src/styles/system.css` | modify | "11 · Quick find" |
| `src/main.js` | modify | Register `window.GeckoFind`, start it |
| `CLAUDE.md` | modify | A Quick find section |

---

### Task 1: The rules (`src/core/find.js`)

**Files:**
- Create: `src/core/find.js`
- Create: `tests/find.mjs`

**Interfaces:**
- Consumes: `OPEN_STAGES`, `stageLabel` from `src/core/jobs.js`; `STAGES` from `src/core/prospects.js`; `sameClient` from `src/core/client.js`; `dueLabel` from `src/core/tasks.js`.
- Produces (exported from `src/core/find.js`):
  - `PER_GROUP` (5), `REMOTE_ROWS` (50), `REMOTE_MIN` (3)
  - `ACTIONS: [{ label, words, open }]`, `PAGES: [{ label, open }]`
  - `words(text): string[]`, `matchLevel(query, name, extra?): 0 | 1 | 2`
  - `clientNames(geckoClients, ssaClients): string[]`
  - `search(index, query, today): [{ key, label, rows: [{ title, sub, open }] }]` — `index` is `{ clients: string[], contacts, jobs, deals, prospects, tasks }`, any of them null
  - `remoteWords(query): string[]`, `remoteReady(query): boolean`
  - `invoiceState(invoice, today): 'paid' | 'draft' | 'overdue' | 'due'`
  - `invoiceRows(invoices, query, today): row[]`, `entryRows(entries, query, clientsById: Map<string, string>): row[]`
  - A row's `open` is one of: `{ kind: 'client', name, tab }` · `{ kind: 'page', section, tab }` · `{ kind: 'job', id }` · `{ kind: 'deal', id }` · `{ kind: 'prospect', id }` · `{ kind: 'task', id }` · `{ kind: 'action', run: 'task' | 'job' }`

- [ ] **Step 1: Write the failing test**

Create `tests/find.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGES, ACTIONS, PER_GROUP, words, matchLevel, clientNames, search, remoteWords, remoteReady, invoiceState, invoiceRows, entryRows } from '../src/core/find.js';

const today = '2026-10-08';   // Thursday

// Words, and the one rule: every word typed starts a word of the text
assert.deepEqual(words('INV-0131  Harbour Lane (Ltd)'), ['inv', '0131', 'harbour', 'lane', 'ltd']);
assert.equal(matchLevel('harb lane', 'Harbour Lane Architects'), 2);
assert.equal(matchLevel('LANE harb', 'Harbour Lane Architects'), 2, 'any order, any case');
assert.equal(matchLevel('king', 'Kingdom Products'), 2);
assert.equal(matchLevel('king', 'Checking the backup'), 0, 'not the middle of a word');
assert.equal(matchLevel('sam harb', 'Sam Carter', 'Harbour Lane Architects'), 1, 'a word found only in the supporting text ranks lower');
assert.equal(matchLevel('sam xyz', 'Sam Carter', 'Harbour Lane Architects'), 0, 'every word must match');
assert.equal(matchLevel('', 'Anything'), 0);
assert.equal(matchLevel('  ', 'Anything'), 0);

// One name per client whatever the spelling
assert.deepEqual(clientNames([{ title: 'Cowan Consultancy' }, { title: 'Technix' }], [{ name: 'Cowan Consultancy Ltd' }, { name: 'LS Commercials' }, { name: '' }]),
  ['Cowan Consultancy', 'Technix', 'LS Commercials']);
assert.deepEqual(clientNames(null, null), []);

// Nothing typed: the actions only
assert.deepEqual(search({}, '', today), [{ key: 'actions', label: 'Actions', rows: ACTIONS.map(a => ({ title: a.label, sub: '', open: a.open })) }]);
assert.equal(ACTIONS.length, 3);

// Searching what is held in the browser
const index = {
  clients: ['Harbour Lane Architects', 'Harbourside Dental', 'Kingdom Products', 'Technix'],
  contacts: [
    { name: 'Sam Carter', email: 'sam@harbourlane.co.uk', role: 'Owner', client_name: 'Harbour Lane Architects' },
    { name: '', email: 'accounts@technix.example', role: '', client_name: 'Technix' }
  ],
  jobs: [
    { id: 1, title: 'Meeting room screen', client_name: 'Harbour Lane Architects', status: 'in_progress', value: 1850 },
    { id: 2, title: 'Harbour office move', client_name: 'Technix', status: 'invoiced', value: null }
  ],
  deals: [
    { id: 7, title: 'VoxOne phones', client_name: 'Harbour Lane Architects', status: 'proposed', mrr: 60 },
    { id: 8, title: 'Email filtering', client_name: 'Harbour Lane Architects', status: 'won', mrr: 0 }
  ],
  prospects: [{ id: 3, company: 'Harbinger Law', contact_name: 'Jo Finch', stage: 'meeting' }],
  tasks: [
    { id: 11, title: 'Send the call recording price', note: '', client_name: 'Harbour Lane Architects', assigned_to: 'Philip', due_on: '2026-10-14', done_at: null },
    { id: 12, title: 'Ring the Harbour office', note: '', client_name: '', assigned_to: 'Jack', due_on: '2026-10-08', done_at: '2026-10-08T09:00:00Z' }
  ]
};
let g = search(index, 'harb', today);
assert.deepEqual(g.map(x => x.key), ['clients', 'people', 'jobs', 'prospects', 'tasks'], 'groups in display order; empty ones left out');
const rows = key => g.find(x => x.key === key).rows;
assert.deepEqual(rows('clients'), [
  { title: 'Harbourside Dental', sub: '', open: { kind: 'client', name: 'Harbourside Dental', tab: '' } },
  { title: 'Harbour Lane Architects', sub: '', open: { kind: 'client', name: 'Harbour Lane Architects', tab: '' } }
], 'shorter name first');
assert.deepEqual(rows('people'), [{ title: 'Sam Carter', sub: 'Harbour Lane Architects · Owner', open: { kind: 'client', name: 'Harbour Lane Architects', tab: 'contacts' } }],
  'a person is found by their client or email, and opens Details & contacts');
assert.deepEqual(rows('jobs'), [
  { title: 'Harbour office move', sub: 'Technix · job, invoiced', open: { kind: 'client', name: 'Technix', tab: 'jobs' } },
  { title: 'VoxOne phones', sub: 'Harbour Lane Architects · deal, proposed · £60/mo', open: { kind: 'deal', id: 7 } },
  { title: 'Email filtering', sub: 'Harbour Lane Architects · deal, won', open: { kind: 'client', name: 'Harbour Lane Architects', tab: 'opportunities' } },
  { title: 'Meeting room screen', sub: 'Harbour Lane Architects · job, in progress · £1,850', open: { kind: 'job', id: 1 } }
], 'a match in the title first; open ones open on their board, finished ones on the client page');
assert.deepEqual(rows('prospects'), [{ title: 'Harbinger Law', sub: 'Jo Finch · Meeting', open: { kind: 'prospect', id: 3 } }]);
assert.deepEqual(rows('tasks'), [{ title: 'Send the call recording price', sub: 'Harbour Lane Architects · Philip · Wed 14 Oct', open: { kind: 'task', id: 11 } }], 'open tasks only');

assert.deepEqual(search(index, 'accounts technix', today).find(x => x.key === 'people').rows[0].title, 'accounts@technix.example', 'no name: the email is the title');
g = search(index, 'licen', today);
assert.deepEqual(g, [{ key: 'pages', label: 'Pages', rows: [{ title: 'Clients › Licences', sub: '', open: { kind: 'page', section: 'licences', tab: '' } }] }]);
g = search(index, 'time', today);
assert.deepEqual(g.map(x => [x.key, x.rows.map(r => r.title)]), [
  ['pages', ['Analytics › Time', 'Timesheets › Log time', 'Timesheets › SSA dashboard', 'Timesheets › Weekly summary']],
  ['actions', ['Log time']]
]);
assert.deepEqual(search(index, 'todo', today), [{ key: 'actions', label: 'Actions', rows: [{ title: 'Add task', sub: '', open: { kind: 'action', run: 'task' } }] }], 'an action is found by its other words');
assert.deepEqual(search(index, 'zzz', today), []);
assert.deepEqual(search(null, 'harb', today), [], 'nothing loaded: nothing found, no crash');
assert.deepEqual(search({ clients: null, jobs: null }, 'overview today', today).map(x => x.key), ['pages'], 'a list that did not load is skipped');
const many = { clients: Array.from({ length: 9 }, (_, i) => 'Acme ' + i) };
assert.equal(search(many, 'acme', today)[0].rows.length, PER_GROUP);

// What is sent to the database
assert.deepEqual(remoteWords('  INV-0131, (harbour) 50% _x_ '), ['inv-0131', 'harbour', '50', 'x']);
assert.deepEqual(remoteWords('a b c d e f'), ['a', 'b', 'c', 'd']);
assert.deepEqual(remoteWords('- -- %'), []);
assert.equal(remoteReady('ha'), false);
assert.equal(remoteReady('har'), true);
assert.equal(remoteReady('13'), true, 'two digits are enough for an invoice number');
assert.equal(remoteReady('a b'), false);
assert.equal(remoteReady('%%%'), false);

// Invoices
assert.equal(invoiceState({ status: 'PAID', amount_due: 0 }, today), 'paid');
assert.equal(invoiceState({ status: 'AUTHORISED', amount_due: 0 }, today), 'paid');
assert.equal(invoiceState({ status: 'DRAFT', amount_due: 10 }, today), 'draft');
assert.equal(invoiceState({ status: 'AUTHORISED', amount_due: 10, due_date: '2026-10-01' }, today), 'overdue');
assert.equal(invoiceState({ status: 'AUTHORISED', amount_due: 10, due_date: '2026-10-08' }, today), 'due');
const inv = [
  { invoice_number: 'INV-0131', contact_name: 'LS Commercials', reference: 'Laptop', invoice_date: '2026-07-14', due_date: '2026-07-28', status: 'PAID', total: 648, amount_due: 0 },
  { invoice_number: 'INV-0142', contact_name: 'Harbour Lane Architects', reference: '', invoice_date: '2026-10-01', due_date: '2026-10-15', status: 'AUTHORISED', total: 540, amount_due: 540 },
  { invoice_number: 'INV-1310', contact_name: 'Technix', reference: 'Checking backup', invoice_date: '2026-08-03', due_date: '2026-08-17', status: 'AUTHORISED', total: 215.9, amount_due: 215.9 }
];
assert.deepEqual(invoiceRows(inv, '131', today).map(r => r.title), ['INV-1310', 'INV-0131'], 'digits match the start of a number (the rule) and also the end of one');
assert.deepEqual(invoiceRows(inv, '31', today).map(r => r.title), ['INV-0131'], 'the end of a number, not the middle of another');
assert.deepEqual(invoiceRows(inv, 'inv', today).map(r => r.title), ['INV-0142', 'INV-1310', 'INV-0131'], 'newest first');
assert.deepEqual(invoiceRows(inv, 'harbour', today), [{ title: 'INV-0142', sub: 'Harbour Lane Architects · 1 Oct · £540.00 · due', open: { kind: 'client', name: 'Harbour Lane Architects', tab: 'invoices' } }]);
assert.deepEqual(invoiceRows(inv, 'laptop', today).map(r => r.title), ['INV-0131'], 'found by its reference');
assert.deepEqual(invoiceRows(inv, 'king', today), [], '"Checking" does not match "king"');
assert.deepEqual(invoiceRows(null, 'inv', today), []);

// Timesheet entries
const byId = new Map([['1', 'Harbour Lane Architects'], ['2', 'Technix']]);
const entries = [
  { client_id: 1, engineer: 'Jack', entry_date: '2026-10-08', hours: 0.5, title: 'Onsite', work_description: 'New starter set up\nLaptop and mailbox', deleted_at: null },
  { client_id: 2, engineer: 'Philip', entry_date: '2026-10-01', hours: 1.25, title: 'Starter pack', work_description: '', deleted_at: null },
  { client_id: 2, engineer: 'System', entry_date: '2026-10-02', hours: 10, title: 'Renewal starter credit', work_description: '', deleted_at: null },
  { client_id: 1, engineer: 'Jack', entry_date: '2026-10-03', hours: 1, title: 'Starter removed', work_description: '', deleted_at: '2026-10-04T10:00:00Z' },
  { client_id: 9, engineer: 'Jack', entry_date: '2026-08-01', hours: 2, title: 'Restarted the server', work_description: 'Starter motor joke', deleted_at: null }
];
assert.deepEqual(entryRows(entries, 'starter', byId), [
  { title: 'New starter set up', sub: 'Harbour Lane Architects · 8 Oct · Jack · 0.5h', open: { kind: 'client', name: 'Harbour Lane Architects', tab: 'support' } },
  { title: 'Starter pack', sub: 'Technix · 1 Oct · Philip · 1.25h', open: { kind: 'client', name: 'Technix', tab: 'support' } },
  { title: 'Starter motor joke', sub: '1 Aug · Jack · 2h', open: { kind: 'page', section: 'timesheets', tab: 'week' } }
], 'work only, newest first; first line of the description, else the title; a client that is not known opens Timesheets');
assert.deepEqual(entryRows(entries, 'start', byId).length, 3, '"Restarted" does not match "start"');
assert.deepEqual(entryRows(null, 'x', byId), []);

// The pages list cannot go stale: every page and tab it names still exists in the source
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = f => readFileSync(new URL('../src/sections/' + f, import.meta.url), 'utf8');
const TAB_IN = {
  overview: tab => html.includes(`{ key: '${tab}', label: '`),
  analytics: tab => src('analytics.js').includes(`{ key: '${tab}', label: '`),
  opportunities: tab => new RegExp(`export function show\\(tab\\) \\{\\s*if \\(!tab \\|\\| !\\[[^\\]]*'${tab}'`).test(src('opportunities.js')),
  jobs: tab => src('jobs.js').includes(`['${tab}', '`),
  timesheets: tab => html.includes(`tshTab('${tab}')`)
};
for (const { label, open } of PAGES) {
  assert.ok(html.includes(`id="section-${open.section}"`), `${label}: index.html has no section "${open.section}"`);
  if (open.tab) {
    assert.ok(TAB_IN[open.section], `${label}: quick find cannot open a tab of "${open.section}" (geckoGo does not switch its tabs)`);
    assert.ok(TAB_IN[open.section](open.tab), `${label}: "${open.section}" has no tab "${open.tab}"`);
  }
}
assert.equal(new Set(PAGES.map(p => p.label)).size, PAGES.length, 'no page listed twice');

console.log('find: all tests passed');
```

(The dates in the fixtures avoid September on purpose: runtimes print it as "Sep" or "Sept".)

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/find.mjs`
Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module … src/core/find.js`

- [ ] **Step 3: Write the module**

Create `src/core/find.js`:

```js
/* Quick find: pure logic (no window). Tested in tests/find.mjs.
   Design: docs/superpowers/specs/2026-10-12-quick-find-design.md

   One rule everywhere: every word typed must match the start of a word in the row's text. The lists
   small enough to hold (clients, people, jobs, deals, prospects, tasks, pages, actions) are searched
   here; invoices and timesheet entries are asked for from the database and then put through the same rule. */

import { OPEN_STAGES, stageLabel } from './jobs.js';
import { STAGES as PROSPECT_STAGES } from './prospects.js';
import { sameClient } from './client.js';
import { dueLabel } from './tasks.js';

export const PER_GROUP = 5;        // results shown per group
export const REMOTE_ROWS = 50;     // newest rows asked of the database per search
export const REMOTE_MIN = 3;       // characters before the database is asked (2 when they are digits)

/** The everyday actions. `go` is a page; `run` is something the page layer does. */
export const ACTIONS = [
  { label: 'Log time', words: 'timesheet hours', open: { kind: 'page', section: 'timesheets', tab: 'log' } },
  { label: 'Add task', words: 'new to-do todo', open: { kind: 'action', run: 'task' } },
  { label: 'Add a job', words: 'new quote', open: { kind: 'action', run: 'job' } }
];

/** Every page and tab that can be gone to. tests/find.mjs checks each one still exists. */
export const PAGES = [
  ['Overview › Today', 'overview', 'today'], ['Overview › This week', 'overview', 'week'],
  ['Overview › Month-end', 'overview', 'monthend'], ['Overview › Business', 'overview', 'business'],
  ['Analytics › Revenue', 'analytics', 'revenue'], ['Analytics › Time', 'analytics', 'time'], ['Analytics › Ahead', 'analytics', 'ahead'],
  ['Clients › Directory', 'clients'], ['Clients › Profitability', 'profitability'], ['Clients › Licences', 'licences'], ['Clients › Atera', 'atera'],
  ['Opportunities › Pipeline', 'opportunities', 'pipeline'], ['Opportunities › Gaps', 'opportunities', 'gaps'],
  ['Opportunities › Prospects', 'opportunities', 'prospects'], ['Opportunities › VoIP Unlimited', 'opportunities', 'voip'],
  ['Opportunities › Products', 'opportunities', 'products'],
  ['Jobs › Jobs', 'jobs', 'jobs'], ['Jobs › This month', 'jobs', 'month'], ['Jobs › Owed to us', 'jobs', 'owed'],
  ['Timesheets › Log time', 'timesheets', 'log'], ['Timesheets › SSA dashboard', 'timesheets', 'ssa'], ['Timesheets › Weekly summary', 'timesheets', 'week'],
  ['Monitoring › Backups', 'backups'], ['Monitoring › Alerts', 'alerts'], ['Monitoring › Devices', 'devices'],
  ['Team › Overview', 'team'], ['Team › Leave', 'leave'], ['Team › Mileage', 'mileage'],
  ['Settings', 'settings']
].map(([label, section, tab = '']) => ({ label, open: { kind: 'page', section, tab } }));

const DEAL_LABEL = { idea: 'Idea', proposed: 'Proposed', won: 'Won', lost: 'Lost' };
const PROSPECT_LABEL = Object.fromEntries(PROSPECT_STAGES);
const day = d => String(d || '').slice(0, 10);
const pounds = n => '£' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const shortDate = d => (day(d) ? new Date(day(d) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
const join = parts => parts.filter(Boolean).join(' · ');

/** Lower-case words of a text: letters and digits, split on everything else ("INV-0131" → inv, 0131). */
export const words = text => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well a query matches: 2 = every word starts a word of `name`; 1 = every word starts a word of
 * `name` or `extra`; 0 = no match (or nothing typed).
 */
export function matchLevel(query, name, extra = '') {
  const q = words(query);
  if (!q.length) return 0;
  const inName = words(name), inExtra = words(extra);
  const starts = (list, w) => list.some(x => x.startsWith(w));
  if (q.every(w => starts(inName, w))) return 2;
  return q.every(w => starts(inName, w) || starts(inExtra, w)) ? 1 : 0;
}

/** Best first: a match in the name, then the shorter name, then A to Z. Returns at most `limit` rows. */
function best(items, query, toRow, limit = PER_GROUP) {
  return items.map(it => ({ it, row: toRow(it) }))
    .map(x => ({ ...x, level: matchLevel(query, x.row.title, x.row.match ?? x.row.sub) }))
    .filter(x => x.level)
    .sort((a, b) => b.level - a.level || a.row.title.length - b.row.title.length || a.row.title.localeCompare(b.row.title))
    .slice(0, limit)
    .map(({ row }) => ({ title: row.title, sub: row.sub || '', open: row.open }));
}

/** Client names from the two lists that hold them, one per client whatever the spelling. */
export function clientNames(geckoClients, ssaClients) {
  const out = [];
  for (const n of [...(geckoClients || []).map(c => c.title), ...(ssaClients || []).map(c => c.name)]) {
    const name = String(n || '').trim();
    if (name && !out.some(x => sameClient(x, name))) out.push(name);
  }
  return out;
}

/**
 * Search what is held in the browser. `index` = { clients: [name], contacts, jobs, deals, prospects, tasks }
 * (a list that did not load is null and is simply not searched). Returns the groups that have rows, in
 * display order: [{ key, label, rows: [{ title, sub, open }] }]. Nothing typed: the actions only.
 */
export function search(index, query, today) {
  const ix = index || {};
  const actions = ACTIONS.map(a => ({ title: a.label, sub: '', match: a.words, open: a.open }));
  if (!words(query).length) return [{ key: 'actions', label: 'Actions', rows: actions.map(({ title, sub, open }) => ({ title, sub, open })) }];
  const client = (name, tab = '') => ({ kind: 'client', name, tab });
  const jobsAndDeals = [
    ...(ix.jobs || []).map(j => ({
      title: j.title, sub: join([j.client_name, `job, ${stageLabel(j.status).toLowerCase()}`, j.value == null ? '' : pounds(j.value)]),
      open: OPEN_STAGES.has(j.status) ? { kind: 'job', id: j.id } : client(j.client_name, 'jobs')
    })),
    ...(ix.deals || []).map(d => ({
      title: d.title, sub: join([d.client_name, `deal, ${(DEAL_LABEL[d.status] || d.status || '').toLowerCase()}`, Number(d.mrr) ? pounds(d.mrr) + '/mo' : '']),
      open: d.status === 'idea' || d.status === 'proposed' ? { kind: 'deal', id: d.id } : client(d.client_name, 'opportunities')
    }))
  ];
  const groups = [
    ['clients', 'Clients', best(ix.clients || [], query, name => ({ title: name, sub: '', open: client(name) }))],
    ['people', 'People', best(ix.contacts || [], query, c => ({
      title: c.name || c.email, sub: join([c.client_name, c.role]), match: join([c.email, c.client_name]), open: client(c.client_name, 'contacts')
    }))],
    ['jobs', 'Jobs and deals', best(jobsAndDeals, query, x => x)],
    ['prospects', 'Prospects', best(ix.prospects || [], query, p => ({
      title: p.company, sub: join([p.contact_name, PROSPECT_LABEL[p.stage] || p.stage]), match: p.contact_name, open: { kind: 'prospect', id: p.id }
    }))],
    ['tasks', 'Tasks', best((ix.tasks || []).filter(t => !t.done_at), query, t => ({
      title: t.title, sub: join([t.client_name, t.assigned_to, dueLabel(t.due_on, today)]), match: join([t.note, t.client_name]), open: { kind: 'task', id: t.id }
    }))],
    ['pages', 'Pages', best(PAGES, query, p => ({ title: p.label, sub: '', open: p.open }))],
    ['actions', 'Actions', best(actions, query, a => a)]
  ];
  return groups.filter(([, , rows]) => rows.length).map(([key, label, rows]) => ({ key, label, rows }));
}

/** Words safe to send to the database: letters, digits and hyphens only, at most four. */
export const remoteWords = query => String(query || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ').split(/\s+/).filter(w => w.replace(/-/g, '')).slice(0, 4);

/** Is there enough typed to ask the database? Three characters, or two digits (an invoice number). */
export function remoteReady(query) {
  const q = remoteWords(query).join('');
  return q.length >= REMOTE_MIN || /^\d{2,}$/.test(q);
}

/** paid / draft / overdue / due, the same reading as the client page's Invoices tab. */
export function invoiceState(inv, today) {
  if (inv.status === 'PAID' || Number(inv.amount_due) <= 0) return 'paid';
  if (inv.status === 'DRAFT' || inv.status === 'SUBMITTED') return 'draft';
  return inv.due_date && day(inv.due_date) < today ? 'overdue' : 'due';
}

/** Invoices the database returned, kept only where the rule matches; newest first. Digits alone also match the end of a number. */
export function invoiceRows(invoices, query, today) {
  const digits = /^\d+$/.test(String(query || '').trim()) ? String(query).trim() : '';
  return (invoices || [])
    .filter(i => (digits && String(i.invoice_number || '').endsWith(digits)) || matchLevel(query, `${i.invoice_number} ${i.contact_name}`, i.reference))
    .sort((a, b) => day(b.invoice_date).localeCompare(day(a.invoice_date)))
    .slice(0, PER_GROUP)
    .map(i => ({
      title: i.invoice_number || 'No number', sub: join([i.contact_name, shortDate(i.invoice_date), money(i.total), invoiceState(i, today)]),
      open: { kind: 'client', name: i.contact_name, tab: 'invoices' }
    }));
}

/**
 * Timesheet entries the database returned, kept only where the rule matches; newest first. Work only:
 * deleted entries and System entries (renewal credits, adjustments) are left out, as Weekly Summary leaves them out.
 * `clientsById` maps ssa_clients.id → name (an entry holds only the id).
 */
export function entryRows(entries, query, clientsById) {
  const text = e => String(e.work_description || '').split('\n').find(l => l.trim())?.trim() || e.title || '';
  return (entries || [])
    .filter(e => !e.deleted_at && !/^system$/i.test(String(e.engineer || '').trim()))
    .filter(e => matchLevel(query, `${e.title} ${e.work_description}`))
    .sort((a, b) => day(b.entry_date).localeCompare(day(a.entry_date)))
    .slice(0, PER_GROUP)
    .map(e => {
      const name = clientsById?.get(String(e.client_id)) || '';
      return {
        title: text(e), sub: join([name, shortDate(e.entry_date), e.engineer, `${Number(e.hours) || 0}h`]),
        open: name ? { kind: 'client', name, tab: 'support' } : { kind: 'page', section: 'timesheets', tab: 'week' }
      };
    });
}
```

- [ ] **Step 4: Run the test**

Run: `node tests/find.mjs`
Expected: `find: all tests passed`

Run: `for t in tests/*.mjs; do node $t; done`
Expected: every script ends with `ok` / `passed`.

- [ ] **Step 5: Commit**

```bash
git add src/core/find.js tests/find.mjs
git commit -m "Quick find: the rules (matching, groups, pages and actions)"
```

---

### Task 2: Ways in (open a job, a deal, a prospect, a task; Overview's tabs; icons)

Quick find needs to open one specific thing from outside its page. Each hook does what a click on that thing already does.

**Files:**
- Modify: `tests/find.mjs` (append before the final `console.log`)
- Modify: `src/core/icons.js`
- Modify: `src/sections/tasks.js`
- Modify: `src/sections/jobs.js`
- Modify: `src/sections/opportunities.js`
- Modify: `src/styles/opportunities.css`
- Modify: `index.html` (`geckoGo`, near line 5520)

**Interfaces:**
- Produces:
  - `src/core/icons.js`: `ICONS.search`, `ICONS.building`, `ICONS.user`, `ICONS.briefcase`, `ICONS.file`, `ICONS.clock`
  - `src/sections/tasks.js`: `openTask(id): void`, `newTask(): void`
  - `src/sections/jobs.js`: `open(id): void`, `add(): void`
  - `src/sections/opportunities.js`: `open(id): void`, `openProspect(id): void`
  - `geckoGo('overview', tab)` switches Overview to `today | week | monthend | business`

- [ ] **Step 1: Write the failing test**

In `tests/find.mjs`, directly above the last line (`console.log('find: all tests passed');`), add:

```js
// The ways in that quick find calls exist (each does what a click on the thing already does)
{
  const { ICONS } = await import('../src/core/icons.js');
  for (const name of ['search', 'building', 'user', 'briefcase', 'file', 'clock', 'check', 'right', 'plus']) assert.ok(ICONS[name], `icon "${name}" exists`);
  const tasks = await import('../src/sections/tasks.js'), jobs = await import('../src/sections/jobs.js'), opps = await import('../src/sections/opportunities.js');
  for (const [mod, fn] of [[tasks, 'openTask'], [tasks, 'newTask'], [jobs, 'open'], [jobs, 'add'], [opps, 'open'], [opps, 'openProspect']]) assert.equal(typeof mod[fn], 'function', `${fn} is exported`);
  assert.ok(/else if \(section === 'overview'/.test(html), 'geckoGo switches Overview tabs');
}

```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/find.mjs`
Expected: `AssertionError … icon "search" exists`

- [ ] **Step 3: The icons**

In `src/core/icons.js`, the `ICONS` object ends with the `trash` entry. Add a comma after it and these six entries:

```js
  search:    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  building:  '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  user:      '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  file:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8"/>',
  clock:     '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'
```

- [ ] **Step 4: Tasks**

In `src/sections/tasks.js`, directly after the line

```js
const closeDialog = () => document.getElementById('tkDialog')?.close();
```

add

```js

/** From elsewhere (quick find): open one task's dialog, or a new one. */
export const openTask = id => { const t = byId(Number(id)); if (t) openDialog(t); };
export const newTask = () => openDialog(null);
```

- [ ] **Step 5: Jobs**

In `src/sections/jobs.js`, directly above the comment `/** Arrow keys move along the tab strip (ARIA tabs pattern). */`, add:

```js
/** From elsewhere (quick find): the whiteboard with one job picked, the same as clicking its sticky. */
export function open(id) {
  JOB.selected = Number(id);
  JOB.stage = null;
  if (JOB.tab !== 'jobs') { show('jobs'); return; }
  if (JOB.loading) return;                       // load() draws when it finishes, with the job picked
  render();
  els('jobWrap')?.querySelector('.job-pinned')?.scrollIntoView({ block: 'nearest' });
}

/** From elsewhere (quick find): the Add a job form, also while Jobs is still loading (it shows once loaded). */
export function add() {
  JOB.addStage = 'quoted'; JOB.addingIdea = false; JOB.adding = true;
  if (JOB.tab !== 'jobs') { show('jobs'); return; }
  if (JOB.loading || JOB.error) return;
  render();
  els('jobWrap')?.querySelector('[data-job-form="new"] [name="client_name"]')?.focus();
}

```

`show` is the module's existing exported function (it sets `JOB.tab` and draws). Before relying on it, read `load()` in this file and confirm it does not reset `JOB.selected` or `JOB.adding`; if it does, report it instead of working around it.

- [ ] **Step 6: Opportunities**

In `src/sections/opportunities.js`:

(a) In the `OPP` state object, directly after the line that begins `  selected: null,`, add

```js
  found: null,             // a prospect opened from quick find: outlined and scrolled to on the next draw
```

(b) Directly above the comment `/** Something added elsewhere (a client page's New opportunity): reload if this section has been opened. */`, add:

```js
/** From elsewhere (quick find): the pipeline board with one deal picked, the same as clicking its sticky. */
export function open(id) {
  OPP.tab = 'pipeline'; OPP.view = 'board'; OPP.selected = Number(id);
  if (OPP.loading) return;                       // load() draws when it finishes, with the deal picked
  render();
  els('oppWrap')?.querySelector('.job-pinned')?.scrollIntoView({ block: 'nearest' });
}

/** From elsewhere (quick find): the Prospects tab, scrolled to one prospect and outlined until the next redraw. */
export function openProspect(id) {
  OPP.tab = 'prospects'; OPP.prospectView = 'all'; OPP.prospectEdit = null; OPP.found = Number(id);
  if (!OPP.loading) render();
}

```

(c) In the prospect card, replace

```js
    return `<article class="opp-prospect st-${escapeHtml(p.stage)}">
```

with

```js
    return `<article class="opp-prospect st-${escapeHtml(p.stage)}${OPP.found === p.id ? ' found' : ''}">
```

(d) In `render()`, directly after the line `  syncTableLabels(mount);` that ends the function body, add:

```js
  // A prospect opened from quick find: bring its card into view (it stays outlined until the next redraw).
  const found = OPP.found && mount.querySelector('.opp-prospect.found');
  if (found) { found.scrollIntoView({ block: 'center' }); OPP.found = null; }
```

(e) In `src/styles/opportunities.css`, after the rule `#section-opportunities .opp-prospect.editing { display: block; }`, add:

```css
#section-opportunities .opp-prospect.found { outline: 2px solid var(--green); outline-offset: 2px; }
```

- [ ] **Step 7: Overview's tabs through `geckoGo`**

In `index.html`, in `function geckoGo(section, tab, clientName)`, the chain of `if / else if` ends with the `timesheets` branch:

```js
  else if (section === 'timesheets' && typeof tshTab === 'function') {
    tshTab(tab);
    if (clientName && tab === 'log') tshPreselect(clientName);
  }
```

Directly after that closing brace add:

```js
  else if (section === 'overview' && tab !== OVW.tab && ['today', 'week', 'monthend', 'business'].includes(tab)) {
    OVW.dir = window.GeckoTabs ? window.GeckoTabs.direction(['today', 'week', 'monthend', 'business'], OVW.tab, tab) : '';
    OVW.tab = tab;
    ovwRenderAll();
  }
```

(This is what a click on an Overview tab already does; see the `[data-ovw-tab]` click listener.)

- [ ] **Step 8: Run the tests**

Run: `node tests/find.mjs`
Expected: `find: all tests passed`

Run: `for t in tests/*.mjs; do node $t; done`
Expected: every script ends with `ok` / `passed` (`icons: ok` included).

- [ ] **Step 9: Commit**

```bash
git add tests/find.mjs src/core/icons.js src/sections/tasks.js src/sections/jobs.js src/sections/opportunities.js src/styles/opportunities.css index.html
git commit -m "Quick find: ways in (open a job, deal, prospect or task; Overview tabs; icons)"
```

---

### Task 3: The box

**Files:**
- Create: `src/sections/find.js`
- Modify: `tests/find.mjs` (append before the final `console.log`)
- Modify: `src/styles/system.css` (append at the end, after "10 · Tasks")
- Modify: `src/main.js`
- Modify: `index.html` (the `.sidebar` CSS block near line 529; the mobile block near line 716; the sidebar markup near line 3742; the top bar near line 3810)

**Interfaces:**
- Consumes: everything Task 1 produces; the hooks from Task 2; from `src/sections/tasks.js` also `read(sb)`, `put(rows, err)`, `view()`, `state()`; `connectSupabase` from `src/core/supabase.js`; `icon` from `src/core/icons.js`; `escapeHtml` from `src/core/ui.js`; the classic-script functions `window.geckoGo(section, tab, clientName)`, `window.navTo(section)`, `window.closeSidebar()`.
- Produces: `src/sections/find.js` exports `init()` and `open()`; `window.GeckoFind`. Any element with the attribute `data-find-open` opens the box; any element with `data-find-kbd` gets the shortcut text for the platform.

- [ ] **Step 1: Write the failing test**

In `tests/find.mjs`, directly above the last line (`console.log('find: all tests passed');`), add:

```js
// The box: it loads under Node, and every icon its groups use exists
{
  const box = await import('../src/sections/find.js');
  assert.deepEqual(Object.keys(box).sort(), ['init', 'open']);
  const { ICONS } = await import('../src/core/icons.js');
  const map = src('find.js').match(/const GROUP_ICON = \{([^}]+)\}/)[1];
  const names = [...map.matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
  assert.ok(names.length >= 9, 'every group has an icon');
  for (const n of names) assert.ok(ICONS[n], `group icon "${n}" exists`);
  assert.ok(html.includes('data-find-open'), 'the sidebar and the top bar have a way to open it');
}

```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/find.mjs`
Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module … src/sections/find.js`

- [ ] **Step 3: Write the module**

Create `src/sections/find.js`:

```js
/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   QUICK FIND                                                      ║
   ║                                                                   ║
   ║   One box (⌘K, the sidebar's Find row, the phone's search         ║
   ║   button) that goes straight to a client, person, job, deal,      ║
   ║   prospect, task, page, invoice or timesheet entry, or runs an    ║
   ║   everyday action. Part of the shell, not a page.                 ║
   ║   Logic: core/find.js. Styles: system.css "11 · Quick find".      ║
   ║   Design: docs/superpowers/specs/2026-10-12-quick-find-design.md  ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { escapeHtml } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { icon } from '../core/icons.js';
import { search, clientNames, remoteWords, remoteReady, invoiceRows, entryRows, REMOTE_ROWS } from '../core/find.js';
import { read as readTasks, put as putTasks, view as taskView, state as taskState, openTask, newTask } from './tasks.js';
import { open as openJob, add as addJob } from './jobs.js';
import { open as openDeal, openProspect } from './opportunities.js';

const STALE_MS = 5 * 60000;    // the lists are read again on opening after this long
const DEBOUNCE_MS = 250;       // wait this long after the last keystroke before asking the database
const GROUP_ICON = { clients: 'building', people: 'user', jobs: 'briefcase', prospects: 'user', tasks: 'check', pages: 'right', actions: 'plus', invoices: 'file', entries: 'clock' };
const SOURCE_LABEL = { gecko: 'clients', ssa: 'support clients', contacts: 'people', jobs: 'jobs', deals: 'deals', prospects: 'prospects' };
const NO_REMOTE = () => ({ q: '', invoices: null, entries: null, errors: {}, busy: false });

// index: the small lists, read once ({ clients, contacts, jobs, deals, prospects }; a list that failed is null).
// rows: the results on screen, flat, in order; sel: the selected one. seq: discards a reply to an older query.
const QF = { index: null, clientsById: new Map(), at: 0, loading: false, errors: {}, needsConnect: false, q: '', rows: [], sel: 0, seq: 0, timer: 0, remote: NO_REMOTE() };

const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const settle = p => p.then(v => ({ v }), e => ({ e }));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const signedIn = () => { const n = (document.getElementById('userName')?.textContent || '').trim(); return !!n && n !== 'Not signed in'; };
const dialog = () => document.getElementById('qfDialog');


// ─── Reading ──────────────────────────────────────────────────────────

// ponytail: each list is one request (Supabase answers at most 1,000 rows); page them when clients, contacts or jobs get near that.
async function loadIndex() {
  if (QF.loading) return;
  QF.loading = true; QF.needsConnect = false;
  render();
  try {
    const sb = await connectSupabase();
    const q = (table, cols) => settle(sb.from(table).select(cols).then(must));
    const [gecko, ssa, contacts, jobs, deals, prospects, tasks] = await Promise.all([
      q('gecko_clients', 'title'), q('ssa_clients', 'id,name'), q('client_contacts', 'client_name,name,email,role'),
      q('jobs', 'id,client_name,title,status,value'), q('opportunities', 'id,client_name,title,status,mrr'),
      q('prospects', 'id,company,contact_name,stage'), settle(readTasks(sb))
    ]);
    putTasks(tasks.v || null, tasks.e);
    QF.index = {
      clients: gecko.v || ssa.v ? clientNames(gecko.v, ssa.v) : null,
      contacts: contacts.v || null, jobs: jobs.v || null, deals: deals.v || null, prospects: prospects.v || null
    };
    QF.clientsById = new Map((ssa.v || []).map(c => [String(c.id), c.name]));
    QF.errors = {};
    for (const [k, r] of Object.entries({ gecko, ssa, contacts, jobs, deals, prospects })) if (r.e) QF.errors[k] = r.e.message || String(r.e);
    QF.at = Date.now();
  } catch (err) {
    if (err.code === 'DB_SIGNIN_REQUIRED') QF.needsConnect = true;
    else QF.errors = { all: err.message || String(err) };
  } finally { QF.loading = false; render(); }
}

/** Invoices and timesheet entries: asked for as you type, once there is enough to ask with. */
function scheduleRemote() {
  clearTimeout(QF.timer);
  QF.seq++;                                  // whatever is in flight is for an older query
  if (!remoteReady(QF.q)) { QF.remote = NO_REMOTE(); return; }
  QF.remote = { ...NO_REMOTE(), busy: true };
  const q = QF.q, seq = QF.seq;
  QF.timer = setTimeout(() => runRemote(q, seq), DEBOUNCE_MS);
}

async function runRemote(q, seq) {
  const out = { ...NO_REMOTE(), q };
  try {
    const sb = await connectSupabase();
    // ponytail: "contains" on the server (the newest 50 rows), "start of a word" here (core/find.js); a very common word needs a second word typed.
    let inv = sb.from('xero_invoices').select('invoice_id,invoice_number,contact_name,reference,invoice_date,due_date,status,total,amount_due')
      .not('status', 'in', '(VOIDED,DELETED)').order('invoice_date', { ascending: false }).limit(REMOTE_ROWS);
    let ent = sb.from('timesheet_entries').select('id,client_id,engineer,entry_date,hours,title,work_description,deleted_at')
      .is('deleted_at', null).order('entry_date', { ascending: false }).limit(REMOTE_ROWS);
    for (const w of remoteWords(q)) {      // letters, digits and hyphens only: nothing typed can change the filter
      inv = inv.or(`invoice_number.ilike.%${w}%,contact_name.ilike.%${w}%,reference.ilike.%${w}%`);
      ent = ent.or(`title.ilike.%${w}%,work_description.ilike.%${w}%`);
    }
    const [i, e] = await Promise.all([settle(inv.then(must)), settle(ent.then(must))]);
    out.invoices = i.v || null; out.entries = e.v || null;
    if (i.e) out.errors.invoices = i.e.message || String(i.e);
    if (e.e) out.errors.entries = e.e.message || String(e.e);
  } catch (err) {
    if (err.code === 'DB_SIGNIN_REQUIRED') QF.needsConnect = true;
    else out.errors = { invoices: err.message || String(err), entries: err.message || String(err) };
  }
  if (seq !== QF.seq) return;                // a reply to an older query
  QF.remote = out;
  render();
}


// ─── Drawing ──────────────────────────────────────────────────────────

function groupsNow() {
  const td = today(), r = QF.remote;
  const groups = search({ ...(QF.index || {}), tasks: taskView() }, QF.q, td);
  if (r.q && r.q === QF.q) {
    const inv = invoiceRows(r.invoices, QF.q, td), ent = entryRows(r.entries, QF.q, QF.clientsById);
    if (inv.length) groups.push({ key: 'invoices', label: 'Invoices', rows: inv });
    if (ent.length) groups.push({ key: 'entries', label: 'Timesheet entries', rows: ent });
  }
  return groups;
}

/** The lines under the results: what is still loading, and what could not be searched (never left to look like "no matches"). */
function footHtml(count) {
  const notes = [], r = QF.remote;
  if (QF.needsConnect) notes.push('<span class="qf-warn">Not connected to the database: only pages and actions can be found.</span> <button type="button" class="btn btn-sm" data-qf="connect">Connect</button>');
  else if (QF.loading && !QF.index) notes.push('Loading clients, jobs and tasks…');
  const failed = Object.entries(QF.errors).map(([k, m]) => (k === 'all' ? `clients, jobs and tasks (${m})` : `${SOURCE_LABEL[k]} (${m})`));
  if (taskState().error) failed.push(`tasks (${taskState().error})`);
  if (failed.length) notes.push(`<span class="qf-warn">Not searched: ${escapeHtml(failed.join(', '))}.</span>`);
  if (r.errors.invoices) notes.push(`<span class="qf-warn">Invoices could not be searched: ${escapeHtml(r.errors.invoices)}.</span>`);
  if (r.errors.entries) notes.push(`<span class="qf-warn">Timesheet entries could not be searched: ${escapeHtml(r.errors.entries)}.</span>`);
  if (r.busy) notes.push('Searching invoices and timesheet entries…');
  if (!QF.q.trim()) notes.push('Type to find a client, person, job, task, invoice or timesheet entry.');
  else if (count) notes.push(`${count} result${count === 1 ? '' : 's'}`);
  return notes.map(n => `<span>${n}</span>`).join('');
}

function render() {
  const d = dialog();
  if (!d?.open) return;
  const groups = groupsNow();
  QF.rows = groups.flatMap(g => g.rows);
  QF.sel = Math.min(QF.sel, Math.max(0, QF.rows.length - 1));
  let n = 0;
  const list = groups.map(g => `<div class="qf-group" role="presentation">${escapeHtml(g.label)}</div>` + g.rows.map(r => {
    const i = n++;
    return `<div class="qf-row" role="option" id="qfOpt${i}" data-qf-row="${i}" aria-selected="${i === QF.sel}">${icon(GROUP_ICON[g.key], 14)}<span class="qf-text"><span class="qf-title">${escapeHtml(r.title)}</span>${r.sub ? `<span class="qf-sub">${escapeHtml(r.sub)}</span>` : ''}</span></div>`;
  }).join('')).join('');
  const waiting = QF.remote.busy || (QF.loading && !QF.index);
  d.querySelector('#qfList').innerHTML = list || (QF.q.trim() && !waiting ? `<p class="qf-empty">Nothing matches “${escapeHtml(QF.q.trim())}”.</p>` : '');
  d.querySelector('#qfFoot').innerHTML = footHtml(QF.rows.length);
  select(QF.sel);
}

/** Mark one row as the selected one (the field keeps the focus; aria-activedescendant tells a screen reader). */
function select(i) {
  const d = dialog();
  QF.sel = Math.max(0, Math.min(i, QF.rows.length - 1));
  d.querySelectorAll('[data-qf-row]').forEach(el => el.setAttribute('aria-selected', String(Number(el.dataset.qfRow) === QF.sel)));
  const on = d.querySelector('[aria-selected="true"]');
  on?.scrollIntoView({ block: 'nearest' });
  const input = d.querySelector('#qfInput');
  if (on) input.setAttribute('aria-activedescendant', on.id); else input.removeAttribute('aria-activedescendant');
}


// ─── Opening a result ─────────────────────────────────────────────────

function openRow(i) {
  const row = QF.rows[i];
  if (!row) return;
  dialog().close();
  const o = row.open;
  if (o.kind === 'client') window.geckoGo('client', o.tab || 'summary', o.name);
  else if (o.kind === 'page') window.geckoGo(o.section, o.tab || undefined);
  else if (o.kind === 'job') { window.navTo('jobs'); openJob(o.id); }
  else if (o.kind === 'deal') { window.navTo('opportunities'); openDeal(o.id); }
  else if (o.kind === 'prospect') { window.navTo('opportunities'); openProspect(o.id); }
  else if (o.kind === 'task') openTask(o.id);
  else if (o.kind === 'action' && o.run === 'task') newTask();
  else if (o.kind === 'action' && o.run === 'job') { window.navTo('jobs'); addJob(); }
}


// ─── The box ──────────────────────────────────────────────────────────

function build() {
  const d = document.createElement('dialog');
  d.id = 'qfDialog'; d.className = 'qf-dialog'; d.setAttribute('aria-label', 'Quick find');
  d.innerHTML = `<div class="qf-head">${icon('search', 16)}
      <input id="qfInput" type="text" role="combobox" aria-expanded="true" aria-controls="qfList" aria-autocomplete="list" aria-label="Find"
        placeholder="Find a client, job, task, invoice…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
      <kbd class="qf-kbd">Esc</kbd></div>
    <div id="qfList" class="qf-list" role="listbox" aria-label="Results"></div>
    <div id="qfFoot" class="qf-foot" aria-live="polite"></div>`;
  const input = d.querySelector('#qfInput');
  input.addEventListener('input', () => { QF.q = input.value; QF.sel = 0; scheduleRemote(); render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); select(QF.sel + (e.key === 'ArrowDown' ? 1 : -1)); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); openRow(QF.sel); }
  });
  d.addEventListener('click', e => {
    if (e.target === d) { d.close(); return; }                     // the backdrop
    const row = e.target.closest('[data-qf-row]');
    if (row) { openRow(Number(row.dataset.qfRow)); return; }
    if (e.target.closest('[data-qf="connect"]')) connectSupabase({ interactive: true }).then(loadIndex, () => {});
  });
  d.addEventListener('close', () => { clearTimeout(QF.timer); QF.seq++; });
  document.getElementById('app').append(d);
  return d;
}

/** Open the box (⌘K, the sidebar's Find row, the phone's search button). Nothing happens when signed out or while another dialog is open. */
export function open() {
  if (!signedIn() || document.querySelector('dialog[open]')) return;
  const d = dialog() || build();
  QF.q = ''; QF.sel = 0; QF.remote = NO_REMOTE();
  d.querySelector('#qfInput').value = '';
  window.closeSidebar?.();                     // on a phone the Find row sits in the slide-over menu
  d.showModal();
  d.querySelector('#qfInput').focus();
  render();
  if (!QF.index || Date.now() - QF.at > STALE_MS) loadIndex();
}

let started = false;
export function init() {
  if (started) return;
  started = true;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  document.querySelectorAll('[data-find-kbd]').forEach(k => { k.textContent = mac ? '⌘K' : 'Ctrl K'; });
  document.addEventListener('click', e => { if (e.target.closest?.('[data-find-open]')) open(); });
  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'k' || !signedIn()) return;
    e.preventDefault();                        // the browser's own Ctrl+K (address bar search)
    if (dialog()?.open) dialog().close(); else open();
  });
}
```

Every value placed in the HTML goes through `escapeHtml`; row numbers and counts are numbers made here. The dialog is appended inside `#app` so the design-system rules (anchored on `#app`) reach it.

- [ ] **Step 4: Add the styles**

Append to the end of `src/styles/system.css`:

```css
/* ── 11 · Quick find ────────────────────────────────────────────────── */
/* One box for the whole app (src/sections/find.js): ⌘K, the sidebar's Find row, the phone's search button.
   Design: docs/superpowers/specs/2026-10-12-quick-find-design.md */
#app .qf-dialog {
  width: min(560px, calc(100vw - 24px)); max-height: none; margin: 12vh auto auto; padding: 0; overflow: hidden;
  border: 1px solid var(--border-dim); border-radius: var(--radius); background: var(--card); color: var(--white);
}
#app .qf-dialog::backdrop { background: var(--overlay, rgb(0 0 0 / .55)); }
#app .qf-head { display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--border-dim); color: var(--faint); }
#app .qf-head .ic { flex: none; }
#app .qf-head input {
  flex: 1; min-width: 0; height: 52px; padding: 0; border: 0; outline: 0; background: transparent;
  font: 400 16px/1.3 var(--font-body); color: var(--white);
}
#app .qf-head input::placeholder { color: var(--faint); }
#app .qf-kbd { padding: 3px 6px; border: 1px solid var(--border-dim); border-radius: 6px; font: 500 11px/1 var(--font-mono); color: var(--faint); white-space: nowrap; }

#app .qf-list { max-height: min(56dvh, 440px); overflow-y: auto; overscroll-behavior: contain; padding-bottom: 6px; }
#app .qf-list:empty { display: none; }
#app .qf-group { padding: 10px 16px 4px; font: 500 12px/1.2 var(--font-body); color: var(--faint); }
#app .qf-row { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 6px 16px; cursor: pointer; }
#app .qf-row .ic { flex: none; color: var(--faint); }
#app .qf-text { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
#app .qf-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 14px/1.35 var(--font-body); color: var(--white); }
#app .qf-sub { flex: 0 1 auto; min-width: 0; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.35; color: var(--muted); }
#app .qf-row[aria-selected="true"] { background: var(--card-hover); }
#app .qf-row[aria-selected="true"] .ic { color: var(--green); }
@media (hover: hover) { #app .qf-row:hover { background: var(--card-hover); } }
#app .qf-empty { margin: 0; padding: 18px 16px; font-size: 13px; color: var(--muted); }

#app .qf-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 9px 16px; border-top: 1px solid var(--border-dim); font-size: 12px; line-height: 1.4; color: var(--faint); }
#app .qf-foot:empty { display: none; }
#app .qf-warn { color: var(--amber); }

/* Phone: the box sits at the top (the keyboard takes the bottom half); a row's supporting text goes under its title. */
@media (max-width: 640px) {
  #app .qf-dialog { margin-top: 12px; }
  #app .qf-list { max-height: calc(100dvh - 150px); }
  #app .qf-kbd { display: none; }
  #app .qf-text { flex-direction: column; align-items: flex-start; gap: 1px; }
  #app .qf-sub { max-width: 100%; }
}
```

- [ ] **Step 5: Register it**

In `src/main.js`:

(a) after `import * as tasks from './sections/tasks.js';` add

```js
import * as find from './sections/find.js';
```

(b) after the line `tasks.subscribe(() => window.ovwTasksChanged?.());` add

```js
// Quick find (⌘K, the sidebar's Find row, the phone's search button): part of the shell.
window.GeckoFind = find;
find.init();
```

- [ ] **Step 6: The sidebar's Find row**

(a) In `index.html`, in the sidebar markup, directly after `<nav class="sb-nav" aria-label="Main navigation">` and before `<div class="sb-nav-label">Home</div>`, add:

```html
      <button class="sb-link sb-find" type="button" data-find-open aria-keyshortcuts="Meta+K Control+K">
        <span class="ic"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><span class="lbl">Find</span><kbd data-find-kbd>⌘K</kbd>
      </button>
```

(b) In the one `.sidebar` CSS block near the top of `index.html`, directly after the rule `.sb-link .lbl { flex: 1; }`, add:

```css
/* Find (quick find, ⌘K): the first row, with its shortcut beside it. */
.sb-find kbd {
  padding: 2px 6px; border: 1px solid color-mix(in srgb, var(--sb-ink) 14%, transparent); border-radius: 6px;
  font: 500 11px/1.2 var(--font-mono); color: var(--faint);
}
:root[data-sidebar="collapsed"] .sb-find kbd { display: none; }
@media (pointer: coarse) { .sb-find kbd { display: none; } }
```

The row has no `data-section`, so `navTo` never marks it active. `.sb-nav-label:first-child` no longer matches "Home" (the Find row is first), which gives Home the same space above it as the other group labels: intended.

- [ ] **Step 7: The phone's search button**

(a) In `index.html`, in the top bar, directly after `<h2 id="topBarTitle">OVERVIEW</h2>`, add:

```html
      <button class="tb-find" type="button" data-find-open aria-label="Find"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
```

(b) In the CSS, directly after the line `.sb-toggle { display: none; }` (under the comment `/* — Mobile sidebar (slide-over) — */`), add:

```css
.tb-find { display: none; }
```

(c) Inside `@media (max-width: 880px) {`, directly after the `.sb-toggle { … }` rule there, add:

```css
  .tb-find {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px;
    background: var(--card); border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--white); cursor: pointer;
  }
```

(`.top-bar h2` has `flex: 1`, so the button sits at the right edge.)

- [ ] **Step 8: Run the tests**

Run: `node tests/find.mjs`
Expected: `find: all tests passed`

Run: `for t in tests/*.mjs; do node $t; done`
Expected: every script ends with `ok` / `passed` (`icons: ok` proves the new CSS uses no raw transition durations and no forbidden characters).

- [ ] **Step 9: Check it in the browser**

`node .claude/preview/build.mjs`, open the `hq-preview` preview (port 8803), signed in as Jack Morris. Each check is a click, a key press or a line to run in the page's console, with what must come back. `rows()` below means
`[...document.querySelectorAll('#qfDialog .qf-row')].map(r => r.querySelector('.qf-title').textContent)` and `groups()` means
`[...document.querySelectorAll('#qfDialog .qf-group')].map(g => g.textContent)`.

1. The sidebar's first row reads "Find" with "⌘K" (or "Ctrl K") beside it, in line with the other rows. Collapse the sidebar: the row shows its icon only, nothing overflows. Expand it again.
2. Press ⌘K (Ctrl+K). The box opens near the top with focus in the field; `groups()` → `["Actions"]`, `rows()` → `["Log time", "Add task", "Add a job"]`, and the foot says to type. Press ⌘K again: it closes. Open it again; press Esc: it closes. Click the backdrop: it closes.
3. Type `harb`. `groups()` includes `"Clients"`, `"People"` and `"Tasks"`; the first row is `Harbour Lane Architects` and it is selected (`document.querySelector('#qfDialog [aria-selected="true"] .qf-title').textContent`). No request was made for this (it filters what is held).
4. Press ↓ twice then ↑ once: the selection moves across groups, the field keeps the focus, and `document.getElementById('qfInput').getAttribute('aria-activedescendant')` names the selected row's id.
5. Press Enter on `Harbour Lane Architects`: the box closes and the client page for Harbour Lane Architects is showing.
6. Open, type `sam`, choose a People row: lands on that client's Details & contacts tab.
7. Open, type a word from a job's title in the preview data (run `window.__FAKE_DB.jobs.map(j => j.title + ' | ' + j.status)` to pick an open one), Enter on it: Jobs is showing with that job picked (`document.querySelector('#section-jobs .job-pinned')` exists). Do the same for a job whose status is `invoiced` or `lost` if there is one: it lands on that client's Jobs tab.
8. Open, type a word from an open deal's title (`window.__FAKE_DB.opportunities.map(o => o.title + ' | ' + o.status)`), Enter: Opportunities › Pipeline with that deal picked.
9. Open, type a prospect's company (`window.__FAKE_DB.prospects.map(p => p.company)`), Enter: Opportunities › Prospects, that card outlined in green and in view.
10. Open, type `ring sam`, Enter on the task: the task dialog opens for "Ring Sam about the Wi-Fi quote". Esc.
11. Open, type `licen`, Enter: Clients › Licences is showing. Open, type `month-end`, Enter: Overview › Month-end is showing (`document.querySelector('#section-overview [data-ovw-tab][aria-selected="true"]').textContent` contains `Month-end`).
12. Open, type `add task`, Enter: the Add task dialog opens. Esc. Open, type `add a job`, Enter: Jobs is showing with the new-job form open. Open, type `log time`, Enter on the action: Timesheets › Log time.
13. Open, type `inv-020`. After about a second `groups()` includes `"Invoices"`, with rows like `INV-0200`; each row's supporting text has the client, a date, a total and paid/due/overdue. Enter on one: that client's Invoices tab.
14. Open, type `mfa`. `groups()` includes `"Timesheet entries"` with "Reset MFA for new starter" rows showing client, date, engineer and hours. Enter on one: that client's Support hours tab.
15. Open, type `zzzz`. The list says `Nothing matches “zzzz”.` and nothing else. While the search is still waiting it must not say this (type quickly and watch: the foot says "Searching invoices and timesheet entries…" first).
16. Failure: run `window.__FAKE_FAIL = true`, reload the page is NOT needed; open the box (if it was opened less than five minutes ago, first run `location.reload()`, then set the flag again before opening). The foot names what was not searched (for example "Not searched: clients (Preview: simulated failure), …") and "Nothing matches" is not shown for an empty result; pages and actions still work (`licen` still finds Clients › Licences). Set `window.__FAKE_FAIL = false`.
17. ⌘K does nothing while the task dialog is open (open Add task, press ⌘K: only the task dialog is showing).
18. Typing in the box never loses focus or text when the page underneath redraws: open it, type `har`, run `ovwRenderAll()` in the console: the text and focus are unchanged.
19. Phone, 390 × 844: the top bar shows a search button at the right; tapping it opens the box at the top of the screen, full width; a row's supporting text sits under its title; nothing scrolls sideways (`document.documentElement.scrollWidth <= 390`); the field's computed `font-size` is `16px`. Open the slide-over menu and tap Find: the menu closes and the box opens. Set the viewport back to desktop.
20. Light and dark: `document.documentElement.setAttribute('data-theme', 'dark')` then `'light'`: the box, the selected row and the backdrop are legible in both. Leave it as it was.
21. The console has no errors other than the expected "Timesheets list not found in SharePoint site".

Take one screenshot of the open box with `harb` typed at desktop width and one at 390px, and look at them critically: rows aligned, nothing clipped, the selected row clearly marked.

If any check fails, fix the source, rebuild the preview and run the checks again. A fix that has to be made in a file from Task 1 or 2 is allowed; say so in the report.

- [ ] **Step 10: Commit**

```bash
git status --short   # nothing under .claude/ should be listed
git add src/sections/find.js tests/find.mjs src/styles/system.css src/main.js index.html
git commit -m "Quick find: the box (⌘K, the sidebar's Find row, the phone's search button)"
```

---

### Task 4: Hand-off notes

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Record it in CLAUDE.md**

Directly above the heading `## Ask Gecko HQ (built and removed 11 Oct 2026)`, add:

```markdown
## Quick find (from 12 Oct 2026)
- `src/sections/find.js` + `src/core/find.js` (tests `tests/find.mjs`), styles `system.css` "11 · Quick find"; design note
  `2026-10-12-quick-find-design.md`. One box for the whole app: ⌘K / Ctrl+K, the sidebar's Find row, the phone's top-bar
  search button (any element with `data-find-open`). A native `<dialog>`; `window.GeckoFind.open()`.
- Finds clients, people (contacts), jobs and deals, prospects, open tasks, pages and three actions (Log time, Add task, Add a
  job) from lists read once and filtered in the browser; invoices and timesheet entries are asked of the database as you type
  (from 3 characters, newest 50, 250ms after the last key). One rule: every word typed must start a word of the row.
- A new page or tab must be added to `PAGES` in `core/find.js` (the test fails if a listed one disappears, not if a new one
  is missing). A new action is one entry in `ACTIONS` plus its line in `openRow`.
- Opening a result uses `geckoGo` (which also switches Overview's tabs now) and the hooks `jobs.open(id)` / `jobs.add()`,
  `opportunities.open(id)` / `openProspect(id)`, `tasks.openTask(id)` / `newTask()`.
- Left out on purpose: recent items, typo tolerance, searching notes, activity or emails (reasons in the design note).

```

Also, in the "Shape of the code" section, the sidebar bullet begins `- Sidebar (Philip, 9 Oct, 8 entries; Analytics added under Home 10 Oct, so 9):`. Do not change the count (Find is not a page); add this sentence to the end of the "Sidebar look" paragraph of that bullet, after `do not add another override layer further down the file.`:

```
A Find row (quick find, ⌘K) sits above Home since 12 Oct; it is not a page.
```

- [ ] **Step 2: Run everything**

Run: `for t in tests/*.mjs; do node $t; done`
Expected: every script ends with `ok` / `passed`.

Run: `git status --short`
Expected: only `CLAUDE.md` modified; nothing under `.claude/`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: Quick find"
```

Do not push. The controller asks Jack what to do with the branch.
