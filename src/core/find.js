/* Quick find: pure logic (no window). Tested in tests/find.mjs.
   Design: docs/superpowers/specs/2026-10-12-quick-find-design.md

   One rule everywhere: every word typed must match the start of a word in the row's text. The lists
   small enough to hold (clients, people, jobs, deals, prospects, tasks, pages, actions) are searched
   here; invoices and timesheet entries are asked for from the database and then put through the same rule. */

import { OPEN_STAGES, stageLabel } from './jobs.js';
import { STAGES as PROSPECT_STAGES } from './prospects.js';
import { sameClient } from './client.js';
import { dueLabel } from './tasks.js';

export const PER_GROUP = 5;        // results shown per group
export const REMOTE_ROWS = 50;     // newest rows asked of the database per search
export const REMOTE_MIN = 3;       // characters before the database is asked (2 when they are digits)

/** The everyday actions. `open` says what choosing one does: a page to go to, or something the page layer runs. */
export const ACTIONS = [
  { label: 'Log time', words: 'timesheet hours', open: { kind: 'page', section: 'timesheets', tab: 'log' } },
  { label: 'Add task', words: 'new to-do todo', open: { kind: 'action', run: 'task' } },
  { label: 'Add a job', words: 'new quote', open: { kind: 'action', run: 'job' } }
];

/** Every page and tab that can be gone to. tests/find.mjs checks each one still exists. */
export const PAGES = [
  ['Overview › Today', 'overview', 'today'], ['Overview › This week', 'overview', 'week'],
  ['Overview › Month-end', 'overview', 'monthend'], ['Overview › Business', 'overview', 'business'],
  ['Analytics › Revenue', 'analytics', 'revenue'], ['Analytics › Time', 'analytics', 'time'], ['Analytics › Ahead', 'analytics', 'ahead'],
  ['Clients › Directory', 'clients'], ['Clients › Profitability', 'profitability'], ['Clients › Licences', 'licences'], ['Clients › Atera', 'atera'],
  ['Opportunities › Pipeline', 'opportunities', 'pipeline'], ['Opportunities › Gaps', 'opportunities', 'gaps'],
  ['Opportunities › Prospects', 'opportunities', 'prospects'], ['Opportunities › VoIP Unlimited', 'opportunities', 'voip'],
  ['Opportunities › Products', 'opportunities', 'products'],
  ['Jobs › Jobs', 'jobs', 'jobs'], ['Jobs › This month', 'jobs', 'month'], ['Jobs › Owed to us', 'jobs', 'owed'],
  ['Timesheets › Log time', 'timesheets', 'log'], ['Timesheets › SSA dashboard', 'timesheets', 'ssa'], ['Timesheets › Weekly summary', 'timesheets', 'week'],
  ['Monitoring › Backups', 'backups'], ['Monitoring › Alerts', 'alerts'], ['Monitoring › Devices', 'devices'],
  ['Team › Overview', 'team'], ['Team › Leave', 'leave'], ['Team › Mileage', 'mileage'],
  ['Settings', 'settings'], ['Settings › Change log', 'settings']
].map(([label, section, tab = '']) => ({ label, open: { kind: 'page', section, tab } }));

const DEAL_LABEL = { idea: 'Idea', proposed: 'Proposed', won: 'Won', lost: 'Lost' };
const PROSPECT_LABEL = Object.fromEntries(PROSPECT_STAGES);
const day = d => String(d || '').slice(0, 10);
const pounds = n => '£' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const shortDate = d => (day(d) ? new Date(day(d) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
const join = parts => parts.filter(Boolean).join(' · ');

/** Lower-case words of a text: letters and digits, split on everything else ("INV-0131" → inv, 0131). */
export const words = text => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well a query matches: 2 = every word starts a word of `name`; 1 = every word starts a word of
 * `name` or `extra`; 0 = no match (or nothing typed).
 */
export function matchLevel(query, name, extra = '') {
  const q = words(query);
  if (!q.length) return 0;
  const inName = words(name), inExtra = words(extra);
  const starts = (list, w) => list.some(x => x.startsWith(w));
  if (q.every(w => starts(inName, w))) return 2;
  return q.every(w => starts(inName, w) || starts(inExtra, w)) ? 1 : 0;
}

/** Best first: a match in the name, then the shorter name, then A to Z. Returns at most `limit` rows. */
function best(items, query, toRow, limit = PER_GROUP) {
  return items.map(it => ({ it, row: toRow(it) }))
    .map(x => ({ ...x, level: matchLevel(query, x.row.title, x.row.match ?? x.row.sub) }))
    .filter(x => x.level)
    .sort((a, b) => b.level - a.level || a.row.title.length - b.row.title.length || a.row.title.localeCompare(b.row.title))
    .slice(0, limit)
    .map(({ row }) => ({ title: row.title, sub: row.sub || '', open: row.open }));
}

/** Client names from the two lists that hold them, one per client whatever the spelling. */
export function clientNames(geckoClients, ssaClients) {
  const out = [];
  for (const n of [...(geckoClients || []).map(c => c.title), ...(ssaClients || []).map(c => c.name)]) {
    const name = String(n || '').trim();
    if (name && !out.some(x => sameClient(x, name))) out.push(name);
  }
  return out;
}

/**
 * Search what is held in the browser. `index` = { clients: [name], contacts, jobs, deals, prospects, tasks }
 * (a list that did not load is null and is simply not searched). Returns the groups that have rows, in
 * display order: [{ key, label, rows: [{ title, sub, open }] }]. Nothing typed: the actions only.
 */
export function search(index, query, today) {
  const ix = index || {};
  const actions = ACTIONS.map(a => ({ title: a.label, sub: '', match: a.words, open: a.open }));
  if (!words(query).length) return [{ key: 'actions', label: 'Actions', rows: actions.map(({ title, sub, open }) => ({ title, sub, open })) }];
  const client = (name, tab = '') => ({ kind: 'client', name, tab });
  const jobsAndDeals = [
    ...(ix.jobs || []).map(j => ({
      title: j.title, sub: join([j.client_name, `job, ${stageLabel(j.status).toLowerCase()}`, j.value == null ? '' : pounds(j.value)]),
      match: j.client_name,
      open: OPEN_STAGES.has(j.status) ? { kind: 'job', id: j.id } : client(j.client_name, 'jobs')
    })),
    ...(ix.deals || []).map(d => ({
      title: d.title, sub: join([d.client_name, `deal, ${(DEAL_LABEL[d.status] || d.status || '').toLowerCase()}`, Number(d.mrr) ? pounds(d.mrr) + '/mo' : '']),
      match: d.client_name,
      open: d.status === 'idea' || d.status === 'proposed' ? { kind: 'deal', id: d.id } : client(d.client_name, 'opportunities')
    }))
  ];
  const groups = [
    ['clients', 'Clients', best(ix.clients || [], query, name => ({ title: name, sub: '', open: client(name) }))],
    ['people', 'People', best(ix.contacts || [], query, c => ({
      title: c.name || c.email, sub: join([c.client_name, c.role]), match: join([c.email, c.client_name]), open: client(c.client_name, 'contacts')
    }))],
    ['jobs', 'Jobs and deals', best(jobsAndDeals, query, x => x)],
    ['prospects', 'Prospects', best(ix.prospects || [], query, p => ({
      title: p.company, sub: join([p.contact_name, PROSPECT_LABEL[p.stage] || p.stage]), match: p.contact_name, open: { kind: 'prospect', id: p.id }
    }))],
    ['tasks', 'Tasks', best((ix.tasks || []).filter(t => !t.done_at && !t._done), query, t => ({
      title: t.title, sub: join([t.client_name, t.assigned_to, t.due_on ? dueLabel(t.due_on, today) : '']), match: join([t.note, t.client_name]), open: { kind: 'task', id: t.id }
    }))],
    ['pages', 'Pages', best(PAGES, query, p => ({ title: p.label, sub: '', open: p.open }))],
    ['actions', 'Actions', best(actions, query, a => a)]
  ];
  return groups.filter(([, , rows]) => rows.length).map(([key, label, rows]) => ({ key, label, rows }));
}

/** Words safe to send to the database: letters and digits only (as `words()` splits them), at most four, each at most 40 characters. */
export const remoteWords = query => words(query).map(w => w.slice(0, 40)).slice(0, 4);

/** Is there enough typed to ask the database? One word of three characters, or of two digits (an invoice number). */
export function remoteReady(query) {
  return remoteWords(query).some(w => w.length >= REMOTE_MIN || /^\d{2,}$/.test(w));
}

/**
 * The PostgREST `or` filters for one query: one string per word, each an OR across the columns searched (the strings
 * are ANDed by the database). Words are letters and digits only (`words()`), so nothing typed can change a filter.
 */
export function remoteFilters(query) {
  const ws = remoteWords(query);
  return {
    invoices: ws.map(w => `invoice_number.ilike.%${w}%,contact_name.ilike.%${w}%,reference.ilike.%${w}%`),
    entries: ws.map(w => `title.ilike.%${w}%,work_description.ilike.%${w}%`)
  };
}

/** paid / draft / overdue / due, the same reading as the client page's Invoices tab. */
export function invoiceState(inv, today) {
  if (inv.status === 'PAID' || Number(inv.amount_due) <= 0) return 'paid';
  if (inv.status === 'DRAFT' || inv.status === 'SUBMITTED') return 'draft';
  return inv.due_date && day(inv.due_date) < today ? 'overdue' : 'due';
}

/** Invoices the database returned, kept only where the rule matches; newest first. Digits alone also match the end of a number. */
export function invoiceRows(invoices, query, today) {
  const digits = /^\d+$/.test(String(query || '').trim()) ? String(query).trim() : '';
  return (invoices || [])
    .filter(i => (digits && String(i.invoice_number || '').endsWith(digits)) || matchLevel(query, [i.invoice_number, i.contact_name].filter(Boolean).join(' '), i.reference || ''))
    .sort((a, b) => day(b.invoice_date).localeCompare(day(a.invoice_date)))
    .slice(0, PER_GROUP)
    .map(i => ({
      title: i.invoice_number || 'No number', sub: join([i.contact_name, shortDate(i.invoice_date), money(i.total), invoiceState(i, today)]),
      open: { kind: 'client', name: i.contact_name, tab: 'invoices' }
    }));
}

/**
 * Timesheet entries the database returned, kept only where the rule matches; newest first. Work only:
 * deleted entries and System entries (renewal credits, adjustments) are left out, as Weekly Summary leaves them out.
 * `clientsById` maps ssa_clients.id → name (an entry holds only the id).
 */
export function entryRows(entries, query, clientsById) {
  const text = e => String(e.work_description || '').split('\n').find(l => l.trim())?.trim() || e.title || '';
  return (entries || [])
    .filter(e => !e.deleted_at && !/^system$/i.test(String(e.engineer || '').trim()))
    .filter(e => matchLevel(query, [e.title, e.work_description].filter(Boolean).join(' ')))
    .sort((a, b) => day(b.entry_date).localeCompare(day(a.entry_date)))
    .slice(0, PER_GROUP)
    .map(e => {
      const name = clientsById?.get(String(e.client_id)) || '';
      return {
        title: text(e), sub: join([name, shortDate(e.entry_date), e.engineer, `${Number(e.hours) || 0}h`]),
        open: name ? { kind: 'client', name, tab: 'support' } : { kind: 'page', section: 'timesheets', tab: 'week' }
      };
    });
}
