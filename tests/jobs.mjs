import assert from 'node:assert/strict';
import { stageTotals, monthSales, salesHistory, previousMonth, STAGES } from '../src/core/jobs.js';

assert.equal(previousMonth('2026-01'), '2025-12');
assert.equal(previousMonth('2026-10'), '2026-09');

const jobs = [
  { status: 'quoted', value: 1200 },
  { status: 'in_progress', value: 800, target_date: '2026-10-20' },
  { status: 'in_progress', value: 500, target_date: '2026-11-05' },
  { status: 'agreed', value: null, target_date: '2026-10-30' },
  { status: 'to_invoice', value: 350.5 },
  { status: 'invoiced', value: 99 },
  { status: 'bogus', value: 1 }
];
const t = stageTotals(jobs);
assert.equal(Object.keys(t).length, STAGES.length);
assert.deepEqual(t.in_progress, { count: 2, value: 1300 });
assert.deepEqual(t.agreed, { count: 1, value: 0 }, 'no value yet counts as £0');

const feed = { xero: {
  months: {
    '2026-09': { 'A Ltd': 100, 'B Ltd': 200, 'C Ltd': 50, 'Voip Unlimited': 638.36 },
    '2026-10': { 'A Ltd': 150, 'D Ltd': 1000, 'Voip Unlimited': 600 }
  },
  recurring: {
    '2026-09': { 'A Ltd': 100, 'B Ltd': 200, 'Voip Unlimited': 638.36 },
    '2026-10': { 'A Ltd': 100 }
  }
} };
const s = monthSales(feed, jobs, { month: '2026-10' });
assert.equal(s.invoiced, 1150, 'dealer commission is not client sales');
assert.equal(s.other, 600);
assert.equal(s.recurring, 100);
assert.equal(s.oneOff, 1050);
assert.deepEqual(s.rows[0], { name: 'D Ltd', total: 1000, recurring: 0, oneOff: 1000 });
assert.deepEqual(s.recurringToCome, [{ name: 'B Ltd', amount: 200 }], 'B billed by repeating invoice last month, not yet this month');
assert.equal(s.toInvoice, 350.5);
assert.equal(s.dueThisMonth, 800, 'only agreed/in-progress jobs targeted this month');
assert.equal(s.projected, 1150 + 200 + 350.5 + 800);

const empty = monthSales({}, [], { month: '2026-10' });
assert.equal(empty.hasXero, false);
assert.equal(empty.projected, 0);

const h = salesHistory(feed, { month: '2026-10', n: 3 });
assert.deepEqual(h.map(x => x.month), ['2026-08', '2026-09', '2026-10']);
assert.equal(h[0].has, false);
assert.deepEqual(h[1], { month: '2026-09', total: 350, recurring: 300, oneOff: 50, has: true });

console.log('jobs: ok');
