import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGES, ACTIONS, PER_GROUP, words, matchLevel, clientNames, search, remoteWords, remoteReady, remoteFilters, invoiceState, invoiceRows, entryRows } from '../src/core/find.js';

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
assert.equal(search(index, 'job', today).some(x => x.key === 'jobs'), false, 'the words "job" and "deal" in a row\'s supporting text are not searched');
assert.equal(search(index, 'proposed', today).some(x => x.key === 'jobs'), false, 'nor is the stage');
assert.deepEqual(search({ tasks: [{ id: 1, title: 'No date', client_name: '', assigned_to: 'Jack', due_on: null, done_at: null }] }, 'date', today)[0].rows[0].sub, 'Jack', 'a task with no date shows no date, never NaN');

// What is sent to the database
assert.deepEqual(remoteWords('  INV-0131, (harbour) 50% _x_ '), ['inv', '0131', 'harbour', '50'], 'split as words() splits; four at most');
assert.deepEqual(remoteWords('a b c d e f'), ['a', 'b', 'c', 'd']);
assert.deepEqual(remoteWords('- -- %'), []);
assert.equal(remoteWords('x'.repeat(100))[0].length, 40, 'a word is cut to 40 characters');
assert.equal(remoteReady('ha'), false);
assert.equal(remoteReady('har'), true);
assert.equal(remoteReady('13'), true, 'two digits are enough for an invoice number');
assert.equal(remoteReady('a b'), false);
assert.equal(remoteReady('%%%'), false);
assert.equal(remoteReady('ab cd'), false, 'one word must be long enough, not the words added together');
assert.equal(remoteReady('a--'), false, 'hyphens do not count');
assert.equal(remoteReady('1 3'), false);
assert.deepEqual(remoteFilters('inv-0131'), {
  invoices: ['invoice_number.ilike.%inv%,contact_name.ilike.%inv%,reference.ilike.%inv%', 'invoice_number.ilike.%0131%,contact_name.ilike.%0131%,reference.ilike.%0131%'],
  entries: ['title.ilike.%inv%,work_description.ilike.%inv%', 'title.ilike.%0131%,work_description.ilike.%0131%']
}, 'one OR filter per word');
assert.deepEqual(remoteFilters(''), { invoices: [], entries: [] });
for (const w of remoteWords('a%b_c,(d)\'e"f\\g*h:i;j.k')) assert.match(w, /^[\p{L}\p{N}]+$/u, 'nothing typed can change a filter');

// A task ticked a moment ago (done_at not yet set) is not open
assert.deepEqual(search({ tasks: [{ id: 1, title: 'Ticked just now', done_at: null, _done: true }, { id: 2, title: 'Ticked later', done_at: null }] }, 'ticked', today)[0].rows.map(r => r.title), ['Ticked later']);

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
assert.deepEqual(invoiceRows([{ invoice_number: null, contact_name: 'Technix', reference: null, invoice_date: '2026-10-01', status: 'DRAFT', total: 1, amount_due: 1 }], 'null', today), [], 'an empty field is not the word "null"');

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
assert.deepEqual(entryRows([{ client_id: 1, engineer: 'Jack', entry_date: '2026-10-08', hours: 1, title: 'Onsite', work_description: null, deleted_at: null }], 'null', byId), [], 'an empty field is not the word "null"');

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
{   // every hub tab that has a label is a page: a tab added to HUBS must be added to PAGES
  const hubs = html.match(/const HUBS = \{([\s\S]*?)\n\};/)[1];
  const labelled = [...hubs.matchAll(/\['([a-z]+)', '([^']+)'\]/g)].map(m => m[1]);
  assert.ok(labelled.length >= 8, 'the HUBS literal was read');
  for (const key of labelled) assert.ok(PAGES.some(p => p.open.section === key), `hub tab "${key}" is not in PAGES`);
}

// The ways in that quick find calls exist (each does what a click on the thing already does)
{
  const { ICONS } = await import('../src/core/icons.js');
  for (const name of ['search', 'building', 'user', 'briefcase', 'file', 'clock', 'check', 'right', 'plus']) assert.ok(ICONS[name], `icon "${name}" exists`);
  const tasks = await import('../src/sections/tasks.js'), jobs = await import('../src/sections/jobs.js'), opps = await import('../src/sections/opportunities.js');
  for (const [mod, fn] of [[tasks, 'openTask'], [tasks, 'newTask'], [jobs, 'open'], [jobs, 'add'], [opps, 'open'], [opps, 'openProspect']]) assert.equal(typeof mod[fn], 'function', `${fn} is exported`);
  assert.ok(/else if \(section === 'overview'/.test(html), 'geckoGo switches Overview tabs');
}

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

// Commands (docs/commands.md boxes) are found by the command or by what it does, and open on their box.
{
  const commands = [
    { code: 'ipconfig /flushdns', about: 'Clears the DNS cache.', heading: 'Network', n: 2 },
    { code: 'manage-bde -status', about: 'Shows whether each drive is encrypted.', heading: 'BitLocker', n: 9 }
  ];
  const rows = q => search({ commands }, q, today).find(x => x.key === 'commands')?.rows || [];
  assert.deepEqual(rows('flushdns'), [{ title: 'ipconfig /flushdns', sub: 'Clears the DNS cache.', open: { kind: 'command', n: 2 } }]);
  assert.equal(rows('dns cache')[0].title, 'ipconfig /flushdns', 'found by what it does');
  assert.equal(rows('bitlocker')[0].title, 'manage-bde -status', 'found by its heading');
  assert.deepEqual(rows('harbour'), []);
}

console.log('find: all tests passed');
