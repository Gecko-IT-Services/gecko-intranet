import assert from 'node:assert/strict';
import { mondayBrief, weekKey } from '../src/core/brief.js';

assert.equal(weekKey('2026-10-19'), '2026-10-19', 'a Monday is its own week');
assert.equal(weekKey('2026-10-25'), '2026-10-19', 'Sunday belongs to the Monday before');
assert.equal(weekKey('2026-10-26'), '2026-10-26');

const b = mondayBrief({ today: '2026-10-26', first: 'Philip', url: 'https://gecko-it-services.github.io/gecko-intranet/',
  actions: [
    { title: 'Server DCSERVER is offline', why: 'Usually on by now.', value: null },
    { title: 'Bill Snowskool: Antivirus', why: '2 more in use than billed', value: { gbp: 4.6, per: 'month' } }],
  last: { start: '2026-10-19', end: '2026-10-25', hours: { Philip: { week: 6.5, last: 4 }, Jack: { week: 12.25, last: 12.25 } },
    invoiced: { week: 3120.5, last: 2900, count: 9 }, pipeline: { won: [{ client_name: 'Cowan Consultancy', mrr: 112.5 }], added: [{}, {}], lost: [], wonMrr: 112.5 },
    jobs: { invoiced: [{}], moved: [], added: [] }, nudges: [{}] },
  ahead: { away: [{ person: 'Jack', start: '2026-10-28', end: '2026-10-30', now: false }], jobsDue: [{ title: 'Server move', client_name: 'Freeston', target_date: '2026-10-29' }],
    goingOut: { count: 14, value: 2637.84 } },
  attention: [{ level: 'red', title: '£300.00 overdue', detail: '2 invoices · CDA Ltd £300.00' }, { level: 'info', title: 'FYI' }, { level: 'amber', title: 'x', task: {} }],
  missing: ['SSA balances'] });
assert.equal(b.subject, 'Gecko HQ: the week of Mon 26 Oct');
for (const re of [/Good morning Philip/, /<a href="https:\/\/gecko-it-services\.github\.io\/gecko-intranet\/">Open Gecko HQ<\/a>/,
  /<h3>Do next<\/h3>/, /<strong>Bill Snowskool: Antivirus<\/strong> · £4\.60 a month<br>2 more in use than billed/,
  /<h3>Last week \(Mon 19 Oct to Sun 25 Oct\)<\/h3>/, /Invoiced £3,120\.50 \(9 invoices\), up £220\.50 on the week before\./,
  /Hours logged: Philip 6\.5h, Jack 12\.25h \(the week before: Philip 4h, Jack 12\.25h\)\./, /Won 1 deal, £112\.50 a month: Cowan Consultancy\./,
  /2 new deals in the pipeline\./, /1 job invoiced\./, /1 payment reminder drafted\./,
  /Jack away from Wed 28 Oct to Fri 30 Oct\./, /Job due Thu 29 Oct: Server move \(Freeston\)\./, /14 repeating invoices going out, £2,637\.84\./,
  /<h3>Needs a look<\/h3><ul><li><strong>£300\.00 overdue<\/strong>: 2 invoices · CDA Ltd £300\.00<\/li><\/ul>/, /Not checked: SSA balances\./])
  assert.match(b.html, re);
assert.doesNotMatch(b.html, /FYI/, 'info and tasks left out');
const quiet = mondayBrief({ today: '2026-10-26' });
assert.match(quiet.html, /Nothing to chase, bill or protect/);
assert.match(mondayBrief({ today: '2026-10-26', actions: Array.from({ length: 12 }, (_, i) => ({ title: `A${i}`, why: '' })) }).html, /Do next \(top 8 of 12\)/);
const withDates = mondayBrief({ today: '2026-10-26', dates: [{ date: '2026-10-28', days: 2, title: 'cowanconsult.co.uk expires 28 Oct 2026' },
  { date: '2026-12-01', days: 36, title: 'Web Hosting renews for CDA Ltd', value: { gbp: 174, per: 'once' } }] });
assert.match(withDates.html, /<h3>Coming up<\/h3><ul><li><strong>Wed 28 Oct<\/strong> \(in 2 days\): cowanconsult\.co\.uk expires 28 Oct 2026<\/li><li><strong>Tue 1 Dec<\/strong> \(in 36 days\): Web Hosting renews for CDA Ltd · £174 one-off<\/li><\/ul>/);
console.log('brief: ok');
