import assert from 'node:assert/strict';
import {
  validBlocks, creditEntry, ukDateKey, timesheetEntries, emailRow, emailHtml,
  recipients, archiveFileName, creditApplied, xeroInvoice, SSA_XERO
} from '../src/core/ssa-renewal.js';

// — blocks —
assert.equal(validBlocks(1), 1);
assert.equal(validBlocks('2'), 2);
assert.equal(validBlocks(0), null);
assert.equal(validBlocks(1.5), null);
assert.equal(validBlocks(6), null);

// — the credit entry is worded like the ones typed in SharePoint —
assert.deepEqual(creditEntry(1), { engineer: 'System', hours: -10, description: 'Credit - 10 Hours' });
assert.deepEqual(creditEntry(2), { engineer: 'System', hours: -20, description: 'Credit - 20 Hours' });

// — UK dates: SharePoint stores a UK midnight as 23:00Z in summer, 00:00Z in winter —
assert.equal(ukDateKey('2026-09-28T23:00:00Z'), '2026-09-29');
assert.equal(ukDateKey('2026-12-01T00:00:00Z'), '2026-12-01');
assert.equal(ukDateKey('2026-09-29'), '2026-09-29');
assert.equal(ukDateKey(''), '');

// — which entries go in the email: real Cowan Consultancy data, 30 Sep 2026 —
// The flow's email that day listed 1126, 1127 (30/09) and 1123 (29/09) only.
const cowan = [
  { id: '1091', date: '2026-09-14T23:00:00Z', hours: 2.5,  engineer: 'Philip', workDescription: 'Home access' },
  { id: '1108', date: '2026-09-23T23:00:00Z', hours: 1,    engineer: 'Philip', workDescription: 'Outlook' },
  { id: '1113', date: '2026-09-23T23:00:00Z', hours: -10,  engineer: 'System', workDescription: 'Credit - 10 Hours' },
  { id: '1123', date: '2026-09-28T23:00:00Z', hours: 6,    engineer: 'Philip', workDescription: 'Voxone Upgrade - Foundation Work' },
  { id: '1126', date: '2026-09-29T23:00:00Z', hours: 6,    engineer: 'Philip', workDescription: 'Onsite to continue Voxone setup' },
  { id: '1127', date: '2026-09-29T23:00:00Z', hours: -20,  engineer: 'System', workDescription: 'Credit - 20 hours' }
];
assert.deepEqual(timesheetEntries(cowan).map(e => e.id), ['1126', '1127', '1123']);

// Same day as the previous credit but logged after it: included.
assert.deepEqual(
  timesheetEntries([...cowan, { id: '1114', date: '2026-09-23T23:00:00Z', hours: 0.5, engineer: 'Jack' }]).map(e => e.id),
  ['1126', '1127', '1123', '1114']
);
// A hand give-back after the last renewal is neither the previous credit nor printed as a renewal.
const giveBack = { id: '1130', date: '2026-10-01T23:00:00Z', hours: -0.5, engineer: 'System', description: 'Adjustment – logged twice' };
assert.deepEqual(timesheetEntries([...cowan, giveBack]).map(e => e.id), ['1130', '1126', '1127', '1123']);
assert.deepEqual(emailRow({ ...giveBack, dateKey: '2026-10-02' }).hours, '-0.50');
assert.equal(emailRow({ ...giveBack, dateKey: '2026-10-02' }).description, 'Adjustment – logged twice');
// Only one credit ever: everything is listed.
assert.equal(timesheetEntries(cowan.filter(e => e.id !== '1113')).length, 5);

// — rows read like the flow's —
const rows = timesheetEntries(cowan).map(emailRow);
assert.deepEqual(rows[0], { date: '30/09/2026', engineer: 'Philip', hours: '6.00', description: 'Onsite to continue Voxone setup' });
assert.deepEqual(rows[1], { date: '30/09/2026', engineer: 'System', hours: '+20.00', description: 'Credit – 20 hours (SSA renewal)' });
assert.equal(emailRow({ dateKey: '2026-10-01', hours: 0.25, engineer: 'Jack', workDescription: '', description: 'Title only' }).description, 'Title only');

// — the email —
const html = emailHtml({ clientName: 'Cowan <Consultancy>', primaryContact: 'Chris Wyeth', runDateKey: '2026-09-30', hoursRemaining: 6.5, rows });
assert.match(html, /^<p>To Chris Wyeth,/);
assert.match(html, /Client: Cowan &lt;Consultancy&gt;/, 'every value is escaped');
assert.match(html, /30\/09\/2026<\/td>/);
assert.match(html, /#dcfce7;color:#166534;font-weight:800;">6\.50 hours/);
assert.match(emailHtml({ clientName: 'X', runDateKey: '2026-10-07', hoursRemaining: 0.5, rows: [] }), /#fee2e2.*0\.50 hours/);
assert.equal((html.match(/<tr><td style="border/g) || []).length, 3);

// — recipients —
assert.deepEqual(recipients('chris.wyeth@cowanconsult.co.uk'), ['chris.wyeth@cowanconsult.co.uk']);
assert.deepEqual(recipients('a@x.com; b@y.co.uk'), ['a@x.com', 'b@y.co.uk']);
assert.deepEqual(recipients(''), []);
assert.deepEqual(recipients('not an email'), []);

// — archive copy name, as the flow names it (UTC) —
assert.equal(archiveFileName('Cowan Consultancy', '2026-09-30T20:00:23Z'), 'Timesheet Summary - Cowan Consultancy - 2026-09-30 - 2000.html');
assert.equal(archiveFileName('A/B', '2026-01-02T03:04:00Z'), 'Timesheet Summary - A-B - 2026-01-02 - 0304.html');

// — has the balance flow applied the credit? —
assert.equal(creditApplied(23.5, 3.5, 20), true);
assert.equal(creditApplied(23.5, 23.5, 20), false);
assert.equal(creditApplied(5, -4.75, 10), true, 'a 0.25h entry logged in the same minute still counts');

// — Xero lines reconcile —
assert.deepEqual(xeroInvoice(1), { ...SSA_XERO, quantity: 1, unitAmount: 650, net: 650, vat: 130, total: 780 });
const two = xeroInvoice(2);
assert.equal(two.net + two.vat, two.total);
assert.equal(two.total, 1560, 'matches INV-0265 (Cowan, 30 Sep 2026)');

console.log('ssa-renewal: all assertions passed');
