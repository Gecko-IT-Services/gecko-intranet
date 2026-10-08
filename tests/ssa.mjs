import assert from 'node:assert/strict';
import { ssaBoard, runwayText, filterRows } from '../src/core/ssa.js';

const today = '2026-10-08';
const clients = [
  { id: '1', name: 'Steady', hoursPurchased: 20, hoursUsed: 8, hoursRemaining: 12 },
  { id: '2', name: 'Busy', hoursPurchased: 10, hoursUsed: 7.5, hoursRemaining: 2.5 },
  { id: '3', name: 'Over', hoursPurchased: 5, hoursUsed: 5.5, hoursRemaining: -0.5 },
  { id: '4', name: 'Idle', hoursPurchased: 10, hoursUsed: 1, hoursRemaining: 9 },
  { id: '5', name: 'Gone', hoursPurchased: 10, hoursUsed: 1, hoursRemaining: 9, archived: true },
  { id: '6', name: 'No SSA', hoursPurchased: 0, hoursUsed: 3, hoursRemaining: -3 }
];
const entries = [
  { clientName: 'Steady', engineer: 'Jack', date: '2026-09-15', hours: 1.5 },
  { clientName: 'Steady', engineer: 'Philip', date: '2026-08-20', hours: 1.5 },
  { clientName: 'Busy', engineer: 'Jack', date: '2026-10-01', hours: 4 },
  { clientName: 'Busy', engineer: 'Jack', date: '2026-09-10', hours: 5 },
  { clientName: 'Busy', engineer: 'System', date: '2026-09-11', hours: -10 },      // a renewal credit is not work
  { clientName: 'Busy', engineer: 'Philip', date: '2026-05-01', hours: 3 },        // older than 90 days
  { clientName: 'Over', engineer: 'Jack', date: '2026-10-07', hours: 0.5 },
  { clientName: 'Idle', engineer: 'Jack', date: '2026-03-01', hours: 1 }
];
const b = ssaBoard(clients, entries, today);
assert.deepEqual(b.rows.map(r => [r.name, r.status]), [['Over', 'over'], ['Busy', 'renew'], ['Steady', 'ok'], ['Idle', 'quiet']],
  'archived and no-SSA clients are left out; most urgent first');
const busy = b.rows.find(r => r.name === 'Busy');
assert.equal(busy.last90, 9);
assert.equal(busy.perMonth, 3);
assert.equal(busy.runway, 0.8, '2.5h left at 3h a month: under a month, renew');
assert.equal(busy.runsOut, '2026-11-02');
assert.equal(busy.lastDate, '2026-10-01');
assert.equal(busy.lastBy, 'Jack');
assert.deepEqual(busy.byMonth.map(m => m.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
assert.deepEqual(busy.byMonth.map(m => m.hours), [3, 0, 0, 0, 5, 4], 'credits excluded from use');
const steady = b.rows.find(r => r.name === 'Steady');
assert.equal(steady.perMonth, 1);
assert.equal(steady.runway, 12);
assert.equal(steady.pctLeft, 0.6);
assert.equal(b.rows.find(r => r.name === 'Over').runsOut, null, 'already over: no date');
assert.equal(b.rows.find(r => r.name === 'Idle').runway, null);
assert.deepEqual(b.totals, { clients: 4, remaining: 23.5, overBy: 0.5, attention: 2, low: 0, last90: 12.5, perMonth: 4.17 });

// low: under 20% left or under two months at this pace
assert.equal(ssaBoard([{ id: 'x', name: 'L', hoursPurchased: 20, hoursRemaining: 3.5 }], [], today).rows[0].status, 'low');
assert.equal(ssaBoard([{ id: 'x', name: 'L', hoursPurchased: 10, hoursRemaining: 5 }], [{ clientName: 'L', engineer: 'Jack', date: '2026-09-20', hours: 9 }], today).rows[0].status, 'low');

assert.equal(runwayText(null), '');
assert.equal(runwayText(12), 'about 12 months');
assert.equal(runwayText(1), 'about a month');
assert.equal(runwayText(0.5), 'about 2 weeks');
assert.equal(runwayText(0.1), 'under a week');

assert.deepEqual(filterRows(b.rows, { view: 'attention' }).map(r => r.name), ['Over', 'Busy']);
assert.deepEqual(filterRows(b.rows, { q: 'st' }).map(r => r.name), ['Steady']);

console.log('ssa: all tests passed');
