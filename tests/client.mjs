import assert from 'node:assert/strict';
import { clientKey, sameClient, monthsTo, clientProfile } from '../src/core/client.js';

assert.equal(clientKey('Kingdom Products Ltd'), 'kingdomproducts');
assert.equal(clientKey('The Brazier Interiors Limited'), 'brazierinteriors');
assert.equal(clientKey('A & B (UK) Ltd'), 'aandb');
assert.ok(sameClient('Kingdom Products Ltd', 'Kingdom Products'));
assert.ok(sameClient('Access Instrumentation Ltd', 'Access Instrumentation'));
assert.ok(sameClient('Onsite Commercial Services', 'Onsite Commercial'), 'one name is the other plus more words');
assert.ok(!sameClient('ALS', 'ALS Locksmiths'), 'short names must match exactly');
assert.ok(!sameClient('MSA Safety', 'Daron Motors'));
assert.ok(!sameClient('', ''));
assert.deepEqual(monthsTo('2026-02', 3), ['2025-12', '2026-01', '2026-02']);

const today = '2026-10-08';
const invoices = [
  { contact_name: 'Kingdom Products Ltd', invoice_number: 'INV-1', invoice_date: '2026-09-01', due_date: '2026-09-15', status: 'PAID', sub_total: 189.82, amount_due: 0, repeating_invoice_id: 'r1' },
  { contact_name: 'Kingdom Products Ltd', invoice_number: 'INV-2', invoice_date: '2026-09-20', due_date: '2026-10-04', status: 'AUTHORISED', sub_total: 250, amount_due: 300, repeating_invoice_id: '' },
  { contact_name: 'Kingdom Products Ltd', invoice_number: 'INV-3', invoice_date: '2026-10-01', due_date: '2026-10-15', status: 'AUTHORISED', sub_total: 189.82, amount_due: 227.78, repeating_invoice_id: 'r1' },
  { contact_name: 'Kingdom Products Ltd', invoice_number: 'INV-4', invoice_date: '2026-10-02', status: 'VOIDED', sub_total: 99, amount_due: 0 },
  { contact_name: 'Someone Else', invoice_number: 'INV-9', invoice_date: '2026-10-01', status: 'AUTHORISED', sub_total: 5000, amount_due: 6000, due_date: '2026-09-01' }
];
const p = clientProfile({
  name: 'Kingdom Products',
  gecko: { status: 'Active' },
  invoices,
  services: [
    { client_name: 'Kingdom Products', title: 'VoIP + FTTP', category: 'other', sell_per_month: 112.6, cost_per_month: 82.6 },
    { client_name: 'Kingdom Products', title: 'IS + Backup', category: 'stack', sell_per_month: 43.5, cost_per_month: 8.14 },
    { client_name: 'Other', title: 'x', sell_per_month: 1000, cost_per_month: 0 }
  ],
  ssa: { purchased: 10, used: 8.5, remaining: 1.5, archived: false },
  entries: [
    { entry_date: '2026-10-01', hours: 1, engineer: 'Jack' },
    { entry_date: '2026-08-20', hours: 2, engineer: 'Philip' },
    { entry_date: '2026-10-02', hours: 10, engineer: 'System' },          // a credit, not work
    { entry_date: '2026-09-15', hours: 3, engineer: 'Jack', deleted_at: '2026-09-16' }
  ],
  jobs: [
    { client_name: 'Kingdom Products', title: 'Laptop', status: 'to_invoice', value: 600 },
    { client_name: 'Kingdom Products', title: 'Move', status: 'in_progress', value: 900, target_date: '2026-10-01' },
    { client_name: 'Kingdom Products', title: 'Old', status: 'invoiced', value: 100 },
    { client_name: 'Daron Motors', title: 'Firewall', status: 'to_invoice', value: 720 }
  ],
  opps: [{ client_name: 'Kingdom Products Ltd', title: 'Hornet', status: 'proposed', mrr: 30 }, { client_name: 'Kingdom Products', title: 'X', status: 'lost' }],
  dealer: [{ client_name: 'Kingdom Products', service: 'voxone', quantity: 4 }],
  domains: [{ client_name: 'Kingdom Products', domain: 'kingdom.example' }, { client_name: 'Kingdom Products', domain: 'kingdom.example' }]
}, today);

assert.deepEqual(p.xero.contacts, ['Kingdom Products Ltd']);
assert.equal(p.xero.history.length, 12);
assert.deepEqual(p.xero.history.at(-2), { month: '2026-09', recurring: 189.82, oneOff: 250, total: 439.82 });
assert.deepEqual(p.xero.history.at(-1), { month: '2026-10', recurring: 189.82, oneOff: 0, total: 189.82 }, 'voided not counted');
assert.equal(p.xero.recurringMonthly, 189.82);
assert.equal(p.xero.lastMonth.month, '2026-10', 'this month, once its repeating invoice is raised');
{
  const sept = clientProfile({ name: 'Kingdom Products', invoices: invoices.filter(i => i.invoice_number !== 'INV-3') }, today);
  assert.equal(sept.xero.lastMonth.month, '2026-09', 'not raised yet this month: last month');
  assert.equal(sept.xero.recurringMonthly, 189.82);
}
assert.equal(p.xero.year, 629.64);
assert.equal(p.xero.owed, 527.78);
assert.equal(p.xero.overdue, 300);
assert.deepEqual(p.xero.unpaid.map(i => i.invoice_number), ['INV-2', 'INV-3']);
assert.equal(p.xero.recent.length, 3, 'voided left out');
assert.equal(p.services.lines.length, 2);
assert.equal(p.services.sell, 156.1);
assert.equal(p.services.margin, 65.36);
assert.ok(Math.abs(p.services.pct - 65.36 / 156.1) < 1e-9);
assert.equal(p.support.last90, 3, 'work only: credits and deleted entries left out');
assert.equal(p.support.monthsLeft, 1.5, '1.5h left at 1h a month');
assert.deepEqual(p.support.perMonth.map(m => m.hours), [0, 0, 0, 2, 0, 1]);
assert.equal(p.support.recent.length, 3, 'deleted entry left out');
assert.equal(p.jobs.length, 3);
assert.equal(p.openJobs.length, 2);
assert.equal(p.openOpps.length, 1, 'name variant matched; lost left out');
assert.deepEqual(p.domains, ['kingdom.example']);
assert.equal(p.dealer.length, 1);
assert.deepEqual(p.flags.map(f => [f.level, f.tab]), [['red', 'invoices'], ['amber', 'support'], ['amber', 'jobs'], ['amber', 'jobs'], ['info', 'opportunities']]);
assert.equal(p.flags[0].text, '£300.00 overdue');

const empty = clientProfile({ name: 'New Co' }, today);
assert.equal(empty.xero, null, 'not loaded is null, never zero');
assert.equal(empty.services, null);
assert.equal(empty.support, null);
assert.deepEqual(empty.flags, []);
const noWork = clientProfile({ name: 'New Co', ssa: { remaining: 5 }, entries: [] }, today);
assert.equal(noWork.support.monthsLeft, null, 'no recent work: no estimate');

console.log('client: ok');
