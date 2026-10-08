import assert from 'node:assert/strict';
import { cleanActivity, timeline, dueText, dueFollowUps, lastContact, followUpChoices } from '../src/core/activity.js';

const today = '2026-10-08';   // Thursday
assert.deepEqual(followUpChoices(today), [['Tomorrow', '2026-10-09'], ['Next week', '2026-10-12'], ['In 2 weeks', '2026-10-22'], ['In a month', '2026-11-07']]);
assert.equal(followUpChoices('2026-10-12')[1][1], '2026-10-19', 'on a Monday, next week is the following Monday');

let r = cleanActivity({ kind: 'call', body: '  Spoke to   Chris about seats ', contact_id: '4', contact_name: 'Chris', follow_up_on: '2026-10-12' }, 'Cowan', today);
assert.deepEqual(r.row, { client_name: 'Cowan', kind: 'call', body: 'Spoke to Chris about seats', contact_id: 4, contact_name: 'Chris', follow_up_on: '2026-10-12' });
assert.equal(cleanActivity({ kind: 'nonsense', body: 'x' }, 'C', today).row.kind, 'note');
assert.equal(cleanActivity({ body: 'x' }, 'C', today).row.follow_up_on, null);
assert.match(cleanActivity({ body: ' ' }, 'C', today).error, /Write a line/);
assert.match(cleanActivity({ body: 'x', follow_up_on: '2026-10-01' }, 'C', today).error, /past/);
assert.match(cleanActivity({ body: 'x' }, '', today).error, /client/);

const all = [
  { id: 1, client_name: 'Cowan Consultancy', kind: 'note', body: 'a', created_at: '2026-10-01T10:00:00Z', follow_up_on: '2026-10-06', follow_up_done_at: null },
  { id: 2, client_name: 'Cowan Consultancy Ltd', kind: 'call', body: 'b', created_at: '2026-10-07T10:00:00Z', created_by: 'Philip', contact_name: 'Chris', follow_up_on: '2026-10-08', follow_up_done_at: null },
  { id: 3, client_name: 'Cowan Consultancy', kind: 'email', body: 'c', created_at: '2026-10-05T10:00:00Z', follow_up_on: '2026-10-02', follow_up_done_at: '2026-10-03T09:00:00Z' },
  { id: 4, client_name: 'Kingdom Products', kind: 'visit', body: 'd', created_at: '2026-10-08T09:00:00Z', follow_up_on: '2026-10-20', follow_up_done_at: null }
];
const t = timeline(all, 'Cowan Consultancy');
assert.deepEqual(t.items.map(a => a.id), [2, 3, 1], 'newest first, any spelling');
assert.deepEqual(t.open.map(a => a.id), [1, 2], 'open follow-ups, soonest first; done ones left out');
assert.equal(dueText('2026-10-08', today), 'today');
assert.equal(dueText('2026-10-09', today), 'tomorrow');
assert.equal(dueText('2026-10-11', today), 'in 3 days');
assert.equal(dueText('2026-10-07', today), '1 day overdue');
assert.equal(dueText('2026-10-06', today), '2 days overdue');
assert.deepEqual(dueFollowUps(all, today).map(a => [a.id, a.late]), [[1, 2], [2, 0]], 'due by today only, not done, not future');
assert.deepEqual(lastContact(t.items), { kind: 'call', at: '2026-10-07', by: 'Philip', with: 'Chris' });
assert.equal(lastContact([{ kind: 'note', created_at: '2026-10-01' }]), null, 'a note is not contact');

console.log('activity: all tests passed');
