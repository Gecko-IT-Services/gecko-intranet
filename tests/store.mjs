import assert from 'node:assert/strict';

const { TABLES, fieldsToRow, rowToItem, spItemToRow, reconcile } = await import('../src/core/store.js');

// A SharePoint dateOnly value comes back as UTC midnight of the local day
// before (BST); the page turns it into the UK date. Stand-in for spDateToLocalDateKey.
const dateKey = v => (String(v).startsWith('2026-10-12T23') ? '2026-10-13' : String(v).slice(0, 10));

const spItem = {
  id: '41',
  createdDateTime: '2026-09-01T08:00:00Z',
  fields: {
    Title: 'Jack 2026-10-13', Person: 'Jack',
    StartDate: '2026-10-12T23:00:00Z', EndDate: '2026-10-14',
    Hours: 21, Status: 'Approved', LeaveType: 'Annual Leave', Notes: 'Half term',
    RequestedBy: 'Jack Morris', RequestedByEmail: 'jack@gecko-it.com',
    ApprovedBy: 'Philip Morris', ApprovedAt: '2026-09-02T10:00:00Z',
    TaxYear: '2026/27', CreatedByPortal: true,
    Created: '2026-09-01T08:00:00Z', Modified: '2026-09-02T10:00:00Z'
  }
};

// — Copy: every column, SharePoint's own dates and id, UK date for dateOnly. —
const row = spItemToRow('leave_requests', spItem, dateKey);
assert.equal(row.start_date, '2026-10-13', 'dateOnly read as the UK date, like the page');
assert.equal(row.end_date, '2026-10-14');
assert.equal(row.hours, 21);
assert.equal(row.created_by_portal, true);
assert.equal(row.approved_at, '2026-09-02T10:00:00Z');
assert.equal(row.sharepoint_id, '41');
assert.equal(row.modified_at, '2026-09-02T10:00:00Z');
assert.equal(Object.keys(row).length, Object.keys(TABLES.leave_requests.columns).length + 3, 'nothing dropped');

// Missing columns become empty values, never undefined (the table has NOT NULLs).
const bare = spItemToRow('leave_requests', { id: '2', fields: { Person: 'Philip' } }, dateKey);
assert.equal(bare.notes, '');
assert.equal(bare.hours, 0);
assert.equal(bare.start_date, null);
assert.equal(bare.approved_at, null);
assert.equal(bare.created_by_portal, false);

// — Read back: a row becomes the Graph shape the Leave code already maps. —
const dbRow = { id: 7, ...row, approved_at: '2026-09-02T10:00:00+00:00', hours: 21 };
const item = rowToItem('leave_requests', dbRow);
assert.equal(item.id, '7', 'ids are strings, like SharePoint ids');
assert.equal(item.fields.StartDate, '2026-10-13');
assert.equal(item.fields.Hours, 21);
assert.equal(item.fields.Notes, 'Half term');
assert.equal(item.fields.Created, '2026-09-01T08:00:00Z');
assert.equal(rowToItem('leave_requests', { id: 1, approved_at: null }).fields.ApprovedAt, '', 'null → empty');

// — Writes from the page: only the fields given; dates already YYYY-MM-DD. —
assert.deepEqual(fieldsToRow('leave_requests', { Status: 'Cancelled' }), { status: 'Cancelled' });
assert.deepEqual(
  fieldsToRow('leave_requests', { StartDate: '2026-12-24', Hours: '7', CreatedByPortal: true }),
  { start_date: '2026-12-24', hours: 7, created_by_portal: true }
);
assert.throws(() => fieldsToRow('nope', {}), /No mapping/);

// — Reconcile —
assert.equal(reconcile('leave_requests', [row], [dbRow]).ok, true, 'same instant in two formats matches');
const r = reconcile('leave_requests', [row], [{ ...dbRow, hours: 14 }]);
assert.equal(r.ok, false);
assert.deepEqual(r.mismatches, [{ sharepointId: '41', problem: 'hours differs' }]);
assert.deepEqual(r.totals.hours, [21, 14], 'hours totals shown side by side');
assert.equal(reconcile('leave_requests', [row], []).mismatches.length, 2, 'missing row + count gap');
assert.equal(reconcile('leave_requests', [], [dbRow]).ok, false, 'extra row in the database fails');
assert.equal(reconcile('leave_requests', [row], [{ ...dbRow, start_date: '2026-10-12' }]).ok, false, 'a date a day out fails');

const ent = spItemToRow('leave_entitlements',
  { id: '3', fields: { Person: 'Jack', TaxYear: '2026/27', EntitlementHours: 140, CarryOverHours: 7 } }, dateKey);
assert.equal(ent.adjustment_hours, 0);
assert.equal(reconcile('leave_entitlements', [ent], [{ id: 1, ...ent }]).ok, true);

console.log('store: ok');
