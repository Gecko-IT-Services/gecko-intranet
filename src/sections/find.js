/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   QUICK FIND                                                      ║
   ║                                                                   ║
   ║   One box (⌘K, the sidebar's Find row, the phone's search         ║
   ║   button) that goes straight to a client, person, job, deal,      ║
   ║   prospect, task, page, invoice or timesheet entry, or runs an    ║
   ║   everyday action. Part of the shell, not a page.                 ║
   ║   Logic: core/find.js. Styles: system.css "11 · Quick find".      ║
   ║   Design: docs/superpowers/specs/2026-10-12-quick-find-design.md  ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { escapeHtml } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { icon } from '../core/icons.js';
import { search, clientNames, remoteWords, remoteReady, invoiceRows, entryRows, REMOTE_ROWS } from '../core/find.js';
import { read as readTasks, put as putTasks, view as taskView, state as taskState, openTask, newTask } from './tasks.js';
import { open as openJob, add as addJob } from './jobs.js';
import { open as openDeal, openProspect } from './opportunities.js';

const STALE_MS = 5 * 60000;    // the lists are read again on opening after this long
const DEBOUNCE_MS = 250;       // wait this long after the last keystroke before asking the database
const GROUP_ICON = { clients: 'building', people: 'user', jobs: 'briefcase', prospects: 'user', tasks: 'check', pages: 'right', actions: 'plus', invoices: 'file', entries: 'clock' };
const SOURCE_LABEL = { gecko: 'clients', ssa: 'support clients', contacts: 'people', jobs: 'jobs', deals: 'deals', prospects: 'prospects' };
const NO_REMOTE = () => ({ q: '', invoices: null, entries: null, errors: {}, busy: false });

// index: the small lists, read once ({ clients, contacts, jobs, deals, prospects }; a list that failed is null).
// rows: the results on screen, flat, in order; sel: the selected one. seq: discards a reply to an older query.
const QF = { index: null, clientsById: new Map(), at: 0, loading: false, errors: {}, needsConnect: false, q: '', rows: [], sel: 0, seq: 0, timer: 0, remote: NO_REMOTE() };

const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const settle = p => p.then(v => ({ v }), e => ({ e }));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const signedIn = () => { const n = (document.getElementById('userName')?.textContent || '').trim(); return !!n && n !== 'Not signed in'; };
const dialog = () => document.getElementById('qfDialog');


// ─── Reading ──────────────────────────────────────────────────────────

// ponytail: each list is one request (Supabase answers at most 1,000 rows); page them when clients, contacts or jobs get near that.
async function loadIndex() {
  if (QF.loading) return;
  QF.loading = true; QF.needsConnect = false;
  render();
  try {
    const sb = await connectSupabase();
    const q = (table, cols) => settle(sb.from(table).select(cols).then(must));
    const [gecko, ssa, contacts, jobs, deals, prospects, tasks] = await Promise.all([
      q('gecko_clients', 'title'), q('ssa_clients', 'id,name'), q('client_contacts', 'client_name,name,email,role'),
      q('jobs', 'id,client_name,title,status,value'), q('opportunities', 'id,client_name,title,status,mrr'),
      q('prospects', 'id,company,contact_name,stage'), settle(readTasks(sb))
    ]);
    putTasks(tasks.v || null, tasks.e);
    QF.index = {
      clients: gecko.v || ssa.v ? clientNames(gecko.v, ssa.v) : null,
      contacts: contacts.v || null, jobs: jobs.v || null, deals: deals.v || null, prospects: prospects.v || null
    };
    QF.clientsById = new Map((ssa.v || []).map(c => [String(c.id), c.name]));
    QF.errors = {};
    for (const [k, r] of Object.entries({ gecko, ssa, contacts, jobs, deals, prospects })) if (r.e) QF.errors[k] = r.e.message || String(r.e);
    QF.at = Date.now();
  } catch (err) {
    if (err.code === 'DB_SIGNIN_REQUIRED') QF.needsConnect = true;
    else QF.errors = { all: err.message || String(err) };
  } finally { QF.loading = false; render(); }
}

/** Invoices and timesheet entries: asked for as you type, once there is enough to ask with. */
function scheduleRemote() {
  clearTimeout(QF.timer);
  QF.seq++;                                  // whatever is in flight is for an older query
  if (!remoteReady(QF.q)) { QF.remote = NO_REMOTE(); return; }
  QF.remote = { ...NO_REMOTE(), busy: true };
  const q = QF.q, seq = QF.seq;
  QF.timer = setTimeout(() => runRemote(q, seq), DEBOUNCE_MS);
}

async function runRemote(q, seq) {
  const out = { ...NO_REMOTE(), q };
  try {
    const sb = await connectSupabase();
    // ponytail: "contains" on the server (the newest 50 rows), "start of a word" here (core/find.js); a very common word needs a second word typed.
    let inv = sb.from('xero_invoices').select('invoice_id,invoice_number,contact_name,reference,invoice_date,due_date,status,total,amount_due')
      .not('status', 'in', '(VOIDED,DELETED)').order('invoice_date', { ascending: false }).limit(REMOTE_ROWS);
    let ent = sb.from('timesheet_entries').select('id,client_id,engineer,entry_date,hours,title,work_description,deleted_at')
      .is('deleted_at', null).order('entry_date', { ascending: false }).limit(REMOTE_ROWS);
    for (const w of remoteWords(q)) {      // letters, digits and hyphens only: nothing typed can change the filter
      inv = inv.or(`invoice_number.ilike.%${w}%,contact_name.ilike.%${w}%,reference.ilike.%${w}%`);
      ent = ent.or(`title.ilike.%${w}%,work_description.ilike.%${w}%`);
    }
    const [i, e] = await Promise.all([settle(inv.then(must)), settle(ent.then(must))]);
    out.invoices = i.v || null; out.entries = e.v || null;
    if (i.e) out.errors.invoices = i.e.message || String(i.e);
    if (e.e) out.errors.entries = e.e.message || String(e.e);
  } catch (err) {
    if (err.code === 'DB_SIGNIN_REQUIRED') QF.needsConnect = true;
    else out.errors = { invoices: err.message || String(err), entries: err.message || String(err) };
  }
  if (seq !== QF.seq) return;                // a reply to an older query
  QF.remote = out;
  render();
}


// ─── Drawing ──────────────────────────────────────────────────────────

function groupsNow() {
  const td = today(), r = QF.remote;
  const groups = search({ ...(QF.index || {}), tasks: taskView() }, QF.q, td);
  if (r.q && r.q === QF.q) {
    const inv = invoiceRows(r.invoices, QF.q, td), ent = entryRows(r.entries, QF.q, QF.clientsById);
    if (inv.length) groups.push({ key: 'invoices', label: 'Invoices', rows: inv });
    if (ent.length) groups.push({ key: 'entries', label: 'Timesheet entries', rows: ent });
  }
  return groups;
}

/** The lines under the results: what is still loading, and what could not be searched (never left to look like "no matches"). */
function footHtml(count) {
  const notes = [], r = QF.remote;
  if (QF.needsConnect) notes.push('<span class="qf-warn">Not connected to the database: only pages and actions can be found.</span> <button type="button" class="btn btn-sm" data-qf="connect">Connect</button>');
  else if (QF.loading && !QF.index) notes.push('Loading clients, jobs and tasks…');
  const failed = Object.entries(QF.errors).map(([k, m]) => (k === 'all' ? `clients, jobs and tasks (${m})` : `${SOURCE_LABEL[k]} (${m})`));
  if (taskState().error) failed.push(`tasks (${taskState().error})`);
  if (failed.length) notes.push(`<span class="qf-warn">Not searched: ${escapeHtml(failed.join(', '))}.</span>`);
  if (r.errors.invoices) notes.push(`<span class="qf-warn">Invoices could not be searched: ${escapeHtml(r.errors.invoices)}.</span>`);
  if (r.errors.entries) notes.push(`<span class="qf-warn">Timesheet entries could not be searched: ${escapeHtml(r.errors.entries)}.</span>`);
  if (r.busy) notes.push('Searching invoices and timesheet entries…');
  if (!QF.q.trim()) notes.push('Type to find a client, person, job, task, invoice or timesheet entry.');
  else if (count) notes.push(`${count} result${count === 1 ? '' : 's'}`);
  return notes.map(n => `<span>${n}</span>`).join('');
}

function render() {
  const d = dialog();
  if (!d?.open) return;
  const groups = groupsNow();
  QF.rows = groups.flatMap(g => g.rows);
  QF.sel = Math.min(QF.sel, Math.max(0, QF.rows.length - 1));
  let n = 0;
  const list = groups.map(g => `<div class="qf-group" role="presentation">${escapeHtml(g.label)}</div>` + g.rows.map(r => {
    const i = n++;
    return `<div class="qf-row" role="option" id="qfOpt${i}" data-qf-row="${i}" aria-selected="${i === QF.sel}">${icon(GROUP_ICON[g.key], 14)}<span class="qf-text"><span class="qf-title">${escapeHtml(r.title)}</span>${r.sub ? `<span class="qf-sub">${escapeHtml(r.sub)}</span>` : ''}</span></div>`;
  }).join('')).join('');
  const r = QF.remote, waiting = r.busy || (QF.loading && !QF.index);
  const unsure = QF.needsConnect || Object.keys(QF.errors).length || taskState().error || r.errors.invoices || r.errors.entries;   // something could not be searched: the foot says what, and "no matches" would be a guess
  d.querySelector('#qfList').innerHTML = list || (QF.q.trim() && !waiting && !unsure ? `<p class="qf-empty">Nothing matches “${escapeHtml(QF.q.trim())}”.</p>` : '');
  d.querySelector('#qfFoot').innerHTML = footHtml(QF.rows.length);
  select(QF.sel);
}

/** Mark one row as the selected one (the field keeps the focus; aria-activedescendant tells a screen reader). */
function select(i) {
  const d = dialog();
  QF.sel = Math.max(0, Math.min(i, QF.rows.length - 1));
  d.querySelectorAll('[data-qf-row]').forEach(el => el.setAttribute('aria-selected', String(Number(el.dataset.qfRow) === QF.sel)));
  const on = d.querySelector('[aria-selected="true"]');
  on?.scrollIntoView({ block: 'nearest' });
  const input = d.querySelector('#qfInput');
  if (on) input.setAttribute('aria-activedescendant', on.id); else input.removeAttribute('aria-activedescendant');
}


// ─── Opening a result ─────────────────────────────────────────────────

function openRow(i) {
  const row = QF.rows[i];
  if (!row) return;
  dialog().close();
  const o = row.open;
  if (o.kind === 'client') window.geckoGo('client', o.tab || 'summary', o.name);
  else if (o.kind === 'page') window.geckoGo(o.section, o.tab || undefined);
  else if (o.kind === 'job') { window.navTo('jobs'); openJob(o.id); }
  else if (o.kind === 'deal') { window.navTo('opportunities'); openDeal(o.id); }
  else if (o.kind === 'prospect') { window.navTo('opportunities'); openProspect(o.id); }
  else if (o.kind === 'task') openTask(o.id);
  else if (o.kind === 'action' && o.run === 'task') newTask();
  else if (o.kind === 'action' && o.run === 'job') { window.navTo('jobs'); addJob(); }
}


// ─── The box ──────────────────────────────────────────────────────────

function build() {
  const d = document.createElement('dialog');
  d.id = 'qfDialog'; d.className = 'qf-dialog'; d.setAttribute('aria-label', 'Quick find');
  d.innerHTML = `<div class="qf-head">${icon('search', 16)}
      <input id="qfInput" type="text" role="combobox" aria-expanded="true" aria-controls="qfList" aria-autocomplete="list" aria-label="Find"
        placeholder="Find a client, job, task, invoice…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
      <kbd class="qf-kbd">Esc</kbd></div>
    <div id="qfList" class="qf-list" role="listbox" aria-label="Results"></div>
    <div id="qfFoot" class="qf-foot" aria-live="polite"></div>`;
  const input = d.querySelector('#qfInput');
  input.addEventListener('input', () => { QF.q = input.value; QF.sel = 0; scheduleRemote(); render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); select(QF.sel + (e.key === 'ArrowDown' ? 1 : -1)); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); openRow(QF.sel); }
  });
  d.addEventListener('click', e => {
    if (e.target === d) { d.close(); return; }                     // the backdrop
    const row = e.target.closest('[data-qf-row]');
    if (row) { openRow(Number(row.dataset.qfRow)); return; }
    if (e.target.closest('[data-qf="connect"]')) connectSupabase({ interactive: true }).then(loadIndex, () => {});
  });
  d.addEventListener('close', () => { if (d.open) return; clearTimeout(QF.timer); QF.seq++; });   // a close event can arrive after the box was opened again: that must not cancel the new search
  document.getElementById('app').append(d);
  return d;
}

/** Open the box (⌘K, the sidebar's Find row, the phone's search button). Nothing happens when signed out or while another dialog is open. */
export function open() {
  if (!signedIn() || document.querySelector('dialog[open]')) return;
  const d = dialog() || build();
  QF.q = ''; QF.sel = 0; QF.remote = NO_REMOTE();
  d.querySelector('#qfInput').value = '';
  window.closeSidebar?.();                     // on a phone the Find row sits in the slide-over menu
  d.showModal();
  d.querySelector('#qfInput').focus();
  render();
  if (!QF.index || Date.now() - QF.at > STALE_MS) loadIndex();
}

let started = false;
export function init() {
  if (started) return;
  started = true;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  document.querySelectorAll('[data-find-kbd]').forEach(k => { k.textContent = mac ? '⌘K' : 'Ctrl K'; });
  document.addEventListener('click', e => { if (e.target.closest?.('[data-find-open]')) open(); });
  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'k' || !signedIn()) return;
    e.preventDefault();                        // the browser's own Ctrl+K (address bar search)
    if (dialog()?.open) dialog().close(); else open();
  });
}
