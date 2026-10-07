/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   PROJECTS BOARD                                                  ║
   ║                                                                   ║
   ║   The portal's first ES module. Project work does not fit Atera's ║
   ║   ticket model, so it lives here instead; Atera stays king for    ║
   ║   day-to-day work and is referenced by link only.                 ║
   ║                                                                   ║
   ║   SharePoint list used:                                           ║
   ║     GeckoProjects — Title, ClientName, Owner, Status, WaitingOn,  ║
   ║                     NextAction, AteraRef, Notes                   ║
   ║                                                                   ║
   ║   Supabase table used once CONFIG.DATA_BACKEND.projects is        ║
   ║   'supabase': public.projects (supabase/migrations/). Until then  ║
   ║   the header offers "Copy to Supabase", which reconciles.         ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access in this file. tests/         ║
   ║   projects-board.mjs imports it under Node. Registration into     ║
   ║   window.GeckoSections lives in src/main.js.                      ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { graphFetch, resolveSiteId, fetchAllLists, clearListsCache } from '../core/graph.js';
import { toast, escapeHtml } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';

const LIST_NAME        = 'GeckoProjects';
const CLIENTS_LIST_NAME = 'GeckoClients';

/** Module state. Populated by load(), read by the renderers. */
const PRJ = {
  listId:   null,
  clients:  [],     // client names, for the modal dropdown (Task 6)
  projects: [],     // Project[]
  loading:  false,
  error:    null,   // null | 'LIST_MISSING' | string
  doneOpen: false,  // the Done column starts collapsed
};

// ─── Pure helpers (unit-tested in tests/projects-board.mjs) ───────────

/** Board columns, in order. Must match the SharePoint Choice values. */
export const STATUSES = ['Quoted', 'Agreed', 'In progress', 'Done'];

/** Days without a change before an active project is flagged as drifting. */
export const STALE_DAYS = 21;

/** Only work that is supposed to be moving can drift. Quotes legitimately sit. */
const STALE_STATUSES = new Set(['Agreed', 'In progress']);

const DAY_MS = 86400000;

/**
 * Whole weeks between an ISO timestamp and `now`, floored.
 * Returns 0 for anything unparseable so the badge never renders "NaNw".
 */
export function weeksSince(iso, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.floor((now - then) / (7 * DAY_MS));
}

/**
 * Has this project sat untouched long enough to be worth flagging?
 * Deliberately false for anything unparseable — a bad date should not
 * manufacture an alarm.
 */
export function isStale(project, now = new Date()) {
  if (!project || !STALE_STATUSES.has(project.status)) return false;
  const modified = new Date(project.modified);
  if (Number.isNaN(modified.getTime())) return false;
  return (now - modified) > STALE_DAYS * DAY_MS;
}

/**
 * Bucket projects into board columns. Unknown, empty and missing statuses
 * fall into Quoted — a project must never silently disappear from the board
 * because someone edited the Choice column in SharePoint.
 */
export function groupByStatus(projects) {
  const groups = Object.fromEntries(STATUSES.map(s => [s, []]));
  for (const project of projects || []) {
    const key = STATUSES.includes(project?.status) ? project.status : 'Quoted';
    groups[key].push(project);
  }
  return groups;
}

// ─── SharePoint ⇄ Supabase mapping (pure, unit-tested) ───────────────

/** Form/SharePoint field name → Supabase column. One to one, nothing dropped. */
export const FIELD_COLUMNS = {
  Title:      'title',
  ClientName: 'client_name',
  Owner:      'owner',
  Status:     'status',
  WaitingOn:  'waiting_on',
  NextAction: 'next_action',
  AteraRef:   'atera_ref',
  Notes:      'notes'
};

/** Form fields (SharePoint names) → a Supabase row. */
export function fieldsToRow(fields) {
  const row = {};
  for (const [field, column] of Object.entries(FIELD_COLUMNS)) {
    if (field in fields) row[column] = fields[field] ?? '';
  }
  return row;
}

/** Supabase row → the flat shape the renderers use (same as mapItem). */
export function rowToProject(row) {
  return {
    id:         String(row.id),
    title:      row.title       || '(untitled)',
    client:     row.client_name || '',
    owner:      row.owner       || '',
    status:     row.status      || 'Quoted',
    waitingOn:  row.waiting_on  || '',
    nextAction: row.next_action || '',
    ateraRef:   row.atera_ref   || '',
    notes:      row.notes       || '',
    modified:   row.modified_at || ''
  };
}

/**
 * SharePoint list item → the row the import inserts. Keeps the item's own
 * Created/Modified so the 21-day staleness flag survives the move.
 */
export function spItemToRow(item) {
  const f = item.fields || {};
  const row = fieldsToRow(Object.fromEntries(
    Object.keys(FIELD_COLUMNS).map(k => [k, typeof f[k] === 'string' ? f[k] : (f[k] ?? '')])
  ));
  if (!row.title) row.title = '(untitled)';
  if (!STATUSES.includes(row.status)) row.status = 'Quoted';
  row.sharepoint_id = String(item.id);
  row.created_at  = f.Created  || item.createdDateTime      || new Date().toISOString();
  row.modified_at = f.Modified || item.lastModifiedDateTime || row.created_at;
  return row;
}

/**
 * Compare what SharePoint holds with what Supabase now holds, field by field.
 * Returns { ok, spCount, dbCount, mismatches: [{ sharepointId, problem }] }.
 */
export function reconcile(spRows, dbRows) {
  const bySp = new Map(dbRows.map(r => [String(r.sharepoint_id), r]));
  const mismatches = [];
  for (const sp of spRows) {
    const db = bySp.get(sp.sharepoint_id);
    if (!db) { mismatches.push({ sharepointId: sp.sharepoint_id, problem: 'missing in Supabase' }); continue; }
    for (const column of Object.values(FIELD_COLUMNS)) {
      if ((db[column] ?? '') !== (sp[column] ?? '')) {
        mismatches.push({ sharepointId: sp.sharepoint_id, problem: `${column} differs` });
      }
    }
  }
  if (dbRows.length !== spRows.length) {
    mismatches.push({ sharepointId: '', problem: `row count ${spRows.length} vs ${dbRows.length}` });
  }
  return { ok: mismatches.length === 0, spCount: spRows.length, dbCount: dbRows.length, mismatches };
}

// ─── Data ─────────────────────────────────────────────────────────────

/** 'sharepoint' | 'supabase'. CONFIG is the site's classic-script const. */
function backend() {
  // eslint-disable-next-line no-undef
  const cfg = typeof CONFIG !== 'undefined' ? CONFIG : undefined;
  return cfg?.DATA_BACKEND?.projects === 'supabase' ? 'supabase' : 'sharepoint';
}

/** Throws Supabase's error rather than letting a failed call look like no rows. */
function must({ data, error }) {
  if (error) throw new Error(error.message || 'Database request failed');
  return data;
}

/** Graph list item → the flat shape the renderers use. */
function mapItem(item) {
  const f = item.fields || {};
  return {
    id:         item.id,
    title:      f.Title       || '(untitled)',
    client:     f.ClientName  || '',
    owner:      f.Owner       || '',
    status:     f.Status      || 'Quoted',
    waitingOn:  f.WaitingOn   || '',
    nextAction: f.NextAction  || '',
    ateraRef:   f.AteraRef    || '',
    notes:      f.Notes       || '',
    modified:   f.Modified    || item.lastModifiedDateTime || ''
  };
}

/** Resolve the GeckoProjects list id, caching it on PRJ. */
async function resolveListId() {
  if (PRJ.listId) return PRJ.listId;
  const findList = lists =>
    lists.find(l => l.displayName === LIST_NAME || l.name === LIST_NAME);

  let list = findList(await fetchAllLists());
  if (!list) {
    // fetchAllLists() caches globally, so a list created since that cache was
    // filled stays invisible until the cache is dropped. Without this, the
    // setup message tells the user to create the list and then Retry never
    // works. Same one-shot retry pnlResolveListId uses.
    clearListsCache();
    list = findList(await fetchAllLists());
  }
  if (!list) {
    const err = new Error(`${LIST_NAME} list not found`);
    err.code = 'LIST_MISSING';
    throw err;
  }
  PRJ.listId = list.id;
  return PRJ.listId;
}

/**
 * Fetch every project. No paging: this list holds tens of rows, not
 * thousands, and $top=999 is the same ceiling the other sections use.
 * ponytail: unpaged. Add @odata.nextLink following if this ever exceeds 999.
 */
async function fetchProjects() {
  if (backend() === 'supabase') {
    const sb = await connectSupabase();
    return must(await sb.from('projects').select('*').order('id')).map(rowToProject);
  }
  const siteId = await resolveSiteId();
  const listId = await resolveListId();
  const res = await graphFetch(
    `/sites/${siteId}/lists/${listId}/items?expand=fields&$top=999`
  );
  return (res.value || []).map(mapItem);
}

/** Client names for the modal dropdown. Failure here is not fatal. */
async function fetchClientNames() {
  try {
    const siteId = await resolveSiteId();
    const lists  = await fetchAllLists();
    const list   = lists.find(
      l => l.displayName === CLIENTS_LIST_NAME || l.name === CLIENTS_LIST_NAME
    );
    if (!list) return [];
    const res = await graphFetch(
      `/sites/${siteId}/lists/${list.id}/items?expand=fields($select=Title)&$top=999`
    );
    return (res.value || [])
      .map(i => i.fields?.Title)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];   // the board is still usable with a free-text client field
  }
}

/**
 * PATCH one item's fields.
 * ponytail: last-write-wins. Add If-Match/ETag if a third person ever uses this.
 */
async function patchFields(id, fields) {
  if (backend() === 'supabase') {
    const sb = await connectSupabase();
    must(await sb.from('projects').update(fieldsToRow(fields)).eq('id', id).select('id').single());
    return;
  }
  const siteId = await resolveSiteId();
  const listId = await resolveListId();
  await graphFetch(`/sites/${siteId}/lists/${listId}/items/${id}/fields`, {
    method: 'PATCH',
    body:   JSON.stringify(fields)
  });
}

let loadSeq = 0;   // a later load always wins; an older one must not clobber it

/** Load everything and render. Sets PRJ.error rather than throwing. */
async function load() {
  const seq = ++loadSeq;
  PRJ.loading = true;
  PRJ.error   = null;
  render();
  try {
    const [projects, clients] = await Promise.all([fetchProjects(), fetchClientNames()]);
    if (seq !== loadSeq) return;   // superseded — a newer load owns the state
    PRJ.projects = projects;
    PRJ.clients  = clients;
    const stamp = document.getElementById('prjLastSync');
    if (stamp) stamp.textContent = 'Synced ' + new Date().toLocaleTimeString('en-GB',
      { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    if (seq !== loadSeq) return;
    PRJ.error = err.code === 'LIST_MISSING' || err.code === 'DB_SIGNIN_REQUIRED'
      ? err.code : (err.message || 'Load failed');
  } finally {
    if (seq === loadSeq) {
      PRJ.loading = false;
      render();
    }
  }
}

// ─── Render ───────────────────────────────────────────────────────────

const SETUP_MESSAGE = `
  <div class="prj-error">
    <strong>The GeckoProjects list does not exist yet.</strong>
    Create a list named <code>GeckoProjects</code> on the portal SharePoint site
    with these columns: ClientName (text), Owner (choice: Jack, Philip),
    Status (choice: Quoted, Agreed, In progress, Done), WaitingOn (text),
    NextAction (text), AteraRef (text), Notes (multi-line, plain text).
    Column names must not contain spaces.
  </div>`;

const ATERA_TICKET_URL = 'https://app.atera.com/new/tickets/';

/**
 * Project ids with a status write in flight. render() rebuilds the whole
 * board, so without this a pending card's select would come back enabled
 * and still showing the old status — letting a second PATCH start for the
 * same item, where whichever response lands last silently wins.
 */
export const statusWritesInFlight = new Set();

/** One project card. Every interpolated value is escaped. */
export function renderCard(project) {
  const stale   = isStale(project);
  const waiting = project.waitingOn.trim();

  const badges = [
    waiting
      ? `<span class="prj-chip prj-chip-wait" title="Waiting on: ${escapeHtml(waiting)}">Waiting · ${escapeHtml(waiting)}</span>`
      : '',
    stale
      ? `<span class="prj-chip prj-chip-stale">No movement ${weeksSince(project.modified)}w</span>`
      : ''
  ].join('');

  const meta = [
    project.client ? `<span>${escapeHtml(project.client)}</span>` : '',
    project.owner  ? `<span>${escapeHtml(project.owner)}</span>`  : '',
    project.ateraRef
      ? `<a class="prj-atera" href="${ATERA_TICKET_URL}${encodeURIComponent(project.ateraRef)}"
            target="_blank" rel="noopener noreferrer">#${escapeHtml(project.ateraRef)}</a>`
      : ''
  ].join('');

  const options = STATUSES.map(s =>
    `<option value="${escapeHtml(s)}"${s === project.status ? ' selected' : ''}>${escapeHtml(s)}</option>`
  ).join('');

  // The meta row sits OUTSIDE the card-open button on purpose: the Atera
  // link is interactive content, and an <a> nested inside a <button> is
  // invalid HTML that browsers handle inconsistently. Keeping it outside
  // also means the link needs no stopPropagation to avoid opening the modal.
  return `
    <article class="prj-card${stale ? ' is-stale' : ''}" data-prj-id="${escapeHtml(project.id)}">
      <button class="prj-card-open" type="button" data-prj-open="${escapeHtml(project.id)}">
        <h4>${escapeHtml(project.title)}</h4>
        ${project.nextAction ? `<p class="prj-next">${escapeHtml(project.nextAction)}</p>` : ''}
        ${badges ? `<div class="prj-chips">${badges}</div>` : ''}
      </button>
      ${meta ? `<div class="prj-meta">${meta}</div>` : ''}
      <label class="prj-status-wrap">
        <span class="sr-only">Status for ${escapeHtml(project.title)}</span>
        <select class="prj-status" data-prj-id="${escapeHtml(project.id)}"${statusWritesInFlight.has(project.id) ? ' disabled' : ''}>${options}</select>
      </label>
    </article>`;
}

/** One column. Done is collapsed by default so it cannot grow without limit. */
export function renderColumn(status, projects) {
  const isDone    = status === 'Done';
  const collapsed = isDone && !PRJ.doneOpen;
  const body = collapsed
    ? ''
    : (projects.length
        ? projects.map(renderCard).join('')
        : '<p class="prj-col-empty">Nothing here.</p>');

  return `
    <section class="prj-col${collapsed ? ' is-collapsed' : ''}" data-status="${escapeHtml(status)}">
      <header class="prj-col-head">
        <h3>${escapeHtml(status)}</h3>
        <span class="prj-count">${projects.length}</span>
        ${isDone ? `<button class="prj-col-toggle" type="button" data-prj-toggle-done
                       aria-expanded="${String(!collapsed)}">${collapsed ? 'Show' : 'Hide'}</button>` : ''}
      </header>
      <div class="prj-col-body">${body}</div>
    </section>`;
}

function render() {
  const mount = document.getElementById('prjBoard');
  if (!mount) return;

  if (PRJ.loading && !PRJ.projects.length) {
    mount.innerHTML = '<p class="prj-empty">Loading projects…</p>';
    return;
  }
  if (PRJ.error === 'LIST_MISSING') {
    mount.innerHTML = SETUP_MESSAGE;
    return;
  }
  if (PRJ.error === 'DB_SIGNIN_REQUIRED') {
    mount.innerHTML = `
      <div class="prj-error">
        <strong>Projects now live in the Gecko database.</strong>
        Connect once with your Microsoft account to load them.
        <button type="button" id="prjConnect">Connect</button>
      </div>`;
    document.getElementById('prjConnect')?.addEventListener('click', async () => {
      try { await connectSupabase({ interactive: true }); load(); }
      catch (err) { toast(err.message || 'Could not connect', 'error'); }
    });
    return;
  }
  if (PRJ.error) {
    // An empty board and a failed load must never look the same.
    mount.innerHTML = `
      <div class="prj-error">
        <strong>Could not load projects.</strong>
        ${escapeHtml(PRJ.error)}
        <button type="button" id="prjRetry">Retry</button>
      </div>`;
    document.getElementById('prjRetry')?.addEventListener('click', load);
    return;
  }

  if (!PRJ.projects.length) {
    mount.innerHTML = `
      <div class="prj-empty">
        <strong>No projects yet.</strong>
        <button type="button" data-prj-open="new">Add the first one</button>
      </div>`;
    return;
  }

  const grouped = groupByStatus(PRJ.projects);
  mount.innerHTML = `
    <div class="prj-board">
      ${STATUSES.map(s => renderColumn(s, grouped[s])).join('')}
    </div>`;

  mount.querySelector('[data-prj-toggle-done]')?.addEventListener('click', () => {
    PRJ.doneOpen = !PRJ.doneOpen;
    render();
  });

  mount.querySelectorAll('.prj-status').forEach(select => {
    select.addEventListener('change', async (event) => {
      const el      = event.currentTarget;
      const id      = el.dataset.prjId;
      const status  = el.value;
      const project = PRJ.projects.find(p => p.id === id);
      if (!project) return;
      // A disabled select cannot emit a user-driven change event, so this
      // only guards against a synthetic one. render() below re-syncs the
      // displayed value either way.
      if (statusWritesInFlight.has(id)) return;

      statusWritesInFlight.add(id);
      el.disabled = true;
      try {
        await patchFields(id, { Status: status });
        // Re-find: a load() may have replaced PRJ.projects while we awaited.
        const current = PRJ.projects.find(p => p.id === id);
        if (current) {
          current.status   = status;
          // Modified moves too, so the staleness badge stays honest.
          current.modified = new Date().toISOString();
        }
        toast(`Moved to ${status}`, 'success');
      } catch (err) {
        // No optimistic update - project.status is untouched, so the
        // re-render below puts the card back exactly where it was, with an
        // enabled select showing the old value. Never hand-patch `el`: an
        // interim render may already have detached it.
        toast(err.message || 'Could not change status', 'error');
      } finally {
        statusWritesInFlight.delete(id);
        render();
      }
    });
  });
}

// ─── Modal ────────────────────────────────────────────────────────────

let editingId = null;   // null = creating
let focusBeforeModal = null;
let modalSession = 0;   // bumped on every open and close, so a write from an
                        // abandoned modal cannot act on the one that replaced it

function closeModal() {
  editingId = null;
  modalSession++;
  document.getElementById('prjBackdrop')?.setAttribute('hidden', '');
  // The node may have been detached by a background render, in which case
  // focusing it does nothing and focus is lost. Fall back to the one control
  // that is always present.
  const restoreTo = focusBeforeModal?.isConnected
    ? focusBeforeModal
    : document.getElementById('prjAdd');
  restoreTo?.focus?.();
  focusBeforeModal = null;
}

function openModal(id) {
  const backdrop = document.getElementById('prjBackdrop');
  const body     = document.getElementById('prjModalBody');
  const title    = document.getElementById('prjModalTitle');
  if (!backdrop || !body || !title) return;

  const project = id === 'new' ? null : PRJ.projects.find(p => p.id === id);
  editingId = project ? project.id : null;
  modalSession++;
  title.textContent = project ? 'Edit project' : 'New project';

  const value = key => escapeHtml(project ? project[key] : '');
  const clientOptions = ['', ...PRJ.clients].map(name =>
    `<option value="${escapeHtml(name)}"${project && project.client === name ? ' selected' : ''}>${escapeHtml(name || '— none —')}</option>`
  ).join('');
  const ownerOptions = ['', 'Jack', 'Philip'].map(name =>
    `<option value="${escapeHtml(name)}"${project && project.owner === name ? ' selected' : ''}>${escapeHtml(name || '— none —')}</option>`
  ).join('');
  const statusOptions = STATUSES.map(s =>
    `<option value="${escapeHtml(s)}"${project && project.status === s ? ' selected' : ''}>${escapeHtml(s)}</option>`
  ).join('');

  body.innerHTML = `
    <form id="prjForm" class="prj-form">
      <label>Project name<input name="Title" required value="${value('title')}"></label>
      <label>Client<select name="ClientName">${clientOptions}</select></label>
      <label>Owner<select name="Owner">${ownerOptions}</select></label>
      <label>Status<select name="Status">${statusOptions}</select></label>
      <label>Next action<input name="NextAction" value="${value('nextAction')}"
        placeholder="e.g. waiting for the DNS change to propagate"></label>
      <label>Waiting on<input name="WaitingOn" value="${value('waitingOn')}"
        placeholder="Leave empty if not blocked"></label>
      <label>Atera ticket<input name="AteraRef" value="${value('ateraRef')}" placeholder="131"></label>
      <label>Notes<textarea name="Notes" rows="4">${value('notes')}</textarea></label>
      <div class="prj-form-actions">
        ${project ? '<button type="button" class="prj-danger" id="prjDelete">Delete</button>' : ''}
        <button type="button" id="prjCancel">Cancel</button>
        <button type="submit" class="prj-primary">${project ? 'Save' : 'Create'}</button>
      </div>
    </form>`;

  focusBeforeModal = document.activeElement;
  backdrop.removeAttribute('hidden');
  body.querySelector('input[name="Title"]')?.focus();

  document.getElementById('prjCancel')?.addEventListener('click', closeModal);
  document.getElementById('prjDelete')?.addEventListener('click', () => deleteProject(editingId));
  document.getElementById('prjForm')?.addEventListener('submit', submitModal);
}

async function submitModal(event) {
  event.preventDefault();
  const form   = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  // The modal may be closed and reopened on another project while this
  // write is in flight; only tear down the modal if it is still ours.
  const target = editingId;
  const session = modalSession;
  const fields = Object.fromEntries(
    ['Title', 'ClientName', 'Owner', 'Status', 'NextAction', 'WaitingOn', 'AteraRef', 'Notes']
      .map(key => [key, form.elements[key].value.trim()])
  );
  if (!fields.Title) { toast('A project name is required', 'error'); return; }

  submit.disabled = true;
  try {
    if (target) {
      await patchFields(target, fields);
      toast('Project saved', 'success');
    } else if (backend() === 'supabase') {
      const sb = await connectSupabase();
      must(await sb.from('projects').insert(fieldsToRow(fields)).select('id').single());
      toast('Project created', 'success');
    } else {
      const siteId = await resolveSiteId();
      const listId = await resolveListId();
      await graphFetch(`/sites/${siteId}/lists/${listId}/items`, {
        method: 'POST',
        body:   JSON.stringify({ fields })
      });
      toast('Project created', 'success');
    }
    // Reload first: closeModal() restores focus, and load()'s render() would
    // detach whatever it just focused if the modal closed before the rebuild.
    await load();
    if (modalSession === session) closeModal();
  } catch (err) {
    submit.disabled = false;
    toast(err.message || 'Could not save', 'error');
  }
}

async function deleteProject(id) {
  const session = modalSession;
  const project = PRJ.projects.find(p => p.id === id);
  if (!project) return;
  if (!window.confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
  // The modal now stays open until the reload finishes, so without this a
  // second click would fire a second DELETE and toast a 404 over the success.
  const btn = document.getElementById('prjDelete');
  if (btn) btn.disabled = true;
  try {
    if (backend() === 'supabase') {
      const sb = await connectSupabase();
      must(await sb.from('projects').delete().eq('id', id).select('id').single());
    } else {
      const siteId = await resolveSiteId();
      const listId = await resolveListId();
      await graphFetch(`/sites/${siteId}/lists/${listId}/items/${id}`, { method: 'DELETE' });
    }
    toast('Project deleted', 'success');
    // Reload before closing, so focus is restored into the rebuilt board.
    await load();
    if (modalSession === session) closeModal();
  } catch (err) {
    toast(err.message || 'Could not delete', 'error');
  }
}

// ─── Copy to Supabase (only before the switch) ────────────────────────

/**
 * Copy the whole GeckoProjects list into public.projects, then read it back
 * and compare field by field. Replaces the table's contents, so it is only
 * offered while SharePoint is still the live store; SharePoint is read only.
 * ponytail: delete-then-insert is not one transaction. A failure halfway shows
 * as a mismatch and the copy is simply run again.
 */
async function copyToSupabase() {
  if (backend() === 'supabase') return;
  if (!window.confirm('Copy every project from SharePoint into the Gecko database?\n\n'
    + 'This replaces what the database holds for Projects. SharePoint is not changed.')) return;
  const btn = document.getElementById('prjCopy');
  const out = document.getElementById('prjCopyResult');
  if (btn) btn.disabled = true;
  if (out) out.textContent = 'Copying…';
  try {
    const sb     = await connectSupabase({ interactive: true });
    const siteId = await resolveSiteId();
    const listId = await resolveListId();
    const res    = await graphFetch(`/sites/${siteId}/lists/${listId}/items?expand=fields&$top=999`);
    const spRows = (res.value || []).map(spItemToRow);

    must(await sb.from('projects').delete().not('id', 'is', null));
    if (spRows.length) must(await sb.from('projects').insert(spRows));
    const result = reconcile(spRows, must(await sb.from('projects').select('*')));

    if (out) {
      out.textContent = result.ok
        ? `Copied: SharePoint ${result.spCount}, database ${result.dbCount}. Every field matches.`
        : `Not matching (${result.mismatches.length}): `
          + result.mismatches.slice(0, 5).map(m => `${m.sharepointId} ${m.problem}`.trim()).join('; ');
      out.dataset.state = result.ok ? 'ok' : 'bad';
    }
    toast(result.ok ? 'Projects copied and checked' : 'Copy finished but does not match',
      result.ok ? 'success' : 'error');
  } catch (err) {
    if (out) { out.textContent = 'Copy failed: ' + (err.message || err); out.dataset.state = 'bad'; }
    toast(err.message || 'Copy failed', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Section lifecycle ────────────────────────────────────────────────

/** Called once, by navTo, on first visit to the section. */
export function init() {
  document.getElementById('prjRefresh')?.addEventListener('click', refresh);
  document.getElementById('prjAdd')?.addEventListener('click', () => openModal('new'));
  const copy = document.getElementById('prjCopy');
  if (copy) {
    copy.hidden = backend() === 'supabase';
    copy.addEventListener('click', copyToSupabase);
  }
  // Delegated once: #prjBoard survives every render, so this covers the
  // empty state, the error state and the board itself. Binding per render
  // missed the empty state, whose early return skipped the wiring.
  document.getElementById('prjBoard')?.addEventListener('click', (event) => {
    const btn = event.target.closest?.('[data-prj-open]');
    if (btn) openModal(btn.dataset.prjOpen);
  });
  document.getElementById('prjBackdrop')?.addEventListener('click', (event) => {
    if (event.target.id === 'prjBackdrop') closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('prjBackdrop')?.hasAttribute('hidden')) {
      closeModal();
    }
  });
  load();
}

/** Called by the section's Refresh button. */
export function refresh() {
  PRJ.listId = null;   // re-resolve in case the list was only just created
  load();
}
