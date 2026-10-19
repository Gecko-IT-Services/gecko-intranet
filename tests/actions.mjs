import assert from 'node:assert/strict';
import { nextActions, valueText, CHASE_DAYS } from '../src/core/actions.js';

const today = '2026-10-19';
const products = [{ key: 'email_security', name: 'Hornetsecurity 365 Total Protection', active: true, default_mrr: 30 },
  { key: 'keeper', name: 'Keeper password manager', active: true, default_mrr: null }, { key: 'windows11', name: 'Windows 11 upgrade / PC refresh', default_one_off: 650 }];
const a = nextActions({ today, products,
  devices: [{ level: 'red', agent: 1, customer: 'Daron Motors', machine: 'FIPC', user: 'Kelly', server: false }, { level: 'amber', agent: 2, customer: 'X', machine: 'LAPTOP' }],
  coverage: [{ client: 'Daron Ford Motors', what: 'DCSERVER', text: 'Domain Controller in Atera with no Acronis backup' }],
  reconcile: { clients: [
    { name: 'Snowskool', own: false, rows: [{ product: 'av', state: 'leak', gapGbp: 4.6, text: '2 more in use than billed' }, { product: 'dns', state: 'over', gapGbp: 2 }] },
    { name: 'Gecko IT', own: true, rows: [{ product: 'av', state: 'unbilled', gapGbp: 9 }] },
    { name: 'Regals', own: false, rows: [], belowCost: true, margin: -3.5 }] },
  overdue: [{ contact_name: 'CDA Ltd', status: 'AUTHORISED', amount_due: 240, due_date: '2026-09-30' }, { contact_name: 'CDA Ltd', status: 'AUTHORISED', amount_due: 60, due_date: '2026-10-10' },
    { contact_name: 'MSA', status: 'AUTHORISED', amount_due: 99, due_date: '2026-10-25' }, { contact_name: 'MSA', status: 'PAID', amount_due: 0, due_date: '2026-09-01' }],
  opps: [{ id: 31, client_name: 'Cowan Consultancy', product_key: 'email_security', title: 'Hornetsecurity 365 Total Protection — Cowan Consultancy', status: 'proposed', mrr: 112.5, modified_at: '2026-10-05T10:00:00Z' },
    { id: 32, client_name: 'Cowan Consultancy', product_key: 'keeper', title: 'Keeper', status: 'proposed', mrr: 0, modified_at: '2026-10-18T10:00:00Z' },
    { id: 33, client_name: 'Freeston', product_key: null, title: 'Server move', status: 'proposed', one_off: 900, modified_at: '2026-10-18T10:00:00Z', follow_up_on: '2026-10-19' }],
  ssa: [{ name: 'Technix', remaining: 1.5 }, { name: 'Old Co', remaining: 0, archived: true }, { name: 'Fine Ltd', remaining: 9 }],
  insights: [{ client_name: 'Freeston', data: { themes: [{ theme: 'Suspicious emails', product_key: 'email_security', jobs: 6, hours: 4.5 }, { theme: 'Printers', product_key: null, jobs: 3, hours: 1 }] } },
    { client_name: 'Cowan Consultancy', data: { themes: [{ theme: 'Phishing', product_key: 'email_security', jobs: 4, hours: 2 }] } }],
  upgrades: [{ name: 'West Country Fires', devices: [{ plan: 'replace' }, { plan: 'replace' }, { plan: 'upgrade' }, { plan: 'office' }] }, { name: 'Gecko IT', own: true, devices: [{ plan: 'replace' }] }]
});
assert.deepEqual(a.map(x => [x.kind, x.client, valueText(x.value)]), [
  ['down', 'Daron Motors', ''],
  ['cover', 'Daron Ford Motors', ''],
  ['chase', 'Cowan Consultancy', '£112.50 a month'],
  ['windows', 'West Country Fires', '£1,300 one-off'],
  ['chase', 'Freeston', '£900 one-off'],
  ['ssa', 'Technix', '£650 one-off'],
  ['owed', 'CDA Ltd', '£300 owed'],
  ['evidence', 'Freeston', '£30 a month'],
  ['leak', 'Snowskool', '£4.60 a month'],
  ['below', 'Regals', '£3.50 a month']
], 'protect first; then money by year-equivalent value (£112.50 a month = £1,350; owed counts 1.5×)');
const by = k => a.find(x => x.key === k);
assert.equal(by('chase:31').title, 'Chase Hornetsecurity 365 Total Protection with Cowan Consultancy');
assert.equal(by('chase:31').why, 'Proposed, nothing since 14 days ago.');
assert.equal(by('chase:31').go, 'client:advice:Cowan Consultancy');
assert.equal(by('chase:32'), undefined, `proposed yesterday: not yet (${CHASE_DAYS} days)`);
assert.equal(by('chase:33').why, 'Follow-up due today.');
assert.equal(by('owed:CDA Ltd').why, 'Oldest due 19 days ago. Nudge drafts a friendly reminder.');
assert.equal(by('owed:MSA'), undefined, 'not due yet, or paid');
assert.equal(by('evidence:Cowan Consultancy:email_security'), undefined, 'already in the pipeline');
assert.equal(by('leak:Snowskool:av').title, 'Bill Snowskool: Antivirus');
assert.equal(a.some(x => x.client === 'Gecko IT'), false, 'Gecko’s own never');
assert.equal(by('win:West Country Fires').why, '2 PCs too old for Windows 11; 1 PC can upgrade free: no security updates now.');
// Several clients with old PCs: one line, mid-list; unpriced deals ranked by the catalogue's usual value, never shown as a price.
const many = nextActions({ today, products: [{ key: 'keeper', name: 'Keeper', default_mrr: 40 }],
  upgrades: [{ name: 'Technix', devices: Array(9).fill({ plan: 'replace' }) }, { name: 'Onsite', devices: [...Array(6).fill({ plan: 'replace' }), { plan: 'upgrade' }] }, { name: 'Wired', devices: [{ plan: 'replace' }] }],
  opps: [{ id: 1, client_name: 'Snowskool', product_key: 'keeper', title: 'Keeper', status: 'proposed', mrr: 0, modified_at: '2026-10-08' },
    { id: 2, client_name: 'Solent', product_key: null, title: 'Exclaimer', status: 'proposed', mrr: 0, modified_at: '2026-10-08' }],
  overdue: [{ contact_name: 'Brazier', status: 'AUTHORISED', amount_due: 68.4, due_date: '2026-06-26' }] });
assert.deepEqual(many.map(x => [x.key, valueText(x.value)]), [['win:all', ''], ['chase:1', ''], ['chase:2', ''], ['owed:Brazier', '£68.40 owed']]);
assert.equal(many[0].why, '17 PCs can’t get Windows security updates; most at Technix (9), Onsite (7), Wired (1).');
assert.equal(many[0].go, 'upgrades');
assert.equal(by('down:1').title, 'FIPC isn’t on this morning');
assert.deepEqual(nextActions({ today }), [], 'no sources, nothing');
assert.equal(valueText({ gbp: 1240, per: 'owed' }), '£1,240 owed');
// Dates that come round: a billed domain about to lapse is protect; nearer renewals rank higher.
const dated = nextActions({ today, dates: [
  { key: 'renewal:r1', kind: 'renewal', group: 'money', client: 'CDA Ltd', title: 'Web Hosting renews for CDA Ltd', why: '', value: { gbp: 174, per: 'once' }, days: 43, go: 'client:advice:CDA Ltd' },
  { key: 'renewal:r2', kind: 'renewal', group: 'money', client: 'ALS', title: 'Web Hosting renews for ALS', why: '', value: { gbp: 174, per: 'once' }, days: 10, go: 'client:advice:ALS' },
  { key: 'domain:x', kind: 'domain', group: 'protect', client: 'LS', title: 'Renew lscommercials.co.uk', why: '', value: null, days: 47, go: 'client:contacts:LS' }] });
assert.deepEqual(dated.map(x => [x.key, x.group]), [['date:domain:x', 'protect'], ['date:renewal:r2', 'money'], ['date:renewal:r1', 'money']]);
console.log('actions: ok');
