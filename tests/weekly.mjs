import assert from 'node:assert/strict';
import { weekSummary, trend, weekLabel, monday } from '../src/core/weekly.js';

const today = '2026-10-08';   // Thursday
const entries = [
  { id: 1, clientName: 'Technix', engineer: 'Jack', date: '2026-10-05', hours: 2, workType: 'Remote Support', workDescription: 'VPN' },
  { id: 2, clientName: 'Technix', engineer: 'Philip', date: '2026-10-05', hours: 1, workType: 'Remote Support', description: 'Call' },
  { id: 3, clientName: 'Kingdom Products', engineer: 'Jack', date: '2026-10-07', hours: 1.5, workType: 'Onsite Support', workDescription: 'Printer' },
  { id: 4, clientName: 'Kingdom Products', engineer: 'System', date: '2026-10-07', hours: -10, workType: '', workDescription: 'Credit' },
  { id: 5, clientName: 'Technix', engineer: 'Jack', date: '2026-10-11', hours: 0.5, workType: 'Maintenance', workDescription: 'Patching' },   // Sunday
  { id: 6, clientName: 'Technix', engineer: 'Jack', date: '2026-09-29', hours: 3, workType: 'Remote Support' },                              // last week
  { id: 7, clientName: 'Technix', engineer: 'Jack', date: '2026-10-12', hours: 1, workType: 'Remote Support' }                               // next week
];

assert.equal(monday('2026-10-11'), '2026-10-05');
const w = weekSummary(entries, '2026-10-07', today);
assert.equal(w.start, '2026-10-05');
assert.equal(w.end, '2026-10-11');
assert.equal(w.isCurrent, true);
assert.equal(w.total, 5, 'System credit not counted');
assert.equal(w.prevTotal, 3);
assert.equal(w.change, 2);
assert.deepEqual(w.byEng, { Philip: 1, Jack: 4 });
assert.deepEqual(w.days.map(d => d.total), [3, 0, 1.5, 0, 0, 0, 0.5]);
assert.deepEqual(w.days[0].byEng, { Philip: 1, Jack: 2 });
assert.equal(w.days[4].future, true);
assert.equal(w.days[6].weekend, true);
assert.deepEqual(w.clients.map(c => [c.name, c.hours, c.entries]), [['Technix', 3.5, 3], ['Kingdom Products', 1.5, 1]]);
assert.deepEqual(w.clients[0].byEng, { Jack: 2.5, Philip: 1 });
assert.deepEqual(w.types.map(t => [t.name, t.hours]), [['Remote Support', 3], ['Onsite Support', 1.5], ['Maintenance', 0.5]]);
assert.deepEqual(w.gaps, [
  { engineer: 'Philip', date: '2026-10-06' }, { engineer: 'Philip', date: '2026-10-07' }, { engineer: 'Philip', date: '2026-10-08' },
  { engineer: 'Jack', date: '2026-10-06' }, { engineer: 'Jack', date: '2026-10-08' }
], 'weekdays up to today with nothing logged; weekends and future days are not gaps');
assert.deepEqual(w.entries.map(e => e.id), [1, 2, 3, 5], 'by date, then engineer; credits left out');
assert.equal(w.entries[0].description, 'VPN');
assert.equal(w.entries[1].description, 'Call', 'Title when there is no work description');

assert.deepEqual(weekSummary([{ clientName: 'A', engineer: 'Jack', date: today, hours: 1 }], today, today).types.map(t => t.name), ['No work type']);
const past = weekSummary(entries, '2026-09-29', today);
assert.equal(past.isCurrent, false);
assert.equal(past.total, 3);
assert.equal(past.gaps.length, 9, 'Jack logged Tuesday only; Philip nothing all week');

assert.deepEqual(trend(entries, '2026-10-05', today, 3), [
  { start: '2026-09-21', total: 0, current: false },
  { start: '2026-09-28', total: 3, current: false },
  { start: '2026-10-05', total: 5, current: true }
]);

assert.equal(weekLabel('2026-10-05'), '5 – 11 Oct 2026');
assert.match(weekLabel('2026-09-28'), /^28 Sept? – 4 Oct 2026$/);
assert.equal(weekLabel('2025-12-29'), '29 Dec 2025 – 4 Jan 2026');

console.log('weekly: all tests passed');
