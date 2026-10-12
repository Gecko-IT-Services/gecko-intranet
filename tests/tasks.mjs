import assert from 'node:assert/strict';
import { personOf, titleFromNote, isNew, level, lateness, dueLabel, cleanTask, groups, forClient, doneRecently } from '../src/core/tasks.js';

const today = '2026-10-08';   // Thursday
const now = '2026-10-08T09:00:00.000Z';

// Who is signed in
assert.equal(personOf('Jack Morris'), 'Jack');
assert.equal(personOf('  philip@gecko-it.com'), 'Philip');
assert.equal(personOf('Not signed in'), '');
assert.equal(personOf(''), '');

// A note's first line becomes the task
assert.equal(titleFromNote('\n  Chris wants 3 more   licences \nfrom November'), 'Chris wants 3 more licences');
assert.equal(titleFromNote('x'.repeat(200)).length, 140);

// What was typed → a row
let r = cleanTask({ title: '  Ring Pam   about the Wi-Fi ', note: ' back\noffice ', client_name: ' LS Commercials ', assigned_to: 'Jack', due_on: '2026-10-08' }, { me: 'Jack', today, now });
assert.deepEqual(r.row, { title: 'Ring Pam about the Wi-Fi', note: 'back office', client_name: 'LS Commercials', assigned_to: 'Jack', due_on: '2026-10-08',
  assigned_by: 'Jack', seen_at: now, created_by: 'Jack' }, 'your own task is seen from the start');
r = cleanTask({ title: 'Set up laptop', assigned_to: 'Jack', due_on: '2026-10-16' }, { me: 'Philip', today, now });
assert.deepEqual([r.row.assigned_by, r.row.seen_at, r.row.client_name, r.row.note], ['Philip', null, '', ''], 'a handoff is new to the other person');
assert.match(cleanTask({ title: ' ', assigned_to: 'Jack', due_on: today }, { me: 'Jack', today }).error, /what needs doing/);
assert.match(cleanTask({ title: 'x', assigned_to: 'Bob', due_on: today }, { me: 'Jack', today }).error, /who/);
assert.match(cleanTask({ title: 'x', assigned_to: 'Jack', due_on: '' }, { me: 'Jack', today }).error, /due date/);
assert.match(cleanTask({ title: 'x', assigned_to: 'Jack', due_on: '2026-10-07' }, { me: 'Jack', today }).error, /past/);
assert.equal(cleanTask({ title: 'x', assigned_to: 'Jack', due_on: today }, { me: '', today, now }).row.seen_at, now, 'nobody signed in by name: never "new from nobody"');

// Editing
const prev = { id: 5, title: 'Old', assigned_to: 'Jack', assigned_by: 'Philip', seen_at: now, due_on: '2026-10-01' };
r = cleanTask({ title: 'New words', assigned_to: 'Jack', due_on: '2026-10-01' }, { me: 'Jack', today, now, prev });
assert.deepEqual(r.row, { title: 'New words', note: '', client_name: '', assigned_to: 'Jack', due_on: '2026-10-01' }, 'an overdue task can be edited; who gave it is kept');
assert.match(cleanTask({ title: 'x', assigned_to: 'Jack', due_on: '2026-10-02' }, { me: 'Jack', today, prev }).error, /past/, 'but not moved to another past date');
r = cleanTask({ title: 'Old', assigned_to: 'Philip', due_on: '2026-10-09' }, { me: 'Jack', today, now, prev });
assert.deepEqual([r.row.assigned_by, r.row.seen_at, 'created_by' in r.row], ['Jack', null, false], 'changing who hands it over');

// New, and the colour of a row
const T = (id, o) => ({ id, title: 't' + id, client_name: '', assigned_to: 'Jack', assigned_by: 'Jack', seen_at: now, due_on: today, done_at: null, ...o });
assert.equal(isNew(T(1, { assigned_by: 'Philip', seen_at: null })), true);
assert.equal(isNew(T(1, { assigned_by: 'Philip' })), false, 'opened');
assert.equal(isNew(T(1, { seen_at: null })), false, 'your own');
assert.equal(isNew(T(1, { assigned_by: 'Philip', seen_at: null, done_at: now })), false, 'done');
assert.equal(level(T(1, { due_on: '2026-10-09' }), today), '');
assert.equal(level(T(1), today), 'amber');
assert.equal(level(T(1, { due_on: '2026-10-01' }), today), 'amber', '7 days overdue is still amber');
assert.equal(level(T(1, { due_on: '2026-09-30' }), today), 'red', '8 days overdue is red');
assert.equal(level(T(1, { due_on: '2026-10-20', assigned_by: 'Philip', seen_at: null }), today), 'new', 'a handoff shows whatever its date');
assert.equal(level(T(1, { due_on: '2026-09-30', assigned_by: 'Philip', seen_at: null }), today), 'red', 'red wins over new');
assert.equal(lateness(T(1, { due_on: '2026-10-09' }), today), '', 'later');
assert.equal(lateness(T(1), today), 'amber', 'today');
assert.equal(lateness(T(1, { due_on: '2026-10-01' }), today), 'amber', '7 days overdue');
assert.equal(lateness(T(1, { due_on: '2026-09-30' }), today), 'red', '8 days overdue');
const unseenLate = T(1, { due_on: '2026-10-06', assigned_by: 'Philip', seen_at: null });
assert.equal(level(unseenLate, today), 'new', 'an unseen handoff 2 days overdue is new');
assert.equal(lateness(unseenLate, today), 'amber', 'and still amber underneath');

assert.equal(dueLabel('2026-10-06', today), '2 days overdue');
assert.equal(dueLabel('2026-10-08', today), 'today');
assert.equal(dueLabel('2026-10-09', today), 'tomorrow');
assert.equal(dueLabel('2026-10-16', today), 'Fri 16 Oct');

// Today's groups
const all = [
  T(1, { due_on: '2026-10-08' }),                                                    // mine, due today
  T(2, { due_on: '2026-09-28' }),                                                    // mine, red
  T(3, { due_on: '2026-10-20', assigned_by: 'Philip', seen_at: null }),              // new from Philip
  T(4, { due_on: '2026-10-12' }),                                                    // mine, later
  T(5, { due_on: '2026-10-10' }),                                                    // mine, later, sooner
  T(6, { assigned_to: 'Philip', due_on: '2026-10-09', seen_at: null }),              // I gave Philip, not seen
  T(7, { assigned_to: 'Philip', assigned_by: 'Philip', due_on: '2026-10-07' }),      // Philip's own, overdue
  T(8, { due_on: '2026-10-01', done_at: '2026-10-02T10:00:00Z' })                    // done
];
let g = groups(all, 'Jack', today);
assert.deepEqual(g.now.map(t => [t.id, t.level]), [[2, 'red'], [3, 'new'], [1, 'amber']], 'red, new, amber');
assert.deepEqual(g.later.map(t => t.id), [5, 4], 'later by date');
assert.deepEqual(g.waiting.map(t => t.id), [6], 'what I gave Philip; not his own');
g = groups(all, 'Philip', today);
assert.deepEqual([g.now.map(t => t.id), g.later.map(t => t.id), g.waiting.map(t => t.id)], [[6, 7], [], [3]]);
g = groups(all, 'Jack', today, true);
assert.deepEqual([g.now.map(t => t.id), g.later.map(t => t.id), g.waiting], [[2, 6, 3, 7, 1], [5, 4], []], 'everyone: both people, new handoffs by date, nothing waiting');
assert.deepEqual(groups(all, '', today).now.length, 5, 'nobody signed in by name sees everyone');
assert.deepEqual(groups(null, 'Jack', today), { now: [], later: [], waiting: [] });

// One client, and what was done
const byClient = [T(1, { client_name: 'Cowan Consultancy Ltd', due_on: '2026-10-12' }), T(2, { client_name: 'Cowan Consultancy' }), T(3, { client_name: 'Technix' }), T(4, { client_name: 'Cowan Consultancy', done_at: now }), T(5)];
assert.deepEqual(forClient(byClient, 'Cowan Consultancy').map(t => t.id), [2, 1], 'any spelling, open only, soonest first');
const done = [T(1, { done_at: '2026-10-07T10:00:00Z' }), T(2, { done_at: '2026-10-08T08:00:00Z' }), T(3, { done_at: '2026-09-01T10:00:00Z' }), T(4)];
assert.deepEqual(doneRecently(done, today).map(t => t.id), [2, 1], 'last 30 days, newest first');

console.log('tasks: all tests passed');
