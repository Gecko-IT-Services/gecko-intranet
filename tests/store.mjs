import assert from 'node:assert/strict';

const { TABLES, fieldsToRow, rowToItem, spItemToRow, reconcile, selectAllPages, PAGE_ROWS } =
  await import('../src/core/store.js');

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

// — Mileage: miles and £ totals, unclaimed = null claimed_date both ways. —
const journey = spItemToRow('mileage_journeys', { id: '9', fields: {
  Title: 'CDA Ltd', Driver: 'Jack Morris', JourneyDate: '2026-10-12T23:00:00Z',
  Miles: 22, Purpose: 'Server swap', Amount: 9.9, RateType: '45p'
} }, dateKey);
assert.equal(journey.journey_date, '2026-10-13');
assert.equal(journey.claimed_date, null, 'no ClaimedDate = unclaimed');
assert.equal(rowToItem('mileage_journeys', { id: 3, ...journey }).fields.ClaimedDate, '', 'reads back as unclaimed');
assert.deepEqual(fieldsToRow('mileage_journeys', { ClaimedDate: null }), { claimed_date: null }, 'un-claim clears it');
assert.deepEqual(fieldsToRow('mileage_journeys', { ClaimedDate: '2026-10-07' }), { claimed_date: '2026-10-07' });
const jr = reconcile('mileage_journeys', [journey, { ...journey, sharepoint_id: '10', miles: 8, amount: 3.6 }],
  [{ id: 1, ...journey }, { id: 2, ...journey, sharepoint_id: '10', miles: 8, amount: 3.6 }]);
assert.equal(jr.ok, true);
assert.deepEqual(jr.totals, { miles: [30, 30], amount: [13.5, 13.5] });
assert.equal(reconcile('mileage_journeys', [journey], [{ id: 1, ...journey, amount: 9.91 }]).ok, false, 'a penny out fails');

// — Clients/services: XeroHistory JSON copied byte for byte; money totals. —
const xh = '{"2026-09":{"total":265.51,"recurring":215.9,"oneOff":49.61}}';
const client = spItemToRow('gecko_clients', { id: '5', fields: {
  Title: 'Technix', Status: 'Active', ContractStart: '2025-12-31T23:00:00Z', XeroHistory: xh
} }, v => (String(v).startsWith('2025-12-31T23') ? '2026-01-01' : String(v).slice(0, 10)));
assert.equal(client.xero_history, xh, 'XeroHistory text untouched');
assert.equal(client.contract_start, '2026-01-01');
assert.equal(rowToItem('gecko_clients', { id: 1, ...client }).fields.XeroHistory, xh);
assert.equal(spItemToRow('gecko_clients', { id: '6', fields: { Title: 'New' } }, dateKey).contract_start, null);
assert.deepEqual(fieldsToRow('gecko_clients', { ContractStart: null }), { contract_start: null }, 'clearing a start date');
assert.equal(reconcile('gecko_clients', [client], [{ id: 1, ...client, xero_history: xh.replace('265.51', '265.5') }]).ok,
  false, 'any change to XeroHistory fails');
const svc = spItemToRow('gecko_services', { id: '8', fields: {
  Title: 'Retainer', ClientName: 'Technix', Category: 'retainer', CostPerMonth: 0, SellPerMonth: 210.9
} }, dateKey);
const sr = reconcile('gecko_services', [svc], [{ id: 1, ...svc }]);
assert.equal(sr.ok, true);
assert.deepEqual(sr.totals, { cost_per_month: [0, 0], sell_per_month: [210.9, 210.9] });

// — Paging: Supabase caps a response at 1000 rows; every row must still arrive. —
const all = Array.from({ length: 2345 }, (_, i) => ({ id: i + 1 }));
const calls = [];
const got = await selectAllPages(async (from, to) => { calls.push([from, to]); return { data: all.slice(from, to + 1), error: null }; });
assert.equal(got.length, 2345, 'all rows across pages');
assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
const exact = await selectAllPages(async (from, to) => ({ data: all.slice(0, PAGE_ROWS).slice(from, to + 1), error: null }));
assert.equal(exact.length, PAGE_ROWS, 'exactly one full page then an empty one');
await assert.rejects(selectAllPages(async () => ({ data: null, error: { message: 'boom' } })), /boom/, 'errors are thrown, not empty');

console.log('store: ok');
