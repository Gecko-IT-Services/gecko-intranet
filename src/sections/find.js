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

import { escapeHtml, toast } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { icon } from '../core/icons.js';
import { search, clientNames, remoteFilters, remoteReady, invoiceRows, entryRows, REMOTE_ROWS } from '../core/find.js';
import { read as readTasks, put as putTasks, view as taskView, state as taskState, openTask, newTask } from './tasks.js';
import { open as openJob, add as addJob } from './jobs.js';
import { open as openDeal, openProspect } from './opportunities.js';

const STALE_MS = 5 * 60000;    // the lists are read again on opening after this long
const DEBOUNCE_MS = 250;       // wait this long after the last keystroke before asking the database
const GROUP_ICON = { clients: 'building', people: 'user', jobs: 'briefcase', prospects: 'user', tasks: 'check', pages: 'right', actions: 'plus', invoices: 'file', entries: 'clock' };
const SOURCE_LABEL = { gecko: 'clients', ssa: 'support clients', contacts: 'people', jobs: 'jobs', deals: 'deals', prospects: 'prospects' };
const NO_REMOTE = () => ({ q: '', invoices: null, entries: null, errors: {}, busy: false });

// index: the small lists, read once ({ clients, contacts, jobs, deals, prospects }; a list that failed is null).
// rows: the results on screen, flat, in order; sel: the selected one, keep: which row that is (so a list redrawn by data arriving keeps the selection on the same row). seq: discards a reply to an older query.
const QF = { index: null, clientsById: new Map(), at: 0, loading: false, errors: {}, needsConnect: false, q: '', rows: [], sel: 0, keep: '', seq: 0, timer: 0, remote: NO_REMOTE() };

const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const settle = p => p.then(v => ({ v }), e => ({ e }));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const signedIn = () => { const shell = document.getElementById('portalShell'); return !!shell && !shell.classList.contains('hidden'); };   // showLogin() hides the shell, showPortal() shows it
const dialog = () => document.getElementById('qfDialog');


// ─── Reading ──────────────────────────────────────────────────────────

// ponytail: each list is one request (Supabase answers at most 1,000 rows); page them when clients, contacts or jobs get near that.
async function loadIndex() {
  if (QF.loading) return;
  QF.loading = true; QF.needsConnect = false;
  render();
  try {
    const needTasks = !taskState().loaded;
    const sb = await connectSupabase();
    const q = (table, cols) => settle(sb.from(table).select(cols).then(must));
    const [gecko, ssa, contacts, jobs, deals, prospects, tasks] = await Promise.all([
      q('gecko_clients', 'title'), q('ssa_clients', 'id,name'), q('client_contacts', 'client_name,name,email,role'),
      q('jobs', 'id,client_name,title,status,value'), q('opportunities', 'id,client_name,title,status,mrr'),
      q('prospects', 'id,company,contact_name,stage'), needTasks ? settle(readTasks(sb)) : null
    ]);
    if (tasks) putTasks(tasks.v || null, tasks.e);   // only when the tasks module has not loaded them: putting them again would clear Undo on a task ticked a moment ago
    QF.index = {
      clients: gecko.v || ssa.v ? clientNames(gecko.v, ssa.v) : null,
      contacts: contacts.v || null, jobs: jobs.v || null, deals: deals.v || null, prospects: prospects.v || null
    };
    QF.clientsById = new Map((ssa.v || []).map(c => [String(c.id), c.name]));
    QF.errors = {};
    for (const [k, r] of Object.entries({ gecko, ssa, contacts, jobs, deals, prospects })) if (r.e) QF.errors[k] = r.e.message || String(r.e);
    QF.at = Object.keys(QF.errors).length || (tasks && tasks.e) ? 0 : Date.now();   // a partial failure (tasks included) is read again on the next opening
  } catch (err) {
    QF.at = 0;
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
      .not('status', 'in', '(VOIDED,DELETED)').order('invoice_date', { ascending: false, nullsFirst: false }).limit(REMOTE_ROWS);
    let ent = sb.from('timesheet_entries').select('id,client_id,engineer,entry_date,hours,title,work_description,deleted_at')
      .is('deleted_at', null).neq('engineer', 'System').order('entry_date', { ascending: false, nullsFirst: false }).limit(REMOTE_ROWS);   // work rows only (the column is not null)
    const f = remoteFilters(q);              // letters and digits only: nothing typed can change a filter
    for (const x of f.invoices) inv = inv.or(x);
    for (const x of f.entries) ent = ent.or(x);
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
  QF.rows = groups.flatMap(g => g.rows.map(r => ({ ...r, key: g.key })));
  QF.sel = Math.max(0, QF.keep ? QF.rows.findIndex(r => rowId(r) === QF.keep) : 0);   // typing clears `keep`: the first row
  let n = 0;
  const list = groups.map(g => `<div role="group" aria-label="${escapeHtml(g.label)}"><div class="qf-group" aria-hidden="true">${escapeHtml(g.label)}</div>` + g.rows.map(r => {
    const i = n++;
    return `<div class="qf-row" role="option" id="qfOpt${i}" data-qf-row="${i}" aria-selected="${i === QF.sel}">${icon(GROUP_ICON[g.key], 14)}<span class="qf-text"><span class="qf-title">${escapeHtml(r.title)}</span>${r.sub ? `<span class="qf-sub">${escapeHtml(r.sub)}</span>` : ''}</span></div>`;
  }).join('') + '</div>').join('');
  const r = QF.remote, waiting = r.busy || (QF.loading && !QF.index);
  const unsure = QF.needsConnect || Object.keys(QF.errors).length || taskState().error || r.errors.invoices || r.errors.entries;   // something could not be searched: the foot says what, and "no matches" would be a guess
  d.querySelector('#qfList').innerHTML = list || (QF.q.trim() && !waiting && !unsure ? `<p class="qf-empty">Nothing matches “${escapeHtml(QF.q.trim())}”.</p>` : '');
  d.querySelector('#qfFoot').innerHTML = footHtml(QF.rows.length);
  select(QF.sel);
}

const rowId = r => `${r.key}\n${r.title}\n${JSON.stringify(r.open)}`;

/** Mark one row as the selected one (the field keeps the focus; aria-activedescendant tells a screen reader). */
function select(i, scroll = true) {
  const d = dialog();
  QF.sel = Math.max(0, Math.min(i, QF.rows.length - 1));
  QF.keep = QF.rows[QF.sel] ? rowId(QF.rows[QF.sel]) : '';
  d.querySelectorAll('[data-qf-row]').forEach(el => el.setAttribute('aria-selected', String(Number(el.dataset.qfRow) === QF.sel)));
  const on = d.querySelector('[aria-selected="true"]');
  if (scroll) on?.scrollIntoView({ block: 'nearest' });
  const input = d.querySelector('#qfInput');
  if (on) input.setAttribute('aria-activedescendant', on.id); else input.removeAttribute('aria-activedescendant');
}


// ─── Opening a result ─────────────────────────────────────────────────

function openRow(i) {
  const row = QF.rows[i];
  if (!row) return;
  dialog().close();
  const o = row.open;
  if (o.kind === 'client') { if (String(o.name || '').trim()) window.geckoGo('client', o.tab || 'summary', o.name); else toast('That row has no client to open.', 'warning'); }
  else if (o.kind === 'page') window.geckoGo(o.section, o.tab || undefined);
  else if (o.kind === 'job') { window.navTo('jobs'); openJob(o.id); }
  else if (o.kind === 'deal') { window.navTo('opportunities'); openDeal(o.id); }
  else if (o.kind === 'prospect') { window.navTo('opportunities'); openProspect(o.id); }
  else if (o.kind === 'task') { if (!openTask(o.id)) toast('That task is no longer there.', 'warning'); }
  else if (o.kind === 'action' && o.run === 'task') newTask();
  else if (o.kind === 'action' && o.run === 'job') { window.navTo('jobs'); addJob(); }
}


// ─── The box ──────────────────────────────────────────────────────────

function build() {
  const d = document.createElement('dialog');
  d.id = 'qfDialog'; d.className = 'qf-dialog'; d.setAttribute('aria-label', 'Quick find');
  d.innerHTML = `<div class="qf-head">${icon('search', 16)}
      <input id="qfInput" type="text" role="combobox" aria-expanded="true" aria-controls="qfList" aria-autocomplete="list" aria-label="Find"
        placeholder="Find a client, job, task, invoice…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
      <kbd class="qf-kbd">Esc</kbd><button type="button" class="qf-close" data-qf="close" aria-label="Close">${icon('x', 16)}</button></div>
    <div id="qfList" class="qf-list" role="listbox" aria-label="Results"></div>
    <div id="qfFoot" class="qf-foot" aria-live="polite"></div>`;
  const input = d.querySelector('#qfInput');
  input.addEventListener('input', () => { QF.q = input.value; QF.sel = 0; QF.keep = ''; scheduleRemote(); render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); select(QF.sel + (e.key === 'ArrowDown' ? 1 : -1)); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); openRow(QF.sel); }
  });
  let px = -1, py = -1, down = null;
  d.addEventListener('mousemove', e => {                          // the pointer moves the selection (mousemove, so a list redrawn under a still pointer does not steal it)
    if (e.clientX === px && e.clientY === py) return;             // a list scrolled under a parked pointer sends mousemove too
    px = e.clientX; py = e.clientY;
    const row = e.target.closest?.('[data-qf-row]');
    if (row && Number(row.dataset.qfRow) !== QF.sel) select(Number(row.dataset.qfRow), false);
  });
  d.addEventListener('mousedown', e => { down = e.target; });
  d.addEventListener('click', e => {
    if (e.target === d) { if (down === d) d.close(); return; }     // the backdrop, when the press started there too (a drag out of the field does not close the box)
    if (e.target.closest('[data-qf="close"]')) { d.close(); return; }
    const row = e.target.closest('[data-qf-row]');
    if (row) { openRow(Number(row.dataset.qfRow)); return; }
    if (e.target.closest('[data-qf="connect"]')) connectSupabase({ interactive: true }).then(() => loadIndex()).then(() => { scheduleRemote(); render(); }, () => {});   // then search the database for what is already typed
  });
  document.getElementById('app').append(d);
  return d;
}

/** On a phone the keyboard covers part of the screen: the list is sized from the visible viewport (CSS var --qf-vh). */
function fitViewport() {
  const d = dialog();
  if (d?.open && window.visualViewport) d.style.setProperty('--qf-vh', Math.round(window.visualViewport.height) + 'px');
}

/** Open the box (⌘K, the sidebar's Find row, the phone's search button). Nothing happens when signed out or while another dialog or modal is open. */
export function open() {
  if (!signedIn() || document.querySelector('dialog[open], [aria-modal="true"].show, .alr-backdrop:not([hidden])')) return;   // the older modals are divs that get `show` (Alerts: lose `hidden`)
  const d = dialog() || build();
  clearTimeout(QF.timer); QF.seq++;            // whatever a previous opening still had in flight is dropped
  QF.q = ''; QF.sel = 0; QF.keep = ''; QF.remote = NO_REMOTE();
  d.querySelector('#qfInput').value = '';
  window.closeSidebar?.();                     // on a phone the Find row sits in the slide-over menu
  d.showModal();
  fitViewport();
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
  window.visualViewport?.addEventListener('resize', fitViewport);
  document.addEventListener('keydown', e => {
    const chord = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;   // ⌘K on Apple, Ctrl+K elsewhere (on a Mac Ctrl+K is a text field's "delete to end of line")
    if (!chord || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'k' || !signedIn()) return;
    e.preventDefault();                        // the browser's own Ctrl+K (address bar search)
    if (dialog()?.open) dialog().close(); else open();
  });
}
