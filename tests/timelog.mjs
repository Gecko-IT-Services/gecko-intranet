import assert from 'node:assert/strict';
import { parseHours, fmtHours, balancePreview, checkEntry, recentClients, clientHistory, dayTotal } from '../src/core/timelog.js';

// Hours, typed the way people say them
const h = t => parseHours(t);
assert.equal(h('1.5').hours, 1.5);
assert.equal(h('1,5').hours, 1.5);
assert.equal(h('.75').hours, 0.75);
assert.equal(h('1:30').hours, 1.5);
assert.equal(h('0:45').hours, 0.75);
assert.equal(h('1h30').hours, 1.5);
assert.equal(h('1h 30m').hours, 1.5);
assert.equal(h('1 hr 15 mins').hours, 1.25);
assert.equal(h('2h').hours, 2);
assert.equal(h('2 hours').hours, 2);
assert.equal(h('90m').hours, 1.5);
assert.equal(h('45 mins').hours, 0.75);
assert.equal(h('15m').hours, 0.25);
assert.equal(h('1.5').rounded, false);
assert.deepEqual([h('20m').hours, h('20m').rounded], [0.25, true], '20 minutes rounds to the nearest quarter');
assert.equal(h('1:20').hours, 1.25);
assert.equal(h('').ok, false);
assert.equal(h('').reason, 'empty');
assert.equal(h('abc').reason, 'format');
assert.equal(h('5m').reason, 'zero', 'under 7.5 minutes is not a quarter hour');
assert.equal(h('0').reason, 'zero');
assert.equal(h('-1').ok, false);
assert.equal(h('1:75').ok, false);

assert.equal(fmtHours(1.5), '1h 30m');
assert.equal(fmtHours(0.25), '15m');
assert.equal(fmtHours(2), '2h');

// SSA balance preview
assert.equal(balancePreview({ hoursPurchased: 0 }, 1), null, 'no SSA, no preview');
assert.deepEqual(balancePreview({ hoursPurchased: 10, hoursUsed: 7, hoursRemaining: 3 }, 1.5), { before: 3, after: 1.5, state: 'low' });
assert.equal(balancePreview({ hoursPurchased: 10, hoursRemaining: 1 }, 1.5).state, 'over');
assert.equal(balancePreview({ hoursPurchased: 10, hoursUsed: 4 }, 1).after, 5, 'falls back to purchased - used');

// Checks before saving
const today = '2026-10-08';   // a Thursday
const entries = [
  { id: 1, clientName: 'Kingdom Products', engineer: 'Jack', date: '2026-10-08', hours: 1.5, description: 'Printer fix' },
  { id: 2, clientName: 'Technix', engineer: 'Jack', date: '2026-10-08', hours: 8, description: 'Migration' },
  { id: 3, clientName: 'Technix', engineer: 'Philip', date: '2026-10-07', hours: 1, description: 'Call' }
];
const ok = { clientId: 5, clientName: 'Kingdom Products', engineer: 'Philip', date: today, hours: h('1'), description: 'Email setup' };
assert.deepEqual(checkEntry(ok, { today, entries }), { errors: [], warnings: [] });

let r = checkEntry({ ...ok, clientId: '', hours: h(''), description: ' ' }, { today, entries });
assert.deepEqual(r.errors.map(e => e.field), ['client', 'hours', 'desc']);
assert.match(r.errors[1].text, /1:30/);
assert.match(checkEntry({ ...ok, hours: h('xyz') }, { today }).errors[0].text, /not recognised/);
assert.match(checkEntry({ ...ok, hours: h('13') }, { today }).errors[0].text, /Split it by day/);
assert.equal(checkEntry({ ...ok, date: '' }, { today }).errors[0].field, 'date');

assert.match(checkEntry({ ...ok, date: '2026-10-09' }, { today }).warnings[0].text, /future/);
assert.match(checkEntry({ ...ok, date: '2026-08-20' }, { today }).warnings[0].text, /49 days ago/);
assert.match(checkEntry({ ...ok, date: '2026-10-04' }, { today }).warnings[0].text, /weekend/);

r = checkEntry({ ...ok, engineer: 'Jack', hours: h('1.5'), description: 'printer  fix!' }, { today, entries });
assert.ok(r.warnings.some(w => /duplicate/.test(w.text)), 'same client, day, hours and description');
assert.ok(r.warnings.some(w => /11h/.test(w.text)), 'Jack would be at 11h for the day');
r = checkEntry({ ...ok, engineer: 'Jack', hours: h('1.5'), description: 'Something else' }, { today, entries });
assert.ok(!r.warnings.some(w => /duplicate/.test(w.text)), 'a different job on the same day is not a duplicate');

r = checkEntry({ ...ok, hours: h('2') }, { today, entries, client: { hoursPurchased: 10, hoursRemaining: 1 } });
assert.match(r.warnings[0].text, /1h over their SSA hours/);

// Suggestions
assert.deepEqual(recentClients([...entries, { clientName: 'Technix', engineer: 'Jack', date: '2026-10-01', hours: 1 }], 'Jack', today), ['Technix', 'Kingdom Products']);
assert.deepEqual(recentClients([{ clientName: 'Old', engineer: 'Jack', date: '2026-07-01' }], 'Jack', today), []);
const hist = clientHistory([
  { id: 1, clientName: 'Technix', date: '2026-10-01', description: 'Backup check', workType: 'Maintenance' },
  { id: 2, clientName: 'Technix', date: '2026-10-05', description: 'backup check', workType: '' },
  { id: 3, clientName: 'Technix', date: '2026-10-03', description: 'New laptop', workType: 'PC Set Up' },
  { id: 4, clientName: 'Other', date: '2026-10-06', description: 'X', workType: 'Misc' }
], 'Technix');
assert.deepEqual(hist.descriptions, ['backup check', 'New laptop'], 'newest first, no repeats');
assert.equal(hist.workType, 'PC Set Up', 'last work type actually recorded');
assert.equal(dayTotal(entries, 'Jack', today), 9.5);
// The log shows Work Description; Title can differ (Power App rows)
r = checkEntry({ ...ok, engineer: 'Jack', hours: h('1.5'), description: 'Printer' },
  { today, entries: [{ clientName: 'Kingdom Products', engineer: 'Jack', date: today, hours: 1.5, description: 'x', workDescription: 'Printer' }] });
assert.ok(r.warnings.some(w => /“Printer”/.test(w.text)));
assert.deepEqual(clientHistory([{ clientName: 'A', date: today, description: 'x', workDescription: 'Fixed VPN' }], 'A').descriptions, ['Fixed VPN']);

console.log('timelog: all tests passed');
