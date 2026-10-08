import assert from 'node:assert/strict';
import { workingDaysLeft, monthEndSoon, monthEnd, timesheetGaps, weekReview, MANUAL } from '../src/core/review.js';

assert.equal(workingDaysLeft('2026-10-26'), 5, 'Mon 26 → Fri 30 Oct');
assert.equal(workingDaysLeft('2026-10-31'), 0, 'Saturday the 31st');
assert.equal(workingDaysLeft('2026-10-08'), 17);
assert.ok(monthEndSoon('2026-10-26'));
assert.ok(!monthEndSoon('2026-10-23'));

const today = '2026-10-28';
const inv = [
  { invoice_id: 'a', invoice_number: 'INV-1', contact_name: 'A Ltd', invoice_date: '2026-09-01', due_date: '2026-09-15', status: 'AUTHORISED', sub_total: 100, amount_due: 120 },
  { invoice_id: 'b', invoice_number: 'INV-2', contact_name: 'B Ltd', invoice_date: '2026-09-02', due_date: '2026-09-16', status: 'AUTHORISED', sub_total: 50, amount_due: 60 },
  { invoice_id: 'c', invoice_number: 'INV-3', contact_name: 'C Ltd', invoice_date: '2026-10-27', due_date: '2026-11-10', status: 'DRAFT', sub_total: 80, amount_due: 96 },
  { invoice_id: 'd', invoice_number: 'INV-4', contact_name: 'D Ltd', invoice_date: '2026-10-26', due_date: '2026-11-09', status: 'AUTHORISED', sub_total: 300, amount_due: 360 },
  { invoice_id: 'e', invoice_number: 'INV-5', contact_name: 'Voip Unlimited', invoice_date: '2026-10-27', status: 'PAID', sub_total: 600, amount_due: 0 }
];
const rep = [{ contact_name: 'E Ltd', status: 'AUTHORISED', period: 1, unit: 'MONTHLY', next_date: '2026-10-30', sub_total: 200 }];
const data = {
  inv, rep,
  jobs: [{ client_name: 'F Ltd', title: 'Laptops', status: 'to_invoice', value: 900 }, { client_name: 'G Ltd', title: 'Move', status: 'in_progress', value: 500, target_date: '2026-10-31' }],
  journeys: [{ date: '2026-10-02', amount: 9, claimedDate: '' }, { date: '2026-09-02', amount: 4, claimedDate: '2026-10-01' }],
  ssa: [{ name: 'Low Ltd', remaining: 1, archived: false }, { name: 'Ok Ltd', remaining: 9, archived: false }],
  leave: [{ person: 'Jack', start: '2026-10-05', end: '2026-10-09', status: 'Approved' }, { person: 'Philip', start: '2026-11-03', end: '2026-11-03', status: 'Pending' }],
  entries: [], nudges: [{ contact_name: 'A Ltd', created_at: '2026-10-20T10:00:00Z' }], ticks: [{ item: 'tdsynnex', done_by: 'Philip', done_at: '2026-10-27T09:00:00Z' }]
};
const m = monthEnd(data, today);
const by = Object.fromEntries(m.items.map(i => [i.key, i]));
assert.equal(m.month, '2026-10');
assert.equal(m.daysLeft, 3);
assert.ok(m.soon);
assert.equal(by.repeating.state, 'todo');
assert.match(by.repeating.detail, /1 repeating invoice still to go out this month \(£200\.00\): E Ltd/);
assert.equal(by.drafts.state, 'todo');
assert.equal(by.chased.state, 'todo', 'B Ltd overdue and not nudged');
assert.match(by.chased.detail, /1 client overdue and not nudged in the last two weeks: B Ltd £60\.00/);
assert.equal(by.invoice_jobs.state, 'todo');
assert.equal(by.job_dates.state, 'todo');
assert.equal(by.mileage.state, 'todo');
assert.match(by.mileage.detail, /1 journey not claimed \(£9\.00\)/);
assert.equal(by.ssa.state, 'todo');
assert.equal(by.timesheets.state, 'check', 'gaps are a check, not a failure');
assert.equal(by.leave.state, 'todo');
assert.equal(by.tdsynnex.state, 'done');
assert.match(by.tdsynnex.detail, /Ticked by Philip on 2026-10-27/);
assert.equal(by.atera.state, 'todo');
assert.equal(m.total, m.items.length);
assert.equal(m.done, 1);

const clean = monthEnd({ inv: [], rep: [], jobs: [], journeys: [], ssa: [], leave: [], entries: [], nudges: [], ticks: MANUAL.map(x => ({ item: x.key, done_by: 'P', done_at: '2026-10-28' })) }, '2026-10-01');
assert.equal(clean.done, clean.total, 'nothing to do: everything ticks itself (no gaps before the 1st)');
const none = monthEnd({}, today);
assert.ok(none.items.filter(i => !i.manual).every(i => i.state === 'check'), 'sources that did not load are never ticked');

const gaps = timesheetGaps([{ engineer: 'Philip', date: '2026-10-01' }, { engineer: 'Jack', date: '2026-10-01' }], data.leave, '2026-10-12');
assert.deepEqual(gaps.Philip, ['2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
assert.deepEqual(gaps.Jack, ['2026-10-02'], 'leave days are not gaps');

const w = weekReview({
  inv, opps: [{ title: 'Hornet', status: 'won', mrr: 30, closed_at: '2026-10-27T10:00:00Z', created_at: '2026-10-01' }, { title: 'X', status: 'idea', created_at: '2026-10-26T09:00:00Z' }],
  jobs: [{ title: 'Server', status: 'invoiced', invoiced_at: '2026-10-27', modified_at: '2026-10-27' }, { title: 'Move', status: 'in_progress', modified_at: '2026-10-26T10:00:00Z', created_at: '2026-10-26T10:00:00Z' }],
  entries: [{ engineer: 'Jack', date: '2026-10-27', hours: 2 }, { engineer: 'Jack', date: '2026-10-20', hours: 5 }],
  nudges: [{ contact_name: 'B', created_at: '2026-10-27T08:00:00Z' }],
  leave: [{ person: 'Philip', start: '2026-11-03', end: '2026-11-03', status: 'Pending' }]
}, today);
assert.deepEqual([w.start, w.end], ['2026-10-26', '2026-11-01']);
assert.deepEqual(w.hours.Jack, { week: 2, last: 5 });
assert.equal(w.invoiced.week, 300, 'net, approved, dealer commission excluded');
assert.equal(w.invoiced.count, 1);
assert.equal(w.jobs.invoiced.length, 1);
assert.equal(w.jobs.moved.length, 1);
assert.equal(w.jobs.added.length, 1);
assert.equal(w.pipeline.won.length, 1);
assert.equal(w.pipeline.wonMrr, 30);
assert.equal(w.pipeline.added.length, 1);
assert.equal(w.nudges.length, 1);
assert.equal(w.nextOff.length, 1);
assert.equal(weekReview({}, today).invoiced, null, 'not loaded is null');

console.log('review: ok');
