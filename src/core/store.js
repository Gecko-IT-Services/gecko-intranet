/**
 * SharePoint list ⇄ Supabase table, one mapping per list.
 *
 * The classic-script sections were written against Graph list items
 * ({ id, fields: { Title, StartDate, … } }). Rather than rewrite each section's
 * logic when it moves, the store hands back the same shape from Supabase, so
 * only the fetch/create/patch calls branch on CONFIG.DATA_BACKEND.
 *
 * Column types: text, date (YYYY-MM-DD), number, timestamp (ISO), bool.
 * Pure functions are unit-tested in tests/store.mjs; nothing touches window
 * at import time.
 */

import { connectSupabase } from './supabase.js';

/** SharePoint field → [Supabase column, type]. One to one, nothing dropped. */
export const TABLES = {
  leave_requests: {
    list: 'GeckoLeaveRequests',
    columns: {
      Title:            ['title',              'text'],
      Person:           ['person',             'text'],
      StartDate:        ['start_date',         'date'],
      EndDate:          ['end_date',           'date'],
      Hours:            ['hours',              'number'],
      Status:           ['status',             'text'],
      LeaveType:        ['leave_type',         'text'],
      Notes:            ['notes',              'text'],
      RequestedBy:      ['requested_by',       'text'],
      RequestedByEmail: ['requested_by_email', 'text'],
      ApprovedBy:       ['approved_by',        'text'],
      ApprovedAt:       ['approved_at',        'timestamp'],
      TaxYear:          ['tax_year',           'text'],
      CreatedByPortal:  ['created_by_portal',  'bool']
    }
  },
  leave_entitlements: {
    list: 'GeckoLeaveEntitlements',
    columns: {
      Person:           ['person',             'text'],
      TaxYear:          ['tax_year',           'text'],
      EntitlementHours: ['entitlement_hours',  'number'],
      CarryOverHours:   ['carry_over_hours',   'number'],
      AdjustmentHours:  ['adjustment_hours',   'number'],
      Notes:            ['notes',              'text']
    }
  },
  mileage_journeys: {
    list: 'MileageJourneys',
    columns: {
      Title:       ['title',        'text'],
      Driver:      ['driver',       'text'],
      JourneyDate: ['journey_date', 'date'],
      Miles:       ['miles',        'number'],
      Purpose:     ['purpose',      'text'],
      Amount:      ['amount',       'number'],
      RateType:    ['rate_type',    'text'],
      ClaimedDate: ['claimed_date', 'date']
    }
  },
  mileage_clients: {
    list: 'MileageClients',
    columns: {
      Title:        ['title',         'text'],
      TypicalMiles: ['typical_miles', 'number']
    }
  }
};

/** Supabase answers at most 1000 rows per request; read in pages so nothing is cut short. */
export const PAGE_ROWS = 1000;

/** Every row of a table, in id order, following pages. `fetchPage(from, to)` → { data, error }. */
export async function selectAllPages(fetchPage) {
  const rows = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const page = must(await fetchPage(from, from + PAGE_ROWS - 1)) || [];
    rows.push(...page);
    if (page.length < PAGE_ROWS) return rows;
  }
}

function selectAll(sb, table) {
  return selectAllPages((from, to) => sb.from(table).select('*').order('id').range(from, to));
}

function spec(table) {
  const s = TABLES[table];
  if (!s) throw new Error(`No mapping for table ${table}`);
  return s;
}

/** One value, SharePoint/page side → database side. */
function toDb(value, type, dateKey) {
  if (type === 'number')    return Number(value) || 0;
  if (type === 'bool')      return value === true || value === 'true' || value === 1;
  if (type === 'date')      return value ? (dateKey ? dateKey(value) : String(value).slice(0, 10)) || null : null;
  if (type === 'timestamp') return value ? String(value) : null;
  return value == null ? '' : String(value);
}

/** One value, database side → the shape the page's SharePoint code expects. */
function toFields(value, type) {
  if (type === 'number') return value == null ? 0 : Number(value);
  if (type === 'bool')   return !!value;
  return value == null ? '' : value;
}

/** Page fields (SharePoint names) → a row. Only fields present are written. */
export function fieldsToRow(table, fields, dateKey) {
  const row = {};
  for (const [field, [column, type]] of Object.entries(spec(table).columns)) {
    if (field in fields) row[column] = toDb(fields[field], type, dateKey);
  }
  return row;
}

/** Row → a Graph-shaped item, so the section's existing mapping reads it unchanged. */
export function rowToItem(table, row) {
  const fields = {};
  for (const [field, [column, type]] of Object.entries(spec(table).columns)) {
    fields[field] = toFields(row[column], type);
  }
  fields.Created  = row.created_at  || '';
  fields.Modified = row.modified_at || '';
  return { id: String(row.id), fields, createdDateTime: row.created_at, lastModifiedDateTime: row.modified_at };
}

/**
 * Graph list item → the row the copy inserts. Missing columns become their
 * empty value; Created/Modified and the item id are kept. `dateKey` turns a
 * SharePoint date into YYYY-MM-DD the same way the page does (UK local date).
 */
export function spItemToRow(table, item, dateKey) {
  const f = item.fields || {};
  const row = {};
  for (const [field, [column, type]] of Object.entries(spec(table).columns)) {
    row[column] = toDb(f[field], type, dateKey);
  }
  row.sharepoint_id = String(item.id);
  row.created_at  = f.Created  || item.createdDateTime      || new Date().toISOString();
  row.modified_at = f.Modified || item.lastModifiedDateTime || row.created_at;
  return row;
}

function same(a, b, type) {
  if (type === 'number')    return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
  if (type === 'timestamp') return (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);
  if (type === 'bool')      return !!a === !!b;
  return (a ?? '') === (b ?? '');
}

/**
 * What SharePoint holds vs what the table now holds, field by field, plus the
 * total of every number column so the result can be read at a glance.
 * → { ok, spCount, dbCount, totals: { column: [sp, db] }, mismatches: [{ sharepointId, problem }] }
 */
export function reconcile(table, spRows, dbRows) {
  const cols = Object.values(spec(table).columns);
  const byId = new Map(dbRows.map(r => [String(r.sharepoint_id), r]));
  const mismatches = [];
  for (const sp of spRows) {
    const db = byId.get(sp.sharepoint_id);
    if (!db) { mismatches.push({ sharepointId: sp.sharepoint_id, problem: 'missing in database' }); continue; }
    for (const [column, type] of cols) {
      if (!same(sp[column], db[column], type)) {
        mismatches.push({ sharepointId: sp.sharepoint_id, problem: `${column} differs` });
      }
    }
  }
  if (dbRows.length !== spRows.length) {
    mismatches.push({ sharepointId: '', problem: `row count ${spRows.length} vs ${dbRows.length}` });
  }
  const totals = {};
  for (const [column, type] of cols) {
    if (type !== 'number') continue;
    const sum = rows => Math.round(rows.reduce((t, r) => t + (Number(r[column]) || 0), 0) * 100) / 100;
    totals[column] = [sum(spRows), sum(dbRows)];
  }
  return { ok: mismatches.length === 0, spCount: spRows.length, dbCount: dbRows.length, totals, mismatches };
}

/** Throws Supabase's error rather than letting a failed call look like no rows. */
function must({ data, error }) {
  if (error) throw new Error(error.message || 'Database request failed');
  return data;
}

// ─── Database calls (browser only) ────────────────────────────────────

export async function listItems(table) {
  const sb = await connectSupabase();
  return (await selectAll(sb, table)).map(row => rowToItem(table, row));
}

export async function createItem(table, fields, dateKey) {
  const sb = await connectSupabase();
  return rowToItem(table, must(await sb.from(table).insert(fieldsToRow(table, fields, dateKey)).select('*').single()));
}

/** `.single()` makes a patch that touched no row (gone, or refused) an error. */
export async function patchItem(table, id, fields, dateKey) {
  const sb = await connectSupabase();
  must(await sb.from(table).update(fieldsToRow(table, fields, dateKey)).eq('id', id).select('id').single());
}

export async function deleteItem(table, id) {
  spec(table);
  const sb = await connectSupabase();
  must(await sb.from(table).delete().eq('id', id).select('id').single());
}

/**
 * Replace the table with these SharePoint items, read it back and reconcile.
 * Only offered while SharePoint is still the live store for the section.
 * ponytail: delete-then-insert is not one transaction; a failure halfway
 * shows as a mismatch and the copy is run again.
 */
export async function copyFromSharePoint(table, items, dateKey) {
  const sb = await connectSupabase({ interactive: true });
  const spRows = items.map(item => spItemToRow(table, item, dateKey));
  must(await sb.from(table).delete().not('id', 'is', null));
  if (spRows.length) must(await sb.from(table).insert(spRows));
  return reconcile(table, spRows, await selectAll(sb, table));
}
