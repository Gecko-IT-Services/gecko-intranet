/**
 * Timesheets and SSA balances on Supabase, with SharePoint kept as a full backup.
 * Design: docs/superpowers/specs/2026-10-08-timesheets-on-supabase-design.md
 *
 * Pure functions first (tested in tests/timesheets.mjs), then the database calls
 * the classic script uses through window.GeckoTimesheets. Nothing touches window
 * at import time.
 *
 * The balance rule (Philip, 7 Oct 2026: balances are never recalculated from
 * history): each client keeps the Hours Used / Remaining it had when copied
 * (opening_*), and each copied entry its hours then (opening_hours). A balance
 * moves only by what changed since:
 *   change = (deleted ? 0 : hours) - (opening_hours ?? 0)
 */

import { connectSupabase } from './supabase.js';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => (v === '' || v == null ? 0 : Number(v) || 0);

// ─── Hours ────────────────────────────────────────────────────────────

/** Work is logged in quarter hours. Credits and adjustments may be negative; never zero. */
export function validHours(h, { allowNegative = false } = {}) {
  const n = Number(h);
  if (!Number.isFinite(n) || n === 0) return false;
  if (!allowNegative && n < 0) return false;
  return Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;
}

/** What an entry has moved its client's balance by since the copy. */
export function entryChange(e) {
  return round2((e.deleted_at ? 0 : num(e.hours)) - num(e.opening_hours));
}

/** Map(client id → { used, remaining, purchased }) from clients and entries (rows). */
export function balances(clients, entries) {
  const change = new Map();
  for (const e of entries) change.set(String(e.client_id), round2((change.get(String(e.client_id)) || 0) + entryChange(e)));
  const out = new Map();
  for (const c of clients) {
    const d = change.get(String(c.id)) || 0;
    out.set(String(c.id), {
      purchased: num(c.hours_purchased),
      used: round2(num(c.opening_used) + d),
      remaining: round2(num(c.opening_remaining) + (num(c.hours_purchased) - num(c.opening_purchased)) - d)
    });
  }
  return out;
}

// ─── SharePoint item → row ───────────────────────────────────────────

const isTrue = v => v === true || v === 1 || (typeof v === 'string' && ['true', 'yes', '1'].includes(v.trim().toLowerCase()));

/** The Clients list's Hours Remaining (calculated column), or purchased − used when absent. */
export function spRemaining(f) {
  const r = f.Hours_x0020_Remaining2;
  if (r === undefined || r === null || r === '') return round2(num(f.HoursPurchased) - num(f.HoursUsed));
  return Number.isFinite(Number(r)) ? round2(Number(r)) : round2(num(f.HoursPurchased) - num(f.HoursUsed));
}

/** Clients list item → ssa_clients row (descriptive fields; opening_* only for a new client). */
export function spClientToRow(item, { opening = true } = {}) {
  const f = item.fields || {};
  const row = {
    sharepoint_id: String(item.id),
    name: String(f.Title || ''),
    hours_purchased: num(f.HoursPurchased),
    primary_contact: String(f.PrimaryContact || ''),
    email: String(f.Email || ''),
    client_folder: String(f.ClientFolder || ''),
    archived: isTrue(f.Archived)
  };
  if (opening) {
    row.opening_purchased = num(f.HoursPurchased);
    row.opening_used = num(f.HoursUsed);
    row.opening_remaining = spRemaining(f);
  }
  return row;
}

/** First defined value among SharePoint's spellings of a column. */
function pick(f, names) {
  for (const n of names) if (n && f[n] !== undefined && f[n] !== null) return f[n];
  return undefined;
}
function workTypeOf(f) {
  let wt = pick(f, ['WorkType', 'Work_x0020_Type', 'Work Type']) || '';
  if (!wt) for (const k of Object.keys(f)) if (k.toLowerCase().replace(/[_\s]/g, '').includes('worktype') && f[k]) { wt = f[k]; break; }
  return String(wt || '');
}

/**
 * Timesheets list item → timesheet_entries row. `clientIdBySp` maps the
 * Clients item id (ClientLookupId) to ssa_clients.id; `dateKey` turns a
 * SharePoint date into YYYY-MM-DD as the page reads it (UK local date).
 */
export function spEntryToRow(item, clientIdBySp, dateKey) {
  const f = item.fields || {};
  const atera = pick(f, ['ATERATicketID', 'ATERA_x0020_Ticket_x0020_ID', 'ATERA Ticket ID']);
  return {
    sharepoint_id: String(item.id),
    client_id: clientIdBySp.get(String(f.ClientLookupId)) ?? null,
    engineer: String(f.Engineer || ''),
    entry_date: f.Date ? (dateKey ? dateKey(f.Date) : String(f.Date).slice(0, 10)) || null : null,
    hours: round2(num(pick(f, ['HoursSpent', 'Hours_x0020_Spent', 'Hours Spent']))),
    title: String(f.Title || ''),
    work_type: workTypeOf(f),
    work_description: String(pick(f, ['WorkDescription', 'Work_x0020_Description', 'Work Description']) ?? ''),
    internal_notes: String(pick(f, ['InternalNotes', 'Internal_x0020_Notes', 'Internal Notes']) || ''),
    atera_id: atera == null || atera === '' || !Number.isFinite(Number(atera)) ? null : Number(atera),
    archived: isTrue(f.Archived),
    sp_modified: f.Modified || item.lastModifiedDateTime || null
  };
}

/** The fields of an entry the two sides must agree on. */
export const ENTRY_FIELDS = ['client_id', 'engineer', 'entry_date', 'hours', 'title', 'work_type', 'work_description', 'internal_notes', 'atera_id', 'archived'];
const sameValue = (a, b) => (typeof a === 'number' || typeof b === 'number')
  ? Math.abs(num(a) - num(b)) < 0.005 : String(a ?? '') === String(b ?? '');

// ─── Copy (cut-over) ─────────────────────────────────────────────────

/**
 * The cut-over copy: SharePoint clients and entries → rows with opening
 * balances. Refuses while an entry is under `settleMs` old, because the
 * balance flow may not have added it to Hours Used yet.
 */
export function copyPlan(spClients, spEntries, { now = Date.now(), settleMs = 3 * 60000, dateKey } = {}) {
  const fresh = spEntries.filter(it => {
    const c = Date.parse(it.fields?.Created || it.createdDateTime || '');
    return Number.isFinite(c) && now - c < settleMs;
  });
  if (fresh.length) return { ok: false, reason: `An entry was logged ${Math.max(1, Math.round((now - Date.parse(fresh[0].fields?.Created || fresh[0].createdDateTime)) / 60000))} minute(s) ago. SharePoint may not have added it to the balance yet; wait 3 minutes and copy again.` };
  const clients = spClients.map(it => spClientToRow(it)).filter(c => c.name);
  const known = new Set(clients.map(c => c.sharepoint_id));
  const orphan = spEntries.filter(it => !known.has(String(it.fields?.ClientLookupId)));
  return {
    ok: true, clients, orphanCount: orphan.length,
    // Entries keep SharePoint's order (the renewal email sorts by id within a day).
    entries: spEntries.filter(it => known.has(String(it.fields?.ClientLookupId)))
      .sort((a, b) => Number(a.id) - Number(b.id))
  };
}

/** After the copy: does every client's balance and every entry match SharePoint? */
export function reconcileCopy(spClients, spEntries, dbClients, dbEntries, dateKey) {
  const problems = [];
  const bySp = new Map(dbClients.map(c => [String(c.sharepoint_id), c]));
  const bal = balances(dbClients, dbEntries);
  for (const it of spClients) {
    const f = it.fields || {};
    if (!String(f.Title || '')) continue;
    const c = bySp.get(String(it.id));
    if (!c) { problems.push(`${f.Title}: missing`); continue; }
    const b = bal.get(String(c.id));
    if (Math.abs(b.used - num(f.HoursUsed)) > 0.005) problems.push(`${f.Title}: used ${num(f.HoursUsed)} vs ${b.used}`);
    if (Math.abs(b.remaining - spRemaining(f)) > 0.005) problems.push(`${f.Title}: remaining ${spRemaining(f)} vs ${b.remaining}`);
  }
  const clientIdBySp = new Map(dbClients.map(c => [String(c.sharepoint_id), c.id]));
  const dbBySp = new Map(dbEntries.map(e => [String(e.sharepoint_id), e]));
  let spHours = 0, dbHours = 0, counted = 0;
  for (const it of spEntries) {
    const sp = spEntryToRow(it, clientIdBySp, dateKey);
    if (sp.client_id == null) continue;
    counted += 1;
    spHours += sp.hours;
    const db = dbBySp.get(sp.sharepoint_id);
    if (!db) { problems.push(`entry ${sp.sharepoint_id}: missing`); continue; }
    dbHours += num(db.hours);
    for (const k of ENTRY_FIELDS) if (!sameValue(sp[k], db[k])) problems.push(`entry ${sp.sharepoint_id}: ${k} differs`);
  }
  return {
    ok: problems.length === 0 && counted === dbEntries.length,
    clients: dbClients.length, entries: dbEntries.length, spEntries: counted,
    hours: [round2(spHours), round2(dbHours)], problems
  };
}

// ─── Keeping the two sides together after the move ────────────────────

/**
 * What to bring across from SharePoint on each load:
 * - clients added in Lists (with their balance then as opening) and changes to
 *   the details kept there (name, purchased, contact, email, folder, archived)
 * - entries added in Lists or the Power App (counted in the balance as new)
 * - entries changed in Lists since we last saw them (an hours change moves the balance)
 * - entries gone from Lists: reported, never removed automatically
 * An entry made here whose copy to SharePoint wasn't confirmed is matched by its
 * content rather than added twice.
 */
export function planSync({ spClients, spEntries, dbClients, dbEntries, dateKey }) {
  const clientBySp = new Map(dbClients.map(c => [String(c.sharepoint_id), c]));
  const newClients = [], clientUpdates = [];
  for (const it of spClients) {
    const row = spClientToRow(it, { opening: false });
    if (!row.name) continue;
    const c = clientBySp.get(row.sharepoint_id);
    if (!c) { newClients.push(spClientToRow(it)); continue; }
    const patch = {};
    for (const k of ['name', 'hours_purchased', 'primary_contact', 'email', 'client_folder', 'archived']) {
      if (!sameValue(row[k], c[k])) patch[k] = row[k];
    }
    if (Object.keys(patch).length) clientUpdates.push({ id: c.id, patch });
  }

  const clientIdBySp = new Map(dbClients.map(c => [String(c.sharepoint_id), c.id]));
  const entryBySp = new Map(dbEntries.filter(e => e.sharepoint_id).map(e => [String(e.sharepoint_id), e]));
  const unlinked = dbEntries.filter(e => !e.sharepoint_id && !e.deleted_at);
  const newEntries = [], links = [], entryUpdates = [];
  const seen = new Set();
  for (const it of spEntries) {
    const row = spEntryToRow(it, clientIdBySp, dateKey);
    seen.add(row.sharepoint_id);
    const db = entryBySp.get(row.sharepoint_id);
    if (!db) {
      if (row.client_id == null) continue;   // its client is new too: brought across first, entry on the next pass
      const twin = unlinked.find(e => String(e.client_id) === String(row.client_id) && e.entry_date === row.entry_date &&
        sameValue(e.hours, row.hours) && e.engineer === row.engineer && e.title === row.title);
      if (twin) { unlinked.splice(unlinked.indexOf(twin), 1); links.push({ id: twin.id, sharepoint_id: row.sharepoint_id, sp_modified: row.sp_modified }); continue; }
      newEntries.push(row);
      continue;
    }
    if (db.deleted_at || db.sp_state !== 'synced') continue;   // our change is still on its way to SharePoint
    const spTime = Date.parse(row.sp_modified || ''), ourTime = Date.parse(db.sp_modified || '');
    if (!(spTime > ourTime + 1000)) continue;   // nothing new on SharePoint's side
    const patch = {};
    for (const k of ENTRY_FIELDS) if (k !== 'client_id' && !sameValue(row[k], db[k])) patch[k] = row[k];
    entryUpdates.push({ id: db.id, patch, sp_modified: row.sp_modified, hoursDelta: 'hours' in patch ? round2(row.hours - num(db.hours)) : 0 });
  }
  const goneFromLists = dbEntries.filter(e => e.sharepoint_id && !e.deleted_at && !seen.has(String(e.sharepoint_id)));
  return { newClients, clientUpdates, newEntries, links, entryUpdates, goneFromLists };
}

/** Entries whose copy to SharePoint is outstanding (made here while SharePoint was unreachable). */
export function pendingSync(entries) {
  return entries.filter(e => e.sp_state !== 'synced');
}

// ─── Shapes the existing page code reads ──────────────────────────────

/** Row → the object TSH.entries holds. */
export function rowToEntry(e, clientName) {
  return {
    id: String(e.id), dbId: e.id, spId: e.sharepoint_id || null,
    clientName, clientLookupId: e.client_id,
    engineer: e.engineer, date: e.entry_date || '', hours: num(e.hours),
    workType: e.work_type, description: e.title,
    workDescription: e.work_description || e.title || '',
    internalNotes: e.internal_notes, ateraId: e.atera_id,
    archived: !!e.archived, created: e.created_at, spState: e.sp_state, spError: e.sp_error
  };
}

/** Row + balance → the object TSH.ssaClients / OVW / CLI hold. */
export function rowToClient(c, bal) {
  return {
    id: String(c.id), dbId: c.id, spId: c.sharepoint_id, name: c.name,
    hoursPurchased: num(c.hours_purchased), hoursUsed: bal?.used ?? num(c.opening_used),
    hoursRemaining: bal?.remaining ?? num(c.opening_remaining),
    primaryContact: c.primary_contact, email: c.email, clientFolder: c.client_folder, archived: !!c.archived
  };
}

// ─── Database calls (browser only) ────────────────────────────────────

const PAGE = 1000;
function must({ data, error }) {
  if (error) throw new Error(error.message || 'Database request failed');
  return data;
}
async function all(sb, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = must(await sb.from(table).select('*').order('id').range(from, from + PAGE - 1)) || [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Every client and entry (deleted entries included: they carry balance changes). */
export async function loadAll() {
  const sb = await connectSupabase();
  const [clients, entries] = await Promise.all([all(sb, 'ssa_clients'), all(sb, 'timesheet_entries')]);
  return { clients, entries, balances: balances(clients, entries) };
}

export async function insertEntry(row) {
  const sb = await connectSupabase({ interactive: true });
  return must(await sb.from('timesheet_entries').insert(row).select('*').single());
}
export async function updateEntry(id, patch) {
  const sb = await connectSupabase({ interactive: true });
  return must(await sb.from('timesheet_entries').update(patch).eq('id', id).select('*').single());
}
export async function updateClient(id, patch) {
  const sb = await connectSupabase({ interactive: true });
  return must(await sb.from('ssa_clients').update(patch).eq('id', id).select('*').single());
}
export async function insertClients(rows) {
  if (!rows.length) return [];
  const sb = await connectSupabase({ interactive: true });
  return must(await sb.from('ssa_clients').upsert(rows, { onConflict: 'sharepoint_id', ignoreDuplicates: true }).select('*'));
}
export async function insertEntries(rows) {
  if (!rows.length) return [];
  const sb = await connectSupabase({ interactive: true });
  return must(await sb.from('timesheet_entries').upsert(rows, { onConflict: 'sharepoint_id', ignoreDuplicates: true }).select('*'));
}

/**
 * The cut-over: replace both tables with SharePoint as it stands, then read
 * back and reconcile. Philip only, while SharePoint is still the live store.
 * ponytail: delete-then-insert is not one transaction; a failure halfway shows
 * as a mismatch and the copy is simply run again.
 */
export async function copyFromSharePoint(spClients, spEntries, dateKey) {
  const plan = copyPlan(spClients, spEntries, { dateKey });
  if (!plan.ok) return { ok: false, problems: [plan.reason] };
  const sb = await connectSupabase({ interactive: true });
  must(await sb.from('timesheet_entries').delete().not('id', 'is', null));
  must(await sb.from('ssa_clients').delete().not('id', 'is', null));
  const opened = new Date().toISOString();
  const clients = must(await sb.from('ssa_clients').insert(plan.clients.map(c => ({ ...c, opened_at: opened }))).select('*'));
  const clientIdBySp = new Map(clients.map(c => [String(c.sharepoint_id), c.id]));
  const rows = plan.entries.map(it => {
    const r = spEntryToRow(it, clientIdBySp, dateKey);
    return { ...r, opening_hours: r.hours, sp_state: 'synced', created_at: it.fields?.Created || it.createdDateTime || opened };
  });
  for (let i = 0; i < rows.length; i += 500) must(await sb.from('timesheet_entries').insert(rows.slice(i, i + 500)));
  const back = { clients: await all(sb, 'ssa_clients'), entries: await all(sb, 'timesheet_entries') };
  const result = reconcileCopy(spClients, spEntries, back.clients, back.entries, dateKey);
  if (plan.orphanCount) result.problems.push(`${plan.orphanCount} SharePoint entries point at no client and were left out`);
  return result;
}

/**
 * Database rows → SharePoint-shaped items ({ id, fields }), for readers that
 * only need to read (Opportunities): ids are the database ids, ClientLookupId
 * points at ssa_clients.id, balances are the database's.
 */
export function asSpItems({ clients, entries, balances: bal }) {
  const clientItems = clients.map(c => {
    const b = bal.get(String(c.id)) || {};
    return { id: String(c.id), fields: {
      Title: c.name, HoursPurchased: num(c.hours_purchased), HoursUsed: b.used ?? num(c.opening_used),
      Hours_x0020_Remaining2: b.remaining ?? num(c.opening_remaining), PrimaryContact: c.primary_contact,
      Email: c.email, ClientFolder: c.client_folder, Archived: !!c.archived
    } };
  });
  const entryItems = entries.filter(e => !e.deleted_at).map(e => ({ id: String(e.id), fields: {
    ClientLookupId: e.client_id, Date: e.entry_date, HoursSpent: num(e.hours), Title: e.title,
    WorkDescription: e.work_description, Engineer: e.engineer, Archived: !!e.archived, Created: e.created_at
  } }));
  return { clientItems, entryItems };
}
