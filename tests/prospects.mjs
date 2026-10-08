import assert from 'node:assert/strict';
import { cleanProspect, prospectSummary, sortProspects, conversion } from '../src/core/prospects.js';

let r = cleanProspect({ company: ' Acme   Engineering ', contact_name: 'Sam Smith', email: 'Sam@Acme.co.uk', source: 'referral', interest: 'IT support + M365', est_mrr: '450', stage: 'meeting', follow_up_on: '2026-10-12' });
assert.deepEqual(r.row, { company: 'Acme Engineering', contact_name: 'Sam Smith', email: 'sam@acme.co.uk', phone: '', source: 'referral', interest: 'IT support + M365', stage: 'meeting', est_mrr: 450, next_step: '', follow_up_on: '2026-10-12', notes: '' });
assert.equal(cleanProspect({ company: 'X' }).row.contact_name, '', 'company alone is enough');
assert.equal(cleanProspect({ company: 'X', source: 'nope', stage: 'nope', est_mrr: '-5' }).row.source, 'other');
assert.equal(cleanProspect({ company: 'X', stage: 'nope' }).row.stage, 'new');
assert.equal(cleanProspect({ company: 'X', est_mrr: '-5' }).row.est_mrr, 0);
assert.match(cleanProspect({ company: '' }).error, /company/);
assert.match(cleanProspect({ company: 'X', email: 'bad' }).error, /doesn’t look like/);

const today = '2026-10-08';
const list = [
  { id: 1, company: 'A', stage: 'new', est_mrr: 100, follow_up_on: '2026-10-07' },
  { id: 2, company: 'B', stage: 'proposal', est_mrr: 300, follow_up_on: '2026-10-20' },
  { id: 3, company: 'C', stage: 'won', est_mrr: 200, modified_at: '2026-10-01' },
  { id: 4, company: 'D', stage: 'lost', est_mrr: 50, modified_at: '2026-10-05' },
  { id: 5, company: 'E', stage: 'proposal', est_mrr: 0, follow_up_on: '2026-10-08' }
];
const s = prospectSummary(list, today);
assert.equal(s.openCount, 3);
assert.equal(s.openMrr, 400);
assert.equal(s.due, 2, 'A overdue, E today');
assert.deepEqual(s.by.proposal, { count: 2, mrr: 300 });
assert.deepEqual(sortProspects(list).map(p => p.id), [5, 2, 1, 4, 3], 'proposals first (soonest follow-up), then new; closed newest first');

const conv = conversion({ company: 'Acme Engineering', contact_name: 'Sam Smith', email: 'sam@acme.co.uk', source: 'referral', interest: 'IT support', est_mrr: 450, notes: 'Two sites' }, ['Cowan Consultancy'], today, 'Philip');
assert.deepEqual(conv.client, { title: 'Acme Engineering', status: 'New', contract_start: today, notes: 'Interested in: IT support\nTwo sites' });
assert.equal(conv.contact.is_main, true);
assert.equal(conv.activity.body, 'Became a client (prospect from referral; interested in IT support; estimated £450.00/month).');
assert.equal(conv.prospect.stage, 'won');
assert.equal(conversion({ company: 'No Contact Ltd' }, [], today).contact, null);
assert.match(conversion({ company: 'Cowan Consultancy Ltd' }, ['Cowan Consultancy'], today).error, /already a client/);

console.log('prospects: all tests passed');
