/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   TASKS                                                           ║
   ║                                                                   ║
   ║   Client promises and handing work over (Jack, 12 Oct 2026).      ║
   ║   Not a page: one row, one dialog and the reads and writes,       ║
   ║   shared by Overview › Today (classic script, window.GeckoTasks)  ║
   ║   and the client page's Activity tab (sections/client.js).        ║
   ║   Logic: core/tasks.js. Styles: system.css "10 · Tasks".          ║
   ║   Design: docs/superpowers/specs/2026-10-12-tasks-design.md       ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink } from '../core/ui.js';
import { selectAllPages } from '../core/store.js';
import { connectSupabase } from '../core/supabase.js';
import { followUpChoices } from '../core/activity.js';
import { sameClient } from '../core/client.js';
import { PEOPLE, TITLE_MAX, NOTE_MAX, LATER_SHOWN, DONE_DAYS, personOf, isNew, level, lateness, dueLabel, cleanTask, groups, forClient, doneRecently } from '../core/tasks.js';

const STALE_MS = 5 * 60000;          // re-read on coming back to the tab after this long
const WHO_KEY = 'gecko.tasks.who';   // Mine / Everyone, remembered per browser

// tasks: every row as last read (null = not read); justDone: ticked since then, kept in place with Undo.
const TK = { tasks: null, error: '', at: 0, justDone: new Set(), everyone: false, allLater: false, showDone: false, saving: false, clients: null, clientsError: '', subs: [] };

const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const day = d => String(d || '').slice(0, 10);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shortDate = d => new Date(day(d) + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const byId = id => (TK.tasks || []).find(t => t.id === id);
const emit = () => TK.subs.forEach(fn => { try { fn(); } catch (err) { console.error('Tasks: a page failed to redraw', err); } });
// A database failure as a sentence: the missing table (before the migration) is named, anything else is passed on.
const dbError = err => {
  const m = err?.message || String(err);
  return /tasks/.test(m) && /find the table|does not exist|schema cache/i.test(m) ? 'the tasks table isn’t in the database yet (it arrives with this update)' : m;
};

/** The signed-in person as tasks name them ('Philip' | 'Jack'), '' when it is neither. */
export const me = () => personOf(document.getElementById('userName')?.textContent);

/** A page asks to be redrawn whenever tasks change. */
export const subscribe = fn => { TK.subs.push(fn); };

// ponytail: reads the whole table, a page of 1,000 rows at a time (a few hundred rows a year for two people);
// narrow to open + recent + by client when it is slow.
export const read = sb => selectAllPages((from, to) => sb.from('tasks').select('*').order('id').range(from, to));

/** Hand in what a page read. A failed re-read keeps the last good list and records why. */
export function put(rows, err) {
  if (rows) { TK.tasks = rows; TK.justDone.clear(); }
  TK.error = err ? dbError(err) : '';
  TK.at = Date.now();
  emit();
}

export const state = () => ({ loaded: !!TK.tasks, error: TK.error, everyone: TK.everyone || !me() });

/** Tasks as the pages draw them: one ticked a moment ago stays where it was (marked `_done`) until the next read. */
export const view = () => TK.tasks && TK.tasks.map(t => (TK.justDone.has(t.id) ? { ...t, done_at: null, _done: true } : t));

export async function reload() {
  try { put(await read(await connectSupabase())); }
  catch (err) { put(null, err); }
}


// ─── Drawing ──────────────────────────────────────────────────────────

/** One task as a list row: tick · title (opens it) · client, who gave it, note · badge · due. */
export function rowHtml(t, { showWho = false } = {}) {
  const td = today(), mine = t.assigned_to === me();
  const handed = t.assigned_by && t.assigned_by !== t.assigned_to;
  const lv = t._done ? '' : (t.level ?? level(t, td));
  const sub = [
    t.client_name ? clientLink(t.client_name) : '',
    handed ? (mine ? `from ${escapeHtml(t.assigned_by)}` : t.seen_at ? `seen ${escapeHtml(shortDate(t.seen_at))}` : 'not seen yet') : '',
    t.note ? escapeHtml(t.note) : ''
  ].filter(Boolean).join(' · ');
  const who = showWho && t.assigned_to ? `<b class="tk-who lp-${escapeHtml(t.assigned_to.toLowerCase())}" title="${escapeHtml(t.assigned_to)}">${escapeHtml(t.assigned_to[0])}</b>` : '';
  // A handoff not opened yet is 'new', and keeps the colour of how late it is.
  return `<li class="tk-row${lv ? ' ' + lv : ''}${lv === 'new' && lateness(t, td) ? ' ' + lateness(t, td) : ''}${t._done ? ' done' : ''}">
    <input type="checkbox" class="tk-tick" data-tk="tick" data-id="${t.id}"${t._done ? ' checked' : ''} aria-label="${escapeHtml('Done: ' + t.title)}">
    <div class="tk-main"><button type="button" class="tk-title" data-tk="open" data-id="${t.id}">${escapeHtml(t.title)}</button>${sub ? `<p class="tk-sub">${sub}</p>` : ''}</div>
    ${!t._done && mine && isNew(t) ? `<span class="badge badge-blue">New from ${escapeHtml(t.assigned_by)}</span>` : ''}${who}
    ${t._done ? `<button type="button" class="btn btn-sm btn-ghost" data-tk="undo" data-id="${t.id}">Undo</button>` : `<span class="tk-due">${escapeHtml(dueLabel(t.due_on, td))}</span>`}
  </li>`;
}

const doneRowHtml = t => `<li class="tk-row done">
    <div class="tk-main"><span class="tk-title">${escapeHtml(t.title)}</span><p class="tk-sub">${[t.client_name ? clientLink(t.client_name) : '', `done ${escapeHtml(shortDate(t.done_at))}${t.done_by ? ' by ' + escapeHtml(t.done_by) : ''}`].filter(Boolean).join(' · ')}</p></div>
    <button type="button" class="btn btn-sm btn-ghost" data-tk="reopen" data-id="${t.id}">Reopen</button>
  </li>`;

/** Mine | Everyone, for the Needs attention card head ('' when the signed-in name is neither person). */
export function switchHtml() {
  if (!me()) return '';
  return `<div class="tk-switch" role="group" aria-label="Whose tasks">${[['mine', 'Mine'], ['everyone', 'Everyone']].map(([k, l]) =>
    `<button type="button" data-tk="who" data-who="${k}" aria-pressed="${(k === 'everyone') === TK.everyone}">${l}</button>`).join('')}</div>`;
}

/** Under Overview's one list: Later, Waiting on …, Done. '' when tasks were not read. */
export function todayHtml() {
  if (!TK.tasks) return '';
  const td = today(), all = state().everyone, g = groups(view(), me(), td, all);
  const list = (rows, opts) => `<ul class="tk-list">${rows.map(t => rowHtml(t, opts)).join('')}</ul>`;
  const later = TK.allLater ? g.later : g.later.slice(0, LATER_SHOWN);
  const done = doneRecently(view(), td);
  const waitingOn = [...new Set(g.waiting.map(t => t.assigned_to))].join(' and ');
  return (g.later.length ? `<h4 class="tk-group">Later <span>${g.later.length}</span></h4>${list(later, { showWho: all })}${g.later.length > later.length ? `<button type="button" class="tk-more" data-tk="later">Show all ${g.later.length}</button>` : ''}` : '')
    + (g.waiting.length ? `<h4 class="tk-group">Waiting on ${escapeHtml(waitingOn)} <span>${g.waiting.length}</span></h4>${list(g.waiting)}` : '')
    + (done.length ? `<div class="tk-foot"><button type="button" class="tk-more" data-tk="done" aria-expanded="${TK.showDone}">Done · ${done.length} in the last ${DONE_DAYS} days</button></div>${TK.showDone ? `<ul class="tk-list">${done.map(doneRowHtml).join('')}</ul>` : ''}` : '');
}

/** One client's open tasks for the client page: the rows, the counts for the tab badge, and the Add button. */
export function clientTasks(name) {
  const td = today(), rows = TK.tasks ? forClient(view(), name) : [];
  const live = rows.filter(t => !t._done), due = live.filter(t => day(t.due_on) <= td);
  return {
    loaded: !!TK.tasks, error: TK.error, count: live.length, due: due.length, late: due.some(t => day(t.due_on) < td),
    html: rows.length ? `<ul class="tk-list">${rows.map(t => rowHtml(t, { showWho: true })).join('')}</ul>` : '',
    addButton: `<button type="button" class="btn btn-sm" data-tk="add" data-client="${escapeHtml(name)}">Add task</button>`
  };
}

/** What a client note's task is doing, for the timeline line under the note ('' when it has none). */
export function noteTask(activityId) {
  const t = (TK.tasks || []).find(x => x.activity_id === activityId);
  if (!t) return '';
  return t.done_at ? ` · done ${escapeHtml(shortDate(t.done_at))}${t.done_by ? ' by ' + escapeHtml(t.done_by) : ''}`
    : ` · task for ${escapeHtml(t.assigned_to)} (${escapeHtml(dueLabel(t.due_on, today()))})`;
}


// ─── The dialog: add a task, or open one ──────────────────────────────

function dialogHtml(t, preset) {
  const td = today(), names = (TK.clients || []).slice();
  const v = t || { title: '', note: '', client_name: preset.client || '', assigned_to: me() || PEOPLE[0], due_on: td };
  // The client as the list spells it; a name the list does not have (renamed, or the list did not load) is kept as it is.
  const client = names.find(n => sameClient(n, v.client_name)) || v.client_name || '';
  if (client && !names.includes(client)) names.push(client);
  names.sort((a, b) => a.localeCompare(b));
  const chips = [['Today', td], ...followUpChoices(td).slice(0, 2)];
  const handed = t && t.assigned_by && t.assigned_by !== t.assigned_to;
  return `<form class="tk-form" data-tk-form data-id="${t ? t.id : ''}" novalidate>
    <h3 id="tkDialogTitle">${t ? 'Task' : 'Add task'}</h3>
    <label>What <input name="title" maxlength="${TITLE_MAX}" value="${escapeHtml(v.title)}" placeholder="Ring Pam about the Wi-Fi" autocomplete="off"></label>
    <label>Client <select name="client_name"><option value="">No client</option>${names.map(n => `<option${n === client ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>
    ${TK.clientsError ? `<p class="tk-form-error">The client list didn’t load: ${escapeHtml(TK.clientsError)}</p>` : ''}
    <fieldset class="tk-seg"><legend>Who</legend>${PEOPLE.map(p => `<label><input type="radio" name="assigned_to" value="${p}"${v.assigned_to === p ? ' checked' : ''}><span>${p}</span></label>`).join('')}</fieldset>
    <div class="tk-due-row"><span>Due</span>${chips.map(([l, d]) => `<button type="button" class="tk-chip${day(v.due_on) === d ? ' on' : ''}" data-tk="due" data-date="${d}">${l}</button>`).join('')}
      <input type="date" name="due_on" value="${escapeHtml(day(v.due_on))}" aria-label="Due date"></div>
    <label>Note <input name="note" maxlength="${NOTE_MAX}" value="${escapeHtml(v.note || '')}" placeholder="Anything they need to know" autocomplete="off"></label>
    ${handed ? `<p class="tk-meta">From ${escapeHtml(t.assigned_by)} · ${t.seen_at ? `seen ${escapeHtml(shortDate(t.seen_at))}` : 'not seen yet'}</p>` : ''}
    <p class="tk-form-error" data-tk-error role="alert" hidden></p>
    <div class="tk-form-acts">
      ${t ? `<button type="button" class="btn btn-danger" data-tk="del" data-id="${t.id}">Delete</button>` : ''}
      <button type="button" class="btn btn-ghost" data-tk="close">Cancel</button>
      <button type="submit" class="btn btn-primary">${t ? 'Save' : 'Add task'}</button>
    </div>
  </form>`;
}

async function openDialog(t, preset = {}) {
  if (TK.clients == null) {
    try {
      const sb = await connectSupabase({ interactive: true });
      TK.clients = must(await sb.from('gecko_clients').select('title')).map(c => c.title).filter(Boolean);
      TK.clientsError = '';
    } catch (err) { TK.clientsError = err.message || String(err); }
  }
  let d = document.getElementById('tkDialog');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'tkDialog'; d.className = 'tk-dialog'; d.setAttribute('aria-labelledby', 'tkDialogTitle');
    document.getElementById('app').append(d);
  }
  d.innerHTML = dialogHtml(t, preset);
  if (!d.open) d.showModal();
  d.querySelector('[name="title"]').focus();
  if (t && isNew(t) && t.assigned_to === me()) markSeen(t);
}

const closeDialog = () => document.getElementById('tkDialog')?.close();

function formError(form, message) {
  const p = form.querySelector('[data-tk-error]');
  p.textContent = message; p.hidden = false;
}


// ─── Writes ───────────────────────────────────────────────────────────

async function markSeen(t) {
  const at = new Date().toISOString();
  t.seen_at = at; emit();
  try { const sb = await connectSupabase(); must(await sb.from('tasks').update({ seen_at: at }).eq('id', t.id)); }
  catch (err) { t.seen_at = null; emit(); toast('Could not mark the task as seen: ' + dbError(err), 'error', 7000); }
}

/** Add a task from somewhere other than the dialog (a client note's follow-up). Throws with the reason. */
export async function addTask(input, extra = {}) {
  const { row, error } = cleanTask(input, { me: me(), today: today() });
  if (error) throw new Error(error);
  let saved;
  try {
    const sb = await connectSupabase({ interactive: true });
    saved = must(await sb.from('tasks').insert({ ...row, ...extra }).select('*').single());
  } catch (err) { throw new Error(dbError(err)); }
  if (TK.tasks) TK.tasks.push(saved); else await reload();
  emit();
  return saved;
}

async function saveForm(form) {
  if (TK.saving) return;
  const id = Number(form.dataset.id) || null, prev = id ? byId(id) : null, f = form.elements;
  const { row, error } = cleanTask({ title: f.title.value, note: f.note.value, client_name: f.client_name.value, assigned_to: f.assigned_to.value, due_on: f.due_on.value },
    { me: me(), today: today(), prev });
  if (error) { formError(form, error); return; }
  const submit = form.querySelector('[type="submit"]');
  TK.saving = true; submit.disabled = true;
  try {
    const sb = await connectSupabase({ interactive: true });
    const saved = id ? must(await sb.from('tasks').update(row).eq('id', id).select('*').single())
      : must(await sb.from('tasks').insert(row).select('*').single());
    if (!TK.tasks) await reload();
    else if (id) TK.tasks = TK.tasks.map(t => (t.id === id ? saved : t));
    else TK.tasks.push(saved);
    closeDialog(); emit();
    toast(id ? 'Task saved' : saved.assigned_to !== me() ? `Given to ${saved.assigned_to}` : 'Task added', 'success');
  } catch (err) {
    formError(form, 'Could not save: ' + dbError(err));
  } finally { TK.saving = false; submit.disabled = false; }
}

/** Tick or untick. The row changes at once; a write that fails puts it back and says why. */
async function setDone(id, on) {
  const t = byId(id);
  if (!t) { emit(); return; }   // gone since the page was drawn: redraw so the box shows how things really are
  const before = { done_at: t.done_at, done_by: t.done_by }, wasJust = TK.justDone.has(id);
  const patch = on ? { done_at: new Date().toISOString(), done_by: me() } : { done_at: null, done_by: '' };
  Object.assign(t, patch);
  if (on) TK.justDone.add(id); else TK.justDone.delete(id);
  emit();
  try { const sb = await connectSupabase({ interactive: true }); must(await sb.from('tasks').update(patch).eq('id', id)); }
  catch (err) {
    Object.assign(t, before);
    if (wasJust) TK.justDone.add(id); else TK.justDone.delete(id);
    emit();
    toast('Could not update the task: ' + dbError(err), 'error', 7000);
  }
}

async function remove(id, form) {
  if (!confirm('Delete this task?')) return;
  try {
    const sb = await connectSupabase({ interactive: true });
    must(await sb.from('tasks').delete().eq('id', id));
    TK.tasks = (TK.tasks || []).filter(t => t.id !== id);
    closeDialog(); emit();
    toast('Task deleted', 'success');
  } catch (err) { formError(form, 'Could not delete: ' + dbError(err)); }
}


// ─── Wiring: one set of listeners on #app, for every page that draws tasks ───

function onClick(e) {
  const el = e.target.closest?.('[data-tk]');
  if (!el) return;
  const act = el.dataset.tk, id = Number(el.dataset.id) || null;
  if (act === 'add') openDialog(null, { client: el.dataset.client || '' });
  if (act === 'open' && byId(id)) openDialog(byId(id));
  if (act === 'close') closeDialog();
  if (act === 'due') {
    const form = el.closest('form');
    form.elements.due_on.value = el.dataset.date;
    form.querySelectorAll('[data-tk="due"]').forEach(b => b.classList.toggle('on', b === el));
  }
  if (act === 'undo' || act === 'reopen') setDone(id, false);
  if (act === 'del') remove(id, el.closest('form'));
  if (act === 'who') {
    TK.everyone = el.dataset.who === 'everyone';
    try { localStorage.setItem(WHO_KEY, TK.everyone ? 'everyone' : 'mine'); } catch { /* storage blocked */ }
    emit();
  }
  if (act === 'later') { TK.allLater = true; emit(); }
  if (act === 'done') { TK.showDone = !TK.showDone; emit(); }
}

function onChange(e) {
  const el = e.target;
  if (el.matches?.('input[data-tk="tick"]')) setDone(Number(el.dataset.id), el.checked);
  // A date typed by hand: light the shortcut that matches, if any.
  if (el.name === 'due_on' && el.closest?.('[data-tk-form]')) el.closest('form').querySelectorAll('[data-tk="due"]').forEach(b => b.classList.toggle('on', b.dataset.date === el.value));
}

let started = false;
export function init() {
  if (started) return;
  started = true;
  try { TK.everyone = localStorage.getItem(WHO_KEY) === 'everyone'; } catch { /* storage blocked */ }
  const app = document.getElementById('app');
  app.addEventListener('click', onClick);
  app.addEventListener('change', onChange);
  app.addEventListener('submit', e => { if (e.target.matches?.('[data-tk-form]')) { e.preventDefault(); saveForm(e.target); } });
  // Left open all day, the page would hide a task handed over since (nobody is emailed): re-read on coming back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && TK.at && Date.now() - TK.at > STALE_MS && !document.getElementById('tkDialog')?.open) reload();
  });
}
