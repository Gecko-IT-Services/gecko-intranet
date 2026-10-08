import assert from 'node:assert/strict';
import {
  validHours, entryChange, balances, spClientToRow, spEntryToRow, spRemaining,
  copyPlan, reconcileCopy, planSync, rowToEntry, rowToClient
} from '../src/core/timesheets.js';

// — Quarter hours —
assert.ok(validHours(0.25) && validHours(1.5) && validHours(7.75));
assert.ok(!validHours(0.1) && !validHours(0) && !validHours('') && !validHours(-1));
assert.ok(validHours(-10, { allowNegative: true }), 'credits are negative');
assert.ok(!validHours(-0.3, { allowNegative: true }));

// — Balance: opening + changes since, never recalculated from history —
const clients = [
  { id: 1, hours_purchased: 20, opening_purchased: 20, opening_used: 17.5, opening_remaining: 2.5 },
  { id: 2, hours_purchased: 10, opening_purchased: 10, opening_used: 3, opening_remaining: 7 }
];
const entries = [
  { client_id: 1, hours: 2, opening_hours: 2 },                    // copied, untouched → 0
  { client_id: 1, hours: 1.5, opening_hours: 1 },                  // copied, edited 1 → 1.5 → +0.5
  { client_id: 1, hours: 3, opening_hours: 3, deleted_at: 'x' },   // copied, deleted → −3
  { client_id: 1, hours: 0.75, opening_hours: null },              // new → +0.75
  { client_id: 1, hours: -10, opening_hours: null },               // renewal credit → −10
  { client_id: 2, hours: 1, opening_hours: null, deleted_at: 'x' } // new then deleted → 0
];
assert.equal(entryChange(entries[0]), 0);
assert.equal(entryChange(entries[2]), -3);
const b = balances(clients, entries);
assert.deepEqual(b.get('1'), { purchased: 20, used: 5.75, remaining: 14.25 }, '17.5 + 0.5 − 3 + 0.75 − 10');
assert.deepEqual(b.get('2'), { purchased: 10, used: 3, remaining: 7 });
// Hours purchased changed in Lists after the copy → remaining moves with it.
const b2 = balances([{ ...clients[1], hours_purchased: 20 }], []);
assert.equal(b2.get('2').remaining, 17);

// — SharePoint rows —
const spClient = { id: '7', fields: { Title: 'MSA Safety', HoursPurchased: 30, HoursUsed: 28.25, Hours_x0020_Remaining2: 1.75, PrimaryContact: 'Ann', Email: 'a@msa.co.uk', ClientFolder: 'MSA', Archived: 'Yes' } };
assert.equal(spRemaining(spClient.fields), 1.75, 'SharePoint’s own Remaining is trusted');
assert.equal(spRemaining({ HoursPurchased: 10, HoursUsed: 4 }), 6);
const cRow = spClientToRow(spClient);
assert.deepEqual(cRow, { sharepoint_id: '7', name: 'MSA Safety', hours_purchased: 30, primary_contact: 'Ann', email: 'a@msa.co.uk',
  client_folder: 'MSA', archived: true, opening_purchased: 30, opening_used: 28.25, opening_remaining: 1.75 });
const spEntry = { id: '101', fields: { ClientLookupId: 7, Engineer: 'Jack', Date: '2026-10-07T23:00:00Z', HoursSpent: 1.25, Title: 'Printer',
  Work_x0020_Type: 'Remote Support', WorkDescription: 'Fixed printer', InternalNotes: 'n', ATERATicketID: '512', Modified: '2026-10-08T09:00:00Z' } };
const ukKey = d => (d.startsWith('2026-10-07T23') ? '2026-10-08' : d.slice(0, 10));
const eRow = spEntryToRow(spEntry, new Map([['7', 1]]), ukKey);
assert.equal(eRow.client_id, 1);
assert.equal(eRow.entry_date, '2026-10-08', 'UK date, not UTC');
assert.equal(eRow.work_type, 'Remote Support');
assert.equal(eRow.atera_id, 512);
assert.equal(eRow.hours, 1.25);

// — Copy waits for the balance flow —
const now = Date.parse('2026-10-08T10:00:00Z');
const young = { id: '9', fields: { ClientLookupId: 7, Created: '2026-10-08T09:59:00Z' } };
assert.equal(copyPlan([spClient], [young], { now }).ok, false, 'an entry under 3 minutes old blocks the copy');
const plan = copyPlan([spClient], [{ id: '12', fields: { ClientLookupId: 7, Created: '2026-10-01T00:00:00Z' } }, { id: '3', fields: { ClientLookupId: 7, Created: '2026-09-01T00:00:00Z' } }, { id: '4', fields: { ClientLookupId: 99 } }], { now });
assert.ok(plan.ok);
assert.deepEqual(plan.entries.map(e => e.id), ['3', '12'], 'SharePoint order kept');
assert.equal(plan.orphanCount, 1);

// — Reconcile after the copy —
const dbClients = [{ id: 1, sharepoint_id: '7', ...cRow }];
const dbEntries = [{ ...eRow, id: 1, opening_hours: 1.25 }];
const rec = reconcileCopy([spClient], [spEntry], dbClients, dbEntries, ukKey);
assert.ok(rec.ok, rec.problems.join('; '));
const bad = reconcileCopy([spClient], [spEntry], dbClients, [{ ...dbEntries[0], hours: 2 }], ukKey);
assert.ok(!bad.ok && bad.problems.some(p => /hours differs/.test(p)));

// — Sync back from Lists —
const synced = { ...eRow, id: 1, opening_hours: 1.25, sp_state: 'synced', sp_modified: '2026-10-08T09:00:00Z' };
const ours = { id: 2, client_id: 1, sharepoint_id: null, entry_date: '2026-10-08', hours: 0.5, engineer: 'Philip', title: 'Call', sp_state: 'failed' };
const s = planSync({
  spClients: [spClient, { id: '8', fields: { Title: 'New Co', HoursPurchased: 10, HoursUsed: 0 } }],
  spEntries: [
    { ...spEntry, fields: { ...spEntry.fields, HoursSpent: 2, Modified: '2026-10-08T11:00:00Z' } },   // edited in Lists
    { id: '102', fields: { ClientLookupId: 7, Engineer: 'Jack', Date: '2026-10-08', HoursSpent: 0.75, Title: 'Power App entry', Modified: '2026-10-08T11:00:00Z' } },
    { id: '103', fields: { ClientLookupId: 7, Engineer: 'Philip', Date: '2026-10-08', HoursSpent: 0.5, Title: 'Call', Modified: '2026-10-08T11:00:00Z' } },
    { id: '104', fields: { ClientLookupId: 8, Engineer: 'Jack', Date: '2026-10-08', HoursSpent: 1 } }
  ],
  dbClients: [{ id: 1, ...cRow, archived: false }],
  dbEntries: [synced, ours, { id: 3, client_id: 1, sharepoint_id: '50', hours: 1, sp_state: 'synced' }],
  dateKey: ukKey
});
assert.deepEqual(s.newClients.map(c => c.name), ['New Co']);
assert.deepEqual(s.clientUpdates, [{ id: 1, patch: { archived: true } }]);
assert.deepEqual(s.newEntries.map(e => e.sharepoint_id), ['102'], 'Power App entry comes in; New Co’s waits for its client');
assert.deepEqual(s.links, [{ id: 2, sharepoint_id: '103', sp_modified: '2026-10-08T11:00:00Z' }], 'our unconfirmed copy is matched, not doubled');
assert.equal(s.entryUpdates.length, 1);
assert.equal(s.entryUpdates[0].hoursDelta, 0.75, 'an hours change in Lists moves the balance');
assert.deepEqual(s.goneFromLists.map(e => e.id), [3], 'gone from Lists: reported only');
// Our own pending change is never overwritten by SharePoint's older copy.
const s2 = planSync({ spClients: [spClient], spEntries: [{ ...spEntry, fields: { ...spEntry.fields, Modified: '2026-10-08T12:00:00Z' } }],
  dbClients: [{ id: 1, ...cRow }], dbEntries: [{ ...synced, sp_state: 'pending', hours: 3 }], dateKey: ukKey });
assert.equal(s2.entryUpdates.length, 0);

// — Shapes for the page —
const pe = rowToEntry({ ...synced, created_at: 'c' }, 'MSA Safety');
assert.equal(pe.clientName, 'MSA Safety');
assert.equal(pe.workDescription, 'Fixed printer');
const pc = rowToClient(dbClients[0], { used: 29, remaining: 1 });
assert.equal(pc.hoursRemaining, 1);
assert.equal(pc.spId, '7');

console.log('timesheets: ok');
