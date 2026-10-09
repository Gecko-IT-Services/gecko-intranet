import assert from 'node:assert/strict';
import { taxYear, taxYearBounds, person, holiday, calendar, presence, hours, mileage, monday, addDays } from '../src/core/team.js';

assert.equal(taxYear('2026-04-05'), '2025/26');
assert.equal(taxYear('2026-04-06'), '2026/27');
assert.deepEqual(taxYearBounds('2026/27'), { start: '2026-04-06', end: '2027-04-05' });
assert.equal(person('Jack Morris'), 'Jack');
assert.equal(person('philip'), 'Philip');
assert.equal(monday('2026-10-11'), '2026-10-05', 'Sunday belongs to the week before');
assert.equal(monday('2026-10-05'), '2026-10-05');

const today = '2026-10-08';
const requests = [
  { person: 'Philip', start: '2026-10-08', end: '2026-10-09', hours: 14, status: 'Approved', type: 'Annual Leave' },
  { person: 'Jack', start: '2026-10-12', end: '2026-10-13', hours: 14, status: 'Pending', type: 'Annual Leave' },
  { person: 'Jack', start: '2026-06-01', end: '2026-06-05', hours: 35, status: 'Approved', type: 'Annual Leave' },
  { person: 'Jack', start: '2026-03-30', end: '2026-04-02', hours: 28, status: 'Approved', type: 'Annual Leave' },   // last tax year
  { person: 'Jack', start: '2026-07-01', end: '2026-07-01', hours: 7, status: 'Approved', type: 'Sick' },             // not holiday
  { person: 'Jack', start: '2026-10-20', end: '2026-10-20', hours: 7, status: 'Rejected', type: 'Annual Leave' }
];
const ents = [{ person: 'Jack', tax_year: '2026/27', entitlement_hours: 140, carry_over_hours: 7, adjustment_hours: -3.5 }];
assert.deepEqual(holiday(requests, ents, 'Jack', '2026/27'), { entitlement: 143.5, booked: 35, pending: 14, remaining: 108.5, days: 15.5 });
assert.deepEqual(holiday(requests, ents, 'Philip', '2026/27'), { entitlement: 140, booked: 14, pending: 0, remaining: 126, days: 18 }, 'default entitlement');

const cal = calendar(requests, today, { weeks: 2 });
assert.equal(cal.days.length, 14);
assert.equal(cal.days[0], '2026-10-05');
const ph = cal.rows.find(r => r.person === 'Philip').cells;
assert.deepEqual(ph.filter(c => c.state).map(c => [c.date, c.state]), [['2026-10-08', 'off'], ['2026-10-09', 'off']]);
assert.ok(ph.find(c => c.date === today).today);
assert.ok(ph.find(c => c.date === '2026-10-10').weekend);
const jk = cal.rows.find(r => r.person === 'Jack').cells;
assert.deepEqual(jk.filter(c => c.state).map(c => c.state), ['pending', 'pending'], 'rejected not shown');

const pr = presence(requests, today);
assert.deepEqual([pr.Philip.off, pr.Philip.back], [true, '2026-10-10']);
assert.equal(pr.Jack.off, false);
assert.equal(pr.Jack.next.start, '2026-10-12');
assert.equal(pr.Jack.pendingCount, 1);

const hrs = hours([
  { engineer: 'Jack', entry_date: '2026-10-06', hours: 1.5 },
  { engineer: 'Jack', entry_date: '2026-10-08', hours: 0.25 },
  { engineer: 'Jack', entry_date: '2026-10-01', hours: 3 },
  { engineer: 'Philip', entry_date: '2026-10-05', hours: 2 },
  { engineer: 'System', entry_date: '2026-10-06', hours: 10 },
  { engineer: 'Jack', entry_date: '2026-10-07', hours: 5, deleted_at: '2026-10-07' }
], today);
assert.deepEqual(hrs.Jack, { week: 1.75, last: 3, byDay: [0, 1.5, 0, 0.25, 0, 0, 0] });
assert.equal(hrs.Philip.week, 2);

const mi = mileage([
  { driver: 'Philip Morris', journey_date: '2026-10-02', miles: 20, amount: 9, claimed_date: null },
  { driver: 'Philip Morris', journey_date: '2026-09-20', miles: 40, amount: 18, claimed_date: null },
  { driver: 'Jack Morris', journey_date: '2026-10-03', miles: 10, amount: 4.5, claimed_date: '2026-10-05' }
], today);
assert.deepEqual(mi.Philip, { miles: 20, amount: 9, trips: 1, unclaimed: 27, unclaimedTrips: 2, oldest: '2026-09-20' });
assert.deepEqual(mi.Jack, { miles: 10, amount: 4.5, trips: 1, unclaimed: 0, unclaimedTrips: 0, oldest: null });
assert.equal(addDays('2026-10-31', 1), '2026-11-01');

console.log('team: ok');

// Planner bars: clipped to the window, rejected left out.
import { bars, daysBetween, tokensHtml } from '../src/core/team.js';
const b = bars(requests, '2026-10-09', '2026-10-31');
assert.deepEqual(b.map(x => [x.person, x.from, x.to, x.cutStart, x.status]),
  [['Philip', '2026-10-09', '2026-10-09', true, 'Approved'], ['Jack', '2026-10-12', '2026-10-13', false, 'Pending']]);
assert.equal(daysBetween('2026-10-05', '2026-11-02'), 28);
assert.equal(pr.Philip.now.start, '2026-10-08');

// Tokens: 20 days, 10.5 booked, 1 requested → token 10 half spent, token 11 half requested.
const tk = tokensHtml({ entitlement: 140, booked: 73.5, pending: 7 });
assert.equal((tk.match(/<i/g) || []).length, 20);
assert.match(tk, /aria-label="9.5 of 20 days left, 1 requested"/);
assert.match(tk, /--b:50%;--p:100%/);
assert.match(tk, /--b:0%;--p:50%/);
assert.equal((tokensHtml({ entitlement: 140, booked: 147, pending: 0 }).match(/class="over"/g) || []).length, 1, 'over-booked day');
