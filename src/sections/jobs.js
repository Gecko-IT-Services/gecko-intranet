/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   JOBS                                                            ║
   ║                                                                   ║
   ║   One-off work for clients with a value, from quote to invoice,   ║
   ║   and this month's sales from Xero with what the month is on      ║
   ║   course for. Design: docs/superpowers/specs/                     ║
   ║   2026-10-08-jobs-design.md. Logic: core/jobs.js.                 ║
   ║                                                                   ║
   ║   Reads: Supabase jobs + gecko_clients, the profitability feed    ║
   ║   (window.fetchProfitFeed), and once, on request, the old         ║
   ║   GeckoProjects SharePoint list. Writes: Supabase jobs only.      ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { graphFetch, resolveSiteId, fetchAllLists } from '../core/graph.js';
import { toast, escapeHtml, syncTableLabels } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { STAGES, OPEN_STAGES, stageLabel, stageTotals, monthSales, salesHistory, PROJECT_STATUS } from '../core/jobs.js';

const JOB = {
  tab: 'jobs',
  stage: 'open',          // open | one of STAGES
  editing: new Set(),
  adding: false,
  loading: false,
  error: null,
  jobs: [], clients: [], feed: null, feedNote: '', importing: false,
  xero: null, xeroBusy: false   // public.xero_status: the direct Xero connection
};

const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const whole = n => '£' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const els = id => document.getElementById(id);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const thisMonth = () => today().slice(0, 7);
const monthName = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const shortMonth = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' });
const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const myName = () => (els('userName')?.textContent || '').trim();

// ─── Data ─────────────────────────────────────────────────────────────

async function readFeed() {
  try {
    const data = await window.fetchProfitFeed();
    if (data == null) { JOB.feedNote = 'There is no profitability feed yet, so Xero sales are not shown.'; return null; }
    if (!window.ProfitFeed.validateFeed(data).ok) { JOB.feedNote = 'The profitability feed failed its checks, so Xero sales are not shown.'; return null; }
    return data;
  } catch (err) {
    JOB.feedNote = 'The profitability feed could not be read (' + (err.message || err) + '), so Xero sales are not shown.';
    return null;
  }
}

async function load() {
  JOB.loading = true; JOB.error = null; JOB.feedNote = '';
  render();
  try {
    const sb = await connectSupabase();
    const [jobs, clients, feed, xero] = await Promise.all([
      sb.from('jobs').select('*').order('modified_at', { ascending: false }).then(must),
      sb.from('gecko_clients').select('title,status').then(must),
      readFeed(),
      // Missing table (before the Xero migration) is not an error for Jobs.
      sb.from('xero_status').select('*').eq('id', 1).maybeSingle().then(r => (r.error ? null : r.data))
    ]);
    JOB.jobs = jobs;
    JOB.xero = xero;
    JOB.feed = feed;
    const names = new Set(clients.filter(c => c.status !== 'Inactive').map(c => c.title).filter(Boolean));
    for (const j of jobs) names.add(j.client_name);
    JOB.clients = [...names].sort((a, b) => a.localeCompare(b));
  } catch (err) {
    JOB.error = err;
  } finally {
    JOB.loading = false;
    render();
  }
}

async function saveJob(id, f) {
  const value = f.value.value.trim();
  const patch = {
    client_name: f.client_name.value.trim(),
    title: f.title.value.trim(),
    status: f.status.value,
    value: value === '' ? null : Math.max(0, Number(value) || 0),
    target_date: f.target_date.value || null,
    next_step: f.next_step?.value.trim() ?? ''
  };
  if (f.invoice_ref) patch.invoice_ref = f.invoice_ref.value.trim();
  if (f.notes) patch.notes = f.notes.value.trim();
  if (!patch.client_name || !patch.title) { toast('Enter the client and what the job is', 'warning'); return; }
  if (patch.status === 'invoiced') {
    const old = JOB.jobs.find(j => j.id === Number(id));
    if (!old || old.status !== 'invoiced') patch.invoiced_at = today();
  } else patch.invoiced_at = null;
  try {
    const sb = await connectSupabase({ interactive: true });
    if (id === 'new') {
      patch.owner = myName();
      JOB.jobs.unshift(must(await sb.from('jobs').insert(patch).select('*').single()));
      JOB.adding = false;
      toast('Job added', 'success');
    } else {
      const row = must(await sb.from('jobs').update(patch).eq('id', Number(id)).select('*').single());
      JOB.jobs = JOB.jobs.map(j => (j.id === row.id ? row : j));
      JOB.editing.delete(row.id);
      toast('Saved', 'success');
    }
    if (!JOB.clients.includes(patch.client_name)) JOB.clients = [...JOB.clients, patch.client_name].sort((a, b) => a.localeCompare(b));
    render();
  } catch (err) { toast('Could not save: ' + (err.message || err), 'error', 7000); }
}

async function moveJob(id, status, btn) {
  const job = JOB.jobs.find(j => j.id === id);
  if (!job) return;
  btn.disabled = true;
  const patch = { status, invoiced_at: status === 'invoiced' ? today() : null };
  try {
    const sb = await connectSupabase({ interactive: true });
    const row = must(await sb.from('jobs').update(patch).eq('id', id).select('*').single());
    JOB.jobs = JOB.jobs.map(j => (j.id === id ? row : j));
    toast(status === 'invoiced' ? `Invoiced: ${money(row.value)} · add the Xero invoice number under Edit` : `Moved to ${stageLabel(status)}`, 'success', 5000);
    render();
  } catch (err) { btn.disabled = false; toast('Could not update: ' + (err.message || err), 'error', 7000); }
}

/** One-off: open projects from the old Projects board (SharePoint) become quoted/agreed/in-progress jobs. */
async function importProjects() {
  if (JOB.importing) return;
  JOB.importing = true; render();
  try {
    const siteId = await resolveSiteId();
    const lists = await fetchAllLists();
    const list = lists.find(l => l.displayName === 'GeckoProjects' || l.name === 'GeckoProjects');
    if (!list) { toast('There is no GeckoProjects list, so there is nothing to bring across', 'info', 6000); return; }
    let items = [], next = `/sites/${siteId}/lists/${list.id}/items?$expand=fields&$top=999`;
    while (next) { const res = await graphFetch(next); items = items.concat(res.value || []); next = res['@odata.nextLink'] || null; }
    const rows = items
      .map(it => ({ id: it.id, f: it.fields || {} }))
      .filter(({ f }) => PROJECT_STATUS[f.Status] && String(f.Title || '').trim())
      .map(({ id, f }) => ({
        source_ref: `projects:${id}`,
        client_name: String(f.ClientName || '').trim() || 'Gecko IT Services',
        title: String(f.Title).trim(),
        status: PROJECT_STATUS[f.Status],
        owner: f.Owner || '',
        next_step: [f.NextAction, f.WaitingOn ? `Waiting on: ${f.WaitingOn}` : ''].filter(Boolean).join(' · '),
        notes: [f.Notes, f.AteraRef ? `Atera ${f.AteraRef}` : ''].filter(Boolean).join('\n')
      }));
    if (!rows.length) { toast('No open projects on the old board to bring across', 'info', 6000); return; }
    const sb = await connectSupabase({ interactive: true });
    const added = must(await sb.from('jobs').upsert(rows, { onConflict: 'source_ref', ignoreDuplicates: true }).select('*'));
    toast(`Brought across ${added.length} of ${rows.length} open projects. Add a value to each.`, 'success', 7000);
    await load();
  } catch (err) {
    toast('Could not bring the projects across: ' + (err.message || err), 'error', 8000);
  } finally {
    JOB.importing = false; render();
  }
}

// ─── Rendering ────────────────────────────────────────────────────────

function render() {
  const mount = els('jobWrap');
  if (!mount) return;
  document.querySelectorAll('#section-jobs [data-job-tab]').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.jobTab === JOB.tab)));
  renderKpis();
  if (JOB.loading && !JOB.jobs.length) { mount.innerHTML = '<p class="job-empty">Loading jobs and Xero sales…</p>'; return; }
  if (JOB.error) {
    const e = JOB.error;
    mount.innerHTML = e.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="job-error"><strong>Connect to the Gecko database</strong>Jobs are kept in the database. Connect once with your Microsoft account.<button type="button" class="job-btn" data-job-act="connect">Connect</button></div>'
      : `<div class="job-error"><strong>Could not load jobs.</strong>${escapeHtml(e.message || e)}<button type="button" class="job-btn" data-job-act="reload">Retry</button></div>`;
    return;
  }
  mount.innerHTML = (JOB.feedNote ? `<p class="job-note">${escapeHtml(JOB.feedNote)}</p>` : '') +
    (JOB.tab === 'sales' ? salesHtml() : jobsHtml());
  syncTableLabels(mount);
}

function renderKpis() {
  const k = els('jobKpis');
  if (!k) return;
  if (JOB.error) { k.innerHTML = ''; return; }
  const t = stageTotals(JOB.jobs);
  const s = monthSales(JOB.feed, JOB.jobs, { month: thisMonth() });
  const m = monthName(thisMonth());
  k.innerHTML = [
    ['Invoiced this month', JOB.feed ? money(s.invoiced) : '—', JOB.feed ? `Xero, ${m}` : 'feed not available'],
    ['Projected for the month', JOB.feed ? money(s.projected) : '—', 'invoiced + still to come'],
    ['Ready to invoice', money(t.to_invoice.value), `${t.to_invoice.count} ${t.to_invoice.count === 1 ? 'job' : 'jobs'}`],
    ['Work in hand', money(t.agreed.value + t.in_progress.value), `${t.agreed.count + t.in_progress.count} agreed or in progress`],
    ['Quoted', money(t.quoted.value), `${t.quoted.count} awaiting a yes`]
  ].map(([l, v, sub]) => `<div class="job-kpi"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v)}</strong><small>${escapeHtml(sub)}</small></div>`).join('');
}

function clientOptions() {
  return `<datalist id="jobClientNames">${JOB.clients.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>`;
}

function jobForm(j) {
  const isNew = !j;
  j = j || { client_name: '', title: '', status: 'quoted', value: '', target_date: '', next_step: '', invoice_ref: '', notes: '' };
  return `<form class="job-form${isNew ? ' job-add' : ''}" data-job-form="${isNew ? 'new' : j.id}">
      ${isNew ? '<strong class="job-form-title">New job</strong>' : ''}
      <label class="wide">Client <input name="client_name" type="text" list="jobClientNames" required value="${escapeHtml(j.client_name)}" placeholder="e.g. MSA Safety"></label>
      <label class="wide">Job <input name="title" type="text" required value="${escapeHtml(j.title)}" placeholder="e.g. Server room upgrade"></label>
      <label>Value £ (net) <input name="value" type="number" min="0" step="0.01" value="${escapeHtml(j.value ?? '')}" placeholder="not priced yet"></label>
      <label>Stage <select name="status">${STAGES.map(([k, l]) => `<option value="${k}" ${k === j.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Target date <input name="target_date" type="date" value="${escapeHtml(j.target_date || '')}"></label>
      ${isNew ? '' : `<label>Xero invoice <input name="invoice_ref" type="text" value="${escapeHtml(j.invoice_ref || '')}" placeholder="INV-0000"></label>`}
      <label class="wide">Next step <input name="next_step" type="text" value="${escapeHtml(j.next_step || '')}" placeholder="e.g. Order switches"></label>
      ${isNew ? '' : `<label class="full">Notes <textarea name="notes" rows="2">${escapeHtml(j.notes || '')}</textarea></label>`}
      <div class="job-actions full">
        <button type="submit" class="job-btn">${isNew ? 'Add job' : 'Save'}</button>
        <button type="button" class="job-btn ghost" data-job-act="${isNew ? 'canceladd' : 'edit'}" data-id="${isNew ? '' : j.id}">Cancel</button>
        ${isNew ? '' : `<button type="button" class="job-btn ghost danger" data-job-act="delete" data-id="${j.id}">Delete</button>`}
      </div>
    </form>`;
}

const NEXT = {
  quoted: [['agreed', 'Agreed'], ['lost', 'Lost']],
  agreed: [['in_progress', 'Start']],
  in_progress: [['to_invoice', 'Finished, to invoice']],
  to_invoice: [['invoiced', 'Mark invoiced']],
  invoiced: [],
  lost: [['quoted', 'Reopen']]
};

function jobCard(j) {
  const editing = JOB.editing.has(j.id);
  const overdue = OPEN_STAGES.has(j.status) && j.status !== 'quoted' && j.target_date && j.target_date < today();
  const meta = [
    j.target_date ? `${j.status === 'invoiced' ? 'Due' : 'Target'} ${fmtDate(j.target_date)}` : '',
    j.status === 'invoiced' ? [j.invoice_ref, j.invoiced_at ? `invoiced ${fmtDate(j.invoiced_at)}` : ''].filter(Boolean).join(' · ') : '',
    j.owner
  ].filter(Boolean).join(' · ');
  return `<article class="job-card st-${escapeHtml(j.status)}">
    <div class="job-main">
      <div class="job-client">${escapeHtml(j.client_name)}</div>
      <div class="job-title">${escapeHtml(j.title)}</div>
      ${j.next_step ? `<div class="job-next"><span>Next</span> ${escapeHtml(j.next_step)}</div>` : ''}
    </div>
    <div class="job-value">
      <strong>${j.value == null ? '<em>No value yet</em>' : escapeHtml(money(j.value))}</strong>
      <span class="job-meta"><b class="job-dot"></b>${escapeHtml(stageLabel(j.status))}${overdue ? ' <em class="job-late">overdue</em>' : ''}</span>
      ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
    </div>
    <div class="job-actions">
      ${NEXT[j.status].map(([to, label]) => `<button type="button" class="job-btn${to === 'invoiced' || to === 'to_invoice' ? ' win' : to === 'lost' ? ' ghost' : ' ghost'}" data-job-act="move" data-status="${to}" data-id="${j.id}">${label}</button>`).join('')}
      <button type="button" class="job-btn ghost" data-job-act="edit" data-id="${j.id}" aria-expanded="${editing}">${editing ? 'Close' : 'Edit'}</button>
    </div>
    ${editing ? jobForm(j) : ''}
    ${!editing && j.notes ? `<details class="job-notes"><summary>Notes</summary><p>${escapeHtml(j.notes).replace(/\n/g, '<br>')}</p></details>` : ''}
  </article>`;
}

function jobsHtml() {
  const t = stageTotals(JOB.jobs);
  const total = Object.values(t).reduce((s, x) => s + x.value, 0) || 1;
  const tiles = STAGES.map(([key, label]) => {
    const on = JOB.stage === key || (JOB.stage === 'open' && OPEN_STAGES.has(key));
    return `<button type="button" class="job-stage st-${key}${on ? ' on' : ''}" data-job-act="stage" data-stage="${key}" aria-pressed="${on}">
        <span class="job-stage-label">${label}</span>
        <span class="job-stage-value">${escapeHtml(whole(t[key].value))}</span>
        <span class="job-stage-count">${t[key].count} ${t[key].count === 1 ? 'job' : 'jobs'}</span>
        <span class="job-stage-bar"><i style="width:${Math.round(t[key].value / total * 100)}%"></i></span>
      </button>`;
  }).join('');
  const order = Object.fromEntries(STAGES.map(([k], i) => [k, i]));
  const shown = JOB.jobs
    .filter(j => (JOB.stage === 'open' ? OPEN_STAGES.has(j.status) : j.status === JOB.stage))
    .sort((a, b) => (order[b.status] - order[a.status]) ||
      String(a.target_date || '9999').localeCompare(String(b.target_date || '9999')) ||
      (Number(b.value) || 0) - (Number(a.value) || 0));
  const heading = JOB.stage === 'open' ? 'Current jobs, nearest to invoicing first' : `${stageLabel(JOB.stage)}`;
  const imported = JOB.jobs.some(j => String(j.source_ref || '').startsWith('projects:'));
  return `<div class="job-stages">${tiles}</div>
    ${clientOptions()}
    <div class="job-list-head">
      <strong>${escapeHtml(heading)}</strong>
      ${JOB.stage !== 'open' ? '<button type="button" class="job-link" data-job-act="stage" data-stage="open">Back to current jobs</button>' : ''}
      ${JOB.adding ? '' : '<button type="button" class="job-btn" data-job-act="add">Add a job</button>'}
    </div>
    ${JOB.adding ? jobForm(null) : ''}
    <div class="job-list">${shown.map(jobCard).join('') ||
      `<p class="job-empty">${JOB.jobs.length ? 'No jobs at this stage.' : 'No jobs yet. Add MSA Safety, Onsite Commercial Services and Clarke Lane Engineering’s work with “Add a job”.'}</p>`}</div>
    ${imported ? '' : `<p class="job-note">Had projects on the old Projects board? <button type="button" class="job-link" data-job-act="import" ${JOB.importing ? 'disabled' : ''}>${JOB.importing ? 'Bringing them across…' : 'Bring the open ones across'}</button> (once; you’ll add a value to each).</p>`}`;
}

/** The direct Xero connection: connect once, then it syncs every hour on Supabase. */
function xeroHtml() {
  const x = JOB.xero;
  if (!x) return '';
  const when = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  if (!x.connected) {
    return `<div class="job-panel job-xero"><div class="job-panel-head"><strong>Connect Xero directly</strong>
        <span class="job-muted">Read-only. Invoices and repeating invoices sync every hour, so jobs can be matched to their invoice.</span></div>
      <button type="button" class="job-btn" data-job-act="xero-connect" ${JOB.xeroBusy ? 'disabled' : ''}>${JOB.xeroBusy ? 'Opening Xero…' : 'Connect Xero'}</button></div>`;
  }
  const state = x.last_sync_ok === false ? 'bad' : 'ok';
  return `<div class="job-panel job-xero" data-state="${state}">
      <div class="job-panel-head"><strong>Xero: ${escapeHtml(x.tenant_name || 'connected')}</strong>
        <span class="job-muted">${x.last_sync_at ? `${x.last_sync_ok === false ? 'Last sync failed' : 'Synced'} ${escapeHtml(when(x.last_sync_at))} · ` : ''}${escapeHtml(String(x.invoices))} invoices, ${escapeHtml(String(x.repeating))} repeating · syncs hourly</span></div>
      ${x.last_sync_ok === false ? `<p class="job-note">${escapeHtml(x.last_error)}</p>` : ''}
      <div class="job-actions"><button type="button" class="job-btn ghost" data-job-act="xero-sync" ${JOB.xeroBusy ? 'disabled' : ''}>${JOB.xeroBusy ? 'Syncing…' : 'Sync now'}</button>
        <button type="button" class="job-btn ghost" data-job-act="xero-connect">Reconnect</button></div>
    </div>`;
}

async function xeroConnect() {
  JOB.xeroBusy = true; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('xero-auth', { body: {} });
    if (error || !data?.url) throw new Error(data?.error || error?.message || 'No Xero link came back');
    window.location.href = data.url;   // Xero's consent screen; it returns to the dashboard
  } catch (err) {
    JOB.xeroBusy = false; render();
    toast('Could not start the Xero connection: ' + (err.message || err), 'error', 8000);
  }
}

async function xeroSync() {
  JOB.xeroBusy = true; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('xero-sync', { body: {} });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Sync failed');
    toast(`Xero synced: ${data.changed} invoice${data.changed === 1 ? '' : 's'} updated`, 'success');
  } catch (err) {
    toast('Xero sync failed: ' + (err.message || err), 'error', 8000);
  } finally {
    JOB.xeroBusy = false;
    load();
  }
}

/** Back from Xero's consent screen (#xero=… on the address, saved by src/main.js). */
function xeroReturn() {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem('gecko.xeroResult') || 'null'); sessionStorage.removeItem('gecko.xeroResult'); } catch { /* storage blocked */ }
  if (!r) return;
  JOB.tab = 'sales';
  if (r.result === 'connected') toast(`Xero connected: ${r.detail || 'organisation'}. Invoices are synced.`, 'success', 7000);
  else if (r.result === 'connected-sync-failed') toast('Xero connected, but the first sync failed: ' + r.detail, 'warning', 10000);
  else toast('Xero was not connected: ' + (r.detail || 'cancelled'), 'error', 10000);
}

function salesHtml() {
  if (!JOB.feed) return xeroHtml() + '<p class="job-empty">Xero sales come from the daily profitability feed, which isn’t available right now.</p>';
  const month = thisMonth();
  const s = monthSales(JOB.feed, JOB.jobs, { month });
  const hist = salesHistory(JOB.feed, { month, n: 6 });
  const max = Math.max(1, ...hist.map(h => h.total), s.projected);
  const parts = [
    ['Invoiced so far', s.invoiced, 'inv'],
    ['Repeating invoices still to come', s.toCome, 'rec'],
    ['Jobs ready to invoice', s.toInvoice, 'ready'],
    ['Jobs due to finish this month', s.dueThisMonth, 'due']
  ];
  const pTotal = s.projected || 1;
  const updated = JOB.feed.generatedAt ? new Date(JOB.feed.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return xeroHtml() + `
    <div class="job-panel">
      <div class="job-panel-head"><strong>${escapeHtml(monthName(month))}: on course for ${escapeHtml(money(s.projected))}</strong>
        <span class="job-muted">Xero figures as of ${escapeHtml(updated)} (the feed refreshes each morning)</span></div>
      <div class="job-proj-bar" role="img" aria-label="Projected ${escapeHtml(money(s.projected))}">
        ${parts.filter(([, v]) => v > 0).map(([l, v, c]) => `<i class="p-${c}" style="width:${(v / pTotal * 100).toFixed(2)}%" title="${escapeHtml(l)}: ${escapeHtml(money(v))}"></i>`).join('')}
      </div>
      <ul class="job-proj-legend">
        ${parts.map(([l, v, c]) => `<li><b class="p-${c}"></b><span>${escapeHtml(l)}</span><strong>${escapeHtml(money(v))}</strong></li>`).join('')}
      </ul>
      <p class="job-muted">Invoiced so far: ${escapeHtml(money(s.recurring))} recurring, ${escapeHtml(money(s.oneOff))} one-off.${s.other ? ` VoIP Unlimited dealer commission (${escapeHtml(money(s.other))}) is not counted as client sales.` : ''}</p>
    </div>

    <div class="job-panel">
      <div class="job-panel-head"><strong>Last six months</strong><span class="job-muted">Recurring and one-off, from Xero</span></div>
      <div class="job-hist">
        ${hist.map(h => {
          const cur = h.month === month;
          const proj = cur ? Math.max(0, s.projected - h.total) : 0;
          return `<div class="job-hist-col${cur ? ' cur' : ''}">
            <span class="job-hist-total">${h.has || cur ? escapeHtml(whole(h.total + proj)) : '—'}</span>
            <div class="job-hist-bar">
              ${proj ? `<i class="p-proj" style="height:${(proj / max * 100).toFixed(2)}%" title="Still to come ${escapeHtml(money(proj))}"></i>` : ''}
              <i class="p-oneoff" style="height:${(h.oneOff / max * 100).toFixed(2)}%" title="One-off ${escapeHtml(money(h.oneOff))}"></i>
              <i class="p-rec" style="height:${(h.recurring / max * 100).toFixed(2)}%" title="Recurring ${escapeHtml(money(h.recurring))}"></i>
            </div>
            <span class="job-hist-month">${escapeHtml(shortMonth(h.month))}</span>
          </div>`;
        }).join('')}
      </div>
      <ul class="job-proj-legend inline"><li><b class="p-rec"></b><span>Recurring</span></li><li><b class="p-oneoff"></b><span>One-off</span></li><li><b class="p-proj"></b><span>Still to come (projection)</span></li></ul>
    </div>

    ${s.recurringToCome.length ? `<div class="job-panel">
      <div class="job-panel-head"><strong>Repeating invoices not yet raised this month</strong><span class="job-muted">Billed from a repeating invoice last month; shown at last month’s amount</span></div>
      <table class="job-table"><thead><tr><th>Client</th><th class="num">Last month</th></tr></thead>
      <tbody>${s.recurringToCome.map(r => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${escapeHtml(money(r.amount))}</td></tr>`).join('')}</tbody></table>
    </div>` : ''}

    <div class="job-panel">
      <div class="job-panel-head"><strong>Invoiced in ${escapeHtml(monthName(month))}</strong><span class="job-muted">${s.rows.length} ${s.rows.length === 1 ? 'client' : 'clients'}</span></div>
      ${s.rows.length ? `<table class="job-table"><thead><tr><th>Client</th><th class="num">Recurring</th><th class="num">One-off</th><th class="num">Total</th></tr></thead>
      <tbody>${s.rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${escapeHtml(money(r.recurring))}</td><td class="num">${escapeHtml(money(r.oneOff))}</td><td class="num"><strong>${escapeHtml(money(r.total))}</strong></td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="1">Total</td><td class="num" data-label="Recurring">${escapeHtml(money(s.recurring))}</td><td class="num" data-label="One-off">${escapeHtml(money(s.oneOff))}</td><td class="num" data-label="Total"><strong>${escapeHtml(money(s.invoiced))}</strong></td></tr></tfoot></table>`
      : '<p class="job-muted">Nothing invoiced in Xero yet this month.</p>'}
    </div>`;
}

// ─── Events ───────────────────────────────────────────────────────────

async function onClick(event) {
  const tab = event.target.closest('[data-job-tab]');
  if (tab) { JOB.tab = tab.dataset.jobTab; render(); return; }
  const btn = event.target.closest('[data-job-act]');
  if (!btn || btn.disabled) return;
  const { jobAct: act } = btn.dataset;
  const id = Number(btn.dataset.id);
  if (act === 'reload') { load(); return; }
  if (act === 'connect') { try { await connectSupabase({ interactive: true }); load(); } catch (err) { toast(err.message || 'Could not connect', 'error'); } return; }
  if (act === 'stage') { JOB.stage = JOB.stage === btn.dataset.stage ? 'open' : btn.dataset.stage; render(); return; }
  if (act === 'add') { JOB.adding = true; render(); els('jobWrap')?.querySelector('[data-job-form="new"] [name="client_name"]')?.focus(); return; }
  if (act === 'canceladd') { JOB.adding = false; render(); return; }
  if (act === 'edit') { JOB.editing.has(id) ? JOB.editing.delete(id) : JOB.editing.add(id); render(); return; }
  if (act === 'move') { moveJob(id, btn.dataset.status, btn); return; }
  if (act === 'import') { importProjects(); return; }
  if (act === 'xero-connect') { xeroConnect(); return; }
  if (act === 'xero-sync') { xeroSync(); return; }
  if (act === 'delete') {
    if (!window.confirm('Delete this job?')) return;
    try {
      const sb = await connectSupabase({ interactive: true });
      must(await sb.from('jobs').delete().eq('id', id).select('id').single());
      JOB.jobs = JOB.jobs.filter(j => j.id !== id);
      JOB.editing.delete(id);
      render();
    } catch (err) { toast('Could not delete: ' + (err.message || err), 'error'); }
  }
}

function onSubmit(event) {
  const form = event.target;
  if (!form.dataset.jobForm) return;
  event.preventDefault();
  saveJob(form.dataset.jobForm, form.elements);
}

export function init() {
  const section = els('section-jobs');
  section?.addEventListener('click', onClick);
  section?.addEventListener('submit', onSubmit);
  els('jobRefresh')?.addEventListener('click', load);
  xeroReturn();
  load();
}
