import assert from 'node:assert/strict';
import { money, attention, thisWeek, weekOf, addDays, shortRange } from '../src/core/overview.js';

const today = '2026-10-08';   // a Thursday
const now = new Date('2026-10-08T12:00:00Z');

assert.deepEqual(weekOf(today), { start: '2026-10-05', end: '2026-10-11' });
assert.deepEqual(weekOf('2026-10-11'), { start: '2026-10-05', end: '2026-10-11' }, 'Sunday belongs to the week before it');
assert.equal(addDays('2026-10-30', 3), '2026-11-02');
assert.equal(shortRange('2026-10-12', '2026-10-14'), '12–14 Oct');
assert.equal(shortRange('2026-10-30', '2026-11-02'), '30 Oct – 2 Nov');
assert.equal(shortRange('2026-10-12', '2026-10-12'), '12 Oct');

const inv = [
  // September: one recurring, one one-off
  { invoice_number: 'INV-1', contact_name: 'A Ltd', invoice_date: '2026-09-01', due_date: '2026-09-15', status: 'PAID', sub_total: 100, amount_due: 0, repeating_invoice_id: 'r1' },
  { invoice_number: 'INV-2', contact_name: 'B Ltd', invoice_date: '2026-09-10', due_date: '2026-09-24', status: 'AUTHORISED', sub_total: 50, amount_due: 60, repeating_invoice_id: '' },
  // October: recurring raised, a job's invoice, a draft
  { invoice_number: 'INV-3', contact_name: 'A Ltd', invoice_date: '2026-10-01', due_date: '2026-10-15', status: 'AUTHORISED', sub_total: 120, amount_due: 144, repeating_invoice_id: 'r1' },
  { invoice_number: 'INV-4', contact_name: 'C Ltd', invoice_date: '2026-10-02', due_date: '2026-10-16', status: 'AUTHORISED', sub_total: 500, amount_due: 600, repeating_invoice_id: '' },
  { invoice_number: 'INV-5', contact_name: 'D Ltd', invoice_date: '2026-10-07', due_date: '2026-10-21', status: 'DRAFT', sub_total: 80, amount_due: 96, repeating_invoice_id: '' },
  // Dealer commission never counts as sales
  { invoice_number: 'INV-6', contact_name: 'Voip Unlimited', invoice_date: '2026-10-03', status: 'PAID', sub_total: 600, amount_due: 0, repeating_invoice_id: 'r9' }
];
const rep = [
  { contact_name: 'E Ltd', status: 'AUTHORISED', period: 1, unit: 'MONTHLY', next_date: '2026-10-12', sub_total: 200 },
  { contact_name: 'F Ltd', status: 'AUTHORISED', period: 1, unit: 'MONTHLY', next_date: '2026-10-28', sub_total: 40 }
];
const jobs = [
  { client_name: 'C Ltd', title: 'Server', status: 'invoiced', value: 500, invoice_ref: 'INV-4' },
  { client_name: 'G Ltd', title: 'Laptops', status: 'to_invoice', value: 900, invoice_ref: '' },
  { client_name: 'H Ltd', title: 'Move', status: 'in_progress', value: 1500, target_date: '2026-10-03' },
  { client_name: 'J Ltd', title: 'Wi-Fi', status: 'agreed', value: 600, target_date: '2026-10-10' },
  { client_name: 'K Ltd', title: 'Quote', status: 'quoted', value: 2000 },
  { client_name: 'L Ltd', title: 'Paid by its invoice', status: 'to_invoice', value: 120, invoice_ref: 'INV-3' }
];
const opps = [
  { client_name: 'A Ltd', title: 'VoxOne', status: 'proposed', mrr: 40, one_off: 0, modified_at: '2026-09-01T10:00:00Z' },
  { client_name: 'B Ltd', title: 'Backup', status: 'proposed', mrr: 10, one_off: 100, modified_at: '2026-10-07T10:00:00Z' },
  { client_name: 'C Ltd', title: 'Idea', status: 'idea', mrr: 99 }
];

// ── money ──
const m = money({ inv, rep, jobs, opps }, today);
assert.equal(m.sales.invoiced, 620, 'Oct approved invoices, dealer commission excluded');
assert.equal(m.sales.toCome, 240);
assert.equal(m.recurring.raised, 120);
assert.equal(m.recurring.value, 360, 'raised + still to come this month');
assert.equal(m.recurring.last, 100);
assert.equal(m.recurring.lastMonth, '2026-09');
assert.equal(m.recurring.change, 260);
assert.equal(m.owed.total, 804, 'amount due incl. VAT, approved only');
assert.equal(m.owed.overdue, 60);
assert.equal(m.pipeline.count, 5, 'quoted → to invoice');
assert.equal(m.pipeline.value, 5120);
assert.equal(m.pipeline.quoted, 2000);
assert.equal(m.pipeline.proposals, 2);
assert.equal(m.pipeline.proposalMrr, 50);
assert.equal(m.pipeline.proposalOneOff, 100);
assert.equal(money({ inv: [], rep: [], jobs: [], opps: [] }, today).recurring.change, null, 'no last month → no comparison');

// ── attention ──
const ssa = [
  { name: 'Low Ltd', remaining: 1.5, archived: false },
  { name: 'Out Ltd', remaining: -0.25, archived: false },
  { name: 'Fine Ltd', remaining: 9, archived: false },
  { name: 'Gone Ltd', remaining: 0, archived: true }
];
const leave = [
  { person: 'Jack', start: '2026-10-12', end: '2026-10-13', status: 'Pending', type: 'Annual Leave' },
  { person: 'Philip', start: '2026-10-08', end: '2026-10-09', status: 'Approved', type: 'Annual Leave' },
  { person: 'Jack', start: '2026-09-01', end: '2026-09-02', status: 'Pending', type: 'Annual Leave' },
  { person: 'Jack', start: '2026-11-20', end: '2026-11-20', status: 'Approved', type: 'Annual Leave' }
];
const journeys = [
  { date: '2026-09-20', amount: 22.5, claimedDate: '' },
  { date: '2026-09-21', amount: 10, claimedDate: '2026-10-01' },
  { date: '2026-10-02', amount: 5, claimedDate: '' }
];
const xero = { connected: true, last_sync_ok: true, last_sync_at: '2026-10-08T11:17:00Z' };
const a = attention({ xero, inv, rep, jobs, opps, ssa, leave, journeys }, today, now);
const by = Object.fromEntries(a.map(x => [x.key, x]));
assert.deepEqual(a.map(x => x.level), [...a.map(x => x.level)].sort((p, q) => ['red', 'amber', 'info'].indexOf(p) - ['red', 'amber', 'info'].indexOf(q)), 'most urgent first');
assert.ok(!by.xero, 'a sync within the hour is fine');
assert.equal(by.overdue.level, 'red');
assert.equal(by.overdue.title, '£60.00 overdue');
assert.match(by.overdue.detail, /^1 invoice · B Ltd £60\.00$/);
assert.deepEqual(by.overdue.go, { section: 'jobs', tab: 'owed' });
assert.equal(by.drafts.title, '1 draft invoice waiting in Xero');
assert.equal(by.to_invoice.title, '1 job ready to invoice · £900.00', 'a job its approved invoice covers is not counted');
assert.equal(by.late_jobs.title, '1 job past its target date');
assert.match(by.late_jobs.detail, /H Ltd: Move/);
assert.equal(by.ssa.level, 'red', 'a client out of hours is red');
assert.match(by.ssa.detail, /^Out Ltd -0\.25h, Low Ltd 1\.5h\./, 'emptiest first, archived left out');
assert.equal(by.leave.title, '1 leave request to approve', 'past pending requests are not counted');
assert.match(by.leave.detail, /Jack 12–13 Oct/);
assert.equal(by.mileage.title, '£22.50 mileage not yet claimed', 'claimed and this month left out');
assert.equal(by.mileage.level, 'info');
assert.equal(by.proposals.title, '1 proposal with no update for 14 days');

assert.equal(attention({ xero: { connected: false } }, today, now)[0].title, 'Xero isn’t connected');
assert.equal(attention({ xero: { connected: true, last_sync_ok: false, last_error: 'Token expired' } }, today, now)[0].detail, 'Token expired');
assert.equal(attention({ xero: { connected: true, last_sync_ok: true, last_sync_at: '2026-10-08T07:00:00Z' } }, today, now)[0].title, 'Xero last synced 5 hours ago');
assert.deepEqual(attention({}, today, now), [], 'sources that did not load add nothing');
// Without Xero, "to invoice" is every job at that stage at its full value.
assert.equal(attention({ jobs }, today, now).find(x => x.key === 'to_invoice').title, '2 jobs ready to invoice · £1,020.00');

// ── this week ──
const entries = [
  { engineer: 'Philip', date: '2026-10-05', hours: 2.5 },
  { engineer: 'Jack', date: '2026-10-08', hours: 1.25 },
  { engineer: 'Jack', date: '2026-10-04', hours: 9 },     // last week
  { engineer: 'System', date: '2026-10-06', hours: 10 }   // SSA credit, not work
];
const w = thisWeek({ leave, jobs, inv, rep, entries }, today);
assert.deepEqual(w.hours, { total: 3.75, byEng: { Philip: 2.5, Jack: 1.25 } });
assert.deepEqual(w.away.map(l => [l.person, l.now]), [['Philip', true], ['Jack', false]], 'today → two weeks ahead, soonest first');
assert.deepEqual(w.jobsDue.map(j => j.client_name), ['H Ltd', 'J Ltd'], 'late or due by Sunday');
assert.deepEqual(w.goingOut, { count: 1, value: 200, list: [{ name: 'E Ltd', amount: 200, date: '2026-10-12', reference: '' }] });
assert.equal(thisWeek({ entries }, today).goingOut, null, 'unknown without Xero');
// The seven days can cross into next month.
const late = thisWeek({ inv, rep: [{ contact_name: 'N Ltd', status: 'AUTHORISED', period: 1, unit: 'MONTHLY', next_date: '2026-11-02', sub_total: 75 }] }, '2026-10-29');
assert.equal(late.goingOut.value, 75);

console.log('overview: all tests passed');
