/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   JOBS                                                            ║
   ║                                                                   ║
   ║   One-off work for clients with a value, from quote to invoice,   ║
   ║   and this month's sales from Xero with what the month is on      ║
   ║   course for. Design: docs/superpowers/specs/                     ║
   ║   2026-10-08-jobs-design.md. Logic: core/jobs.js.                 ║
   ║                                                                   ║
   ║   Reads: Supabase jobs + gecko_clients, Xero (xero_invoices,      ║
   ║   xero_repeating_invoices, synced hourly; the profitability feed  ║
   ║   until Xero is connected), and once, on request, the old         ║
   ║   GeckoProjects SharePoint list. Writes: Supabase jobs only.      ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { graphFetch, resolveSiteId, fetchAllLists } from '../core/graph.js';
import { toast, escapeHtml, syncTableLabels, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { tabsHtml, moveInk, keyNav, direction } from '../core/tabs.js';
import { STAGES, OPEN_STAGES, stageLabel, stageTotals, monthSales, salesHistory, PROJECT_STATUS,
  xeroMonthSales, xeroHistory, jobInvoices, jobRaised, invoiceIndex, invoicedGroups, owed, refKey, previousMonth,
  nudgeInvoices, nudgeEmail, BOARD_STAGES, boardLanes, ideaMove, tilt } from '../core/jobs.js';
import { newOpportunity } from '../core/opportunities.js';

const JOB = {
  tab: 'jobs',
  stage: 'open',          // open | one of STAGES
  editing: new Set(),
  adding: false,
  loading: false,
  error: null,
  jobs: [], clients: [], feed: null, feedNote: '', importing: false,
  xero: null, xeroBusy: false,  // public.xero_status: the direct Xero connection
  inv: [], rep: [],             // xero_invoices (recent, unpaid, jobs' own) and xero_repeating_invoices
  invoicing: null,              // "Invoice in Xero" form: { id, key, opts, busy, error }
  allPaid: false,               // Invoiced view: show every paid job, not just the last 90 days
  nudges: new Map(),            // Owed to us: contact → last payment reminder drafted (public.payment_nudges)
  nudging: null,                // contact whose reminder is being drafted
  dir: 'from-right', animate: false,  // tab change: which way the new pane slides in
  view: 'board',                // whiteboard | list (remembered in this browser, read in init)
  opps: [], oppsError: '',      // opportunities with one-off work: the board's Ideas column
  selected: null,               // the sticky whose full card shows under the board
  addStage: 'quoted', addingIdea: false, dragging: ''
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
const when = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Sales read Xero directly once it is connected and synced; until then, the daily feed. */
const onXero = () => !!(JOB.xero?.connected && JOB.inv.length);
function sales() {
  const month = thisMonth();
  if (onXero()) return xeroMonthSales(JOB.inv, JOB.rep, JOB.jobs, { month });
  return JOB.feed ? monthSales(JOB.feed, JOB.jobs, { month }) : null;
}

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
    const [jobs, clients, feed, xero, opps] = await Promise.all([
      sb.from('jobs').select('*').order('modified_at', { ascending: false }).then(must),
      sb.from('gecko_clients').select('title,status').then(must),
      readFeed(),
      // Missing table (before the Xero migration) is not an error for Jobs.
      sb.from('xero_status').select('*').eq('id', 1).maybeSingle().then(r => (r.error ? null : r.data)),
      // The board's Ideas; if they can't be read the column says so and the jobs still show.
      sb.from('opportunities').select('id,client_name,title,status,one_off,mrr,job_id,owner,next_step').then(r => (r.error ? { error: r.error.message } : r.data))
    ]);
    JOB.jobs = jobs;
    JOB.opps = Array.isArray(opps) ? opps : [];
    JOB.oppsError = Array.isArray(opps) ? '' : opps.error;
    JOB.xero = xero;
    JOB.feed = feed;
    if (xero?.connected) await Promise.all([loadXero(sb, jobs), loadNudges(sb)]);
    else { JOB.inv = []; JOB.rep = []; }
    const names = new Set(clients.filter(c => c.status !== 'Inactive').map(c => c.title).filter(Boolean));
    for (const j of jobs) names.add(j.client_name);
    JOB.clients = [...names].sort((a, b) => a.localeCompare(b));
    const synced = els('jobLastSync');
    if (synced) synced.textContent = 'Synced ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    JOB.error = err;
  } finally {
    JOB.loading = false;
    render();
  }
}

const XERO_COLS = 'invoice_id,invoice_number,contact_id,contact_name,invoice_date,due_date,status,reference,sub_total,total,amount_due,amount_paid,repeating_invoice_id';

/** Six months of invoices, every unpaid one, and any older invoice a job names. Line items aren't needed here.
 *  Also used by Overview, so both pages read the same invoices. */
export async function fetchXero(sb, jobs) {
  let from = thisMonth();
  for (let i = 0; i < 5; i++) from = previousMonth(from);
  const [recent, unpaid, rep] = await Promise.all([
    sb.from('xero_invoices').select(XERO_COLS).gte('invoice_date', from + '-01').then(must),
    sb.from('xero_invoices').select(XERO_COLS).eq('status', 'AUTHORISED').gt('amount_due', 0).then(must),
    sb.from('xero_repeating_invoices').select('contact_name,status,reference,period,unit,next_date,end_date,sub_total').neq('status', 'DELETED').then(must)
  ]);
  const byId = new Map([...recent, ...unpaid].map(i => [i.invoice_id, i]));
  const have = new Set([...byId.values()].map(i => refKey(i.invoice_number)));
  const refs = [...new Set(jobs.flatMap(j => String(j.invoice_ref || '').split(/[,;]+/).map(r => r.trim())).filter(r => r && !have.has(refKey(r))))];
  if (refs.length) for (const i of must(await sb.from('xero_invoices').select(XERO_COLS).in('invoice_number', refs))) byId.set(i.invoice_id, i);
  return { inv: [...byId.values()], rep };
}

/** Reminders drafted in the last 90 days, newest per contact. Missing table (before its migration) is not an error. */
async function loadNudges(sb) {
  const since = new Date(Date.now() - 90 * 86400e3).toISOString();
  const r = await sb.from('payment_nudges').select('contact_name,created_at,created_by,recipient').gte('created_at', since).order('created_at', { ascending: false });
  const keep = new Map([...JOB.nudges].filter(([, n]) => n.webLink));   // this session's draft links
  JOB.nudges = new Map();
  for (const n of r.error ? [] : r.data) if (!JOB.nudges.has(n.contact_name)) JOB.nudges.set(n.contact_name, { ...n, webLink: keep.get(n.contact_name)?.webLink });
}

async function loadXero(sb, jobs) {
  ({ inv: JOB.inv, rep: JOB.rep } = await fetchXero(sb, jobs));
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
  const s = JOB.error ? null : sales();
  renderTabs(tabList(s));
  renderKpis();
  if (JOB.loading && !JOB.jobs.length) { mount.innerHTML = '<p class="job-empty">Loading…</p>'; return; }
  if (JOB.error) {
    const e = JOB.error;
    mount.innerHTML = e.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="job-error"><strong>Connect to the Gecko database</strong>Sign in once with your Microsoft account.<button type="button" class="btn btn-primary btn-sm" data-job-act="connect">Connect</button></div>'
      : `<div class="job-error"><strong>Could not load jobs.</strong>${escapeHtml(e.message || e)}<button type="button" class="btn btn-sm" data-job-act="reload">Retry</button></div>`;
    return;
  }
  mount.innerHTML = (JOB.feedNote && !onXero() && JOB.tab !== 'jobs' ? `<p class="job-note">${escapeHtml(JOB.feedNote)}</p>` : '') +
    `<div class="job-pane">${JOB.tab === 'jobs' ? jobsHtml() : tabHtml(s)}</div>`;
  if (JOB.animate) {
    JOB.animate = false;
    mount.firstElementChild?.classList.add('job-enter', JOB.dir);
  }
  syncTableLabels(mount);
}

function renderKpis() {
  const k = els('jobKpis');
  if (!k) return;
  if (JOB.error) { k.innerHTML = ''; return; }
  const t = stageTotals(JOB.jobs);
  const s = sales();
  const o = onXero() ? owed(JOB.inv, today()) : null;
  k.innerHTML = [
    ['Invoiced this month', s ? money(s.invoiced) : '—', s ? '' : 'Xero not available'],
    ['Projected for the month', s ? money(s.projected) : '—', ''],
    ...(o ? [['Owed to us', money(o.total), `${o.overdue ? `${money(o.overdue)} overdue` : 'none overdue'} · incl. VAT`]] : []),
    ['Ready to invoice', money(t.to_invoice.value), `${t.to_invoice.count} ${t.to_invoice.count === 1 ? 'job' : 'jobs'}`],
    ['Work in hand', money(t.agreed.value + t.in_progress.value), `${t.agreed.count + t.in_progress.count} ${t.agreed.count + t.in_progress.count === 1 ? 'job' : 'jobs'}`],
    ['Quoted', money(t.quoted.value), `${t.quoted.count} ${t.quoted.count === 1 ? 'job' : 'jobs'}`]
  ].map(([l, v, sub]) => `<div class="job-kpi"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v)}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div>`).join('');
}

function clientOptions() {
  return `<datalist id="jobClientNames">${JOB.clients.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>`;
}

function jobForm(j) {
  const isNew = !j;
  j = j || { client_name: '', title: '', status: JOB.addStage || 'quoted', value: '', target_date: '', next_step: '', invoice_ref: '', notes: '' };
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
        ${isNew ? '' : `<button type="button" class="btn btn-danger btn-sm" data-job-act="delete" data-id="${j.id}">Delete</button>`}
        <button type="button" class="btn btn-ghost btn-sm" data-job-act="${isNew ? 'canceladd' : 'edit'}" data-id="${isNew ? '' : j.id}">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm">${isNew ? 'Add job' : 'Save'}</button>
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
  const byNumber = JOB.byNumber || invoiceIndex(JOB.inv);
  const xi = onXero() ? jobInvoices(j, byNumber, today()) : [];
  const canInvoice = JOB.xero?.connected && ['agreed', 'in_progress', 'to_invoice'].includes(j.status);
  const invoicing = JOB.invoicing?.id === j.id;
  return `<article class="job-card st-${escapeHtml(j.status)}">
    <div class="job-main">
      <div class="job-client">${clientLink(j.client_name)}</div>
      <div class="job-title">${escapeHtml(j.title)}</div>
      ${j.next_step ? `<div class="job-next"><span>Next</span> ${escapeHtml(j.next_step)}</div>` : ''}
    </div>
    <div class="job-value">
      <strong>${j.value == null ? '<em>No value yet</em>' : escapeHtml(money(j.value))}</strong>
      <span class="job-meta"><b class="job-dot"></b>${escapeHtml(stageLabel(j.status))}${overdue ? ' <em class="job-late">overdue</em>' : ''}</span>
      ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
      ${xi.map(x => xeroBadge(j, x)).join('')}
    </div>
    <div class="job-actions">
      ${NEXT[j.status].map(([to, label]) => `<button type="button" class="btn btn-sm${(to === 'invoiced' && !canInvoice) || to === 'to_invoice' ? ' btn-success' : ''}" data-job-act="move" data-status="${to}" data-id="${j.id}">${label}</button>`).join('')}
      ${canInvoice ? `<button type="button" class="btn btn-sm${j.status === 'to_invoice' ? ' btn-success' : ''}" data-job-act="xero-invoice" data-id="${j.id}" aria-expanded="${invoicing}">${invoicing ? 'Close' : 'Invoice in Xero'}</button>` : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-job-act="edit" data-id="${j.id}" aria-expanded="${editing}">${editing ? 'Close' : 'Edit'}</button>
    </div>
    ${invoicing ? invoiceForm(j, byNumber) : ''}
    ${editing ? jobForm(j) : ''}
    ${!editing && j.notes ? `<details class="job-notes"><summary>Notes</summary><p>${escapeHtml(j.notes).replace(/\n/g, '<br>')}</p></details>` : ''}
  </article>`;
}

const XSTATE = {
  paid: ['ok', 'Paid'], due: ['wait', 'Awaiting payment'], overdue: ['bad', 'Overdue'],
  draft: ['wait', 'Draft in Xero'], void: ['bad', 'Voided in Xero'], missing: ['bad', 'Not found in Xero']
};

const xeroLink = inv => `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(inv.invoice_id)}`;

/** What Xero says about one of a job's invoice numbers. */
function xeroBadge(j, { ref, state, invoice: inv }) {
  const [tone, label] = XSTATE[state];
  let detail = '';
  if (state === 'paid') detail = `${inv.invoice_number} · ${money(inv.sub_total)} net`;
  else if (state === 'due' || state === 'overdue') detail = `${money(inv.amount_due)} due ${fmtDate(String(inv.due_date || '').slice(0, 10))}`;
  else if (state === 'missing') detail = ref;
  else if (state === 'draft') detail = `${inv.invoice_number} · ${money(inv.sub_total)} net`;
  else detail = inv.invoice_number;
  const hint = j.status === 'to_invoice' && (state === 'paid' || state === 'due' || state === 'overdue') ? ' · raised' : '';
  const name = inv ? `<a href="${escapeHtml(xeroLink(inv))}" target="_blank" rel="noopener">${escapeHtml(label)}</a>` : escapeHtml(label);
  return `<span class="job-xi" data-tone="${tone}">${name}<small>${escapeHtml(detail + hint)}</small></span>`;
}

/** "Invoice in Xero": a DRAFT sales invoice for this job, checked and sent in Xero itself. */
function invoiceForm(j, byNumber) {
  const f = JOB.invoicing;
  if (!f.opts) {
    return `<div class="job-form job-inv">${f.error
      ? `<div class="job-error full"><strong>Could not get the Xero contacts</strong>${escapeHtml(f.error)}<button type="button" class="btn btn-sm" data-job-act="xero-retry" data-id="${j.id}">Retry</button></div>`
      : '<p class="job-muted">Loading Xero contacts…</p>'}</div>`;
  }
  const { contacts, suggested, items } = f.opts;
  const raised = jobRaised(j, byNumber);
  const value = j.value == null ? '' : Math.max(0, Math.round((Number(j.value) - raised) * 100) / 100);
  const item0 = items.find(i => i.code === 'Installation') ? 'Installation' : items[0]?.code;
  const busy = f.busy ? 'disabled' : '';
  return `<form class="job-form job-inv" data-job-invoice="${j.id}">
      <strong class="job-form-title full">Draft invoice in Xero</strong>
      <label class="wide">Xero contact <select name="contact_id" required ${busy}>
        ${suggested ? '' : '<option value="">Choose the contact…</option>'}
        ${contacts.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === suggested ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
      </select></label>
      <label class="wide">Item <select name="item_code" required ${busy}>
        ${items.map(i => `<option value="${escapeHtml(i.code)}" ${i.code === item0 ? 'selected' : ''}>${escapeHtml(i.code)} (account ${escapeHtml(i.account)})</option>`).join('')}
      </select></label>
      <label class="full">Description (printed on the invoice) <textarea name="description" rows="3" required ${busy}>${escapeHtml(j.title)}</textarea></label>
      <label>Amount £ (net) <input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(value)}" ${busy}></label>
      <label class="wide">Reference <input name="reference" type="text" maxlength="255" value="${escapeHtml(j.title)}" ${busy}></label>
      <p class="job-muted full">${raised ? `${escapeHtml(money(raised))} already invoiced; amount is what’s left. ` : ''}Creates a <strong>draft</strong> only: approve and send it in Xero. Xero adds VAT.</p>
      ${f.error ? `<p class="job-note bad full">${escapeHtml(f.error)}</p>` : ''}
      <div class="job-actions full">
        <button type="button" class="btn btn-ghost btn-sm" data-job-act="xero-invoice" data-id="${j.id}">Cancel</button>
        <button type="submit" class="btn btn-success btn-sm" ${busy}>${f.busy ? 'Creating in Xero…' : 'Create draft in Xero'}</button>
      </div>
    </form>`;
}

async function openInvoice(id) {
  if (JOB.invoicing?.id === id) { JOB.invoicing = null; render(); return; }
  JOB.invoicing = { id, key: crypto.randomUUID(), opts: null, busy: false, error: '' };
  render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('xero-invoice', { body: { action: 'options', job_id: id } });
    if (error || data?.error) throw new Error(await fnError(error, data));
    if (JOB.invoicing?.id !== id) return;
    if (!data.contacts.length || !data.items.length) throw new Error('No invoices have synced from Xero yet, so there are no contacts or items to choose from. Press Sync now on Sales this month.');
    JOB.invoicing.opts = data;
  } catch (err) {
    if (JOB.invoicing?.id === id) JOB.invoicing.error = String(err.message || err);
  }
  render();
}

async function createInvoice(id, f) {
  const form = JOB.invoicing;
  if (!form || form.id !== id || form.busy) return;
  const amount = Number(f.amount.value);
  const req = {
    action: 'create', job_id: id, request_key: form.key,
    contact_id: f.contact_id.value, item_code: f.item_code.value,
    description: f.description.value.trim(), amount, reference: f.reference.value.trim()
  };
  if (!req.contact_id) { toast('Choose the Xero contact', 'warning'); return; }
  if (!req.description) { toast('Describe the work for the invoice', 'warning'); return; }
  if (!(amount > 0)) { toast('Enter the amount to invoice', 'warning'); return; }
  const contact = form.opts.contacts.find(c => c.id === req.contact_id)?.name || '';
  if (!window.confirm(`Create a draft invoice in Xero for ${contact}: ${money(amount)} + VAT?`)) return;
  form.busy = true; form.error = ''; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('xero-invoice', { body: req });
    if (error || !data?.ok) throw new Error(await fnError(error, data));
    JOB.invoicing = null;
    toast(`Draft ${data.invoice_number || 'invoice'} created in Xero for ${money(amount)} + VAT. Check it, approve and send it in Xero.`, 'success', 9000);
    await load();
  } catch (err) {
    if (JOB.invoicing) { JOB.invoicing.busy = false; JOB.invoicing.error = 'Xero did not create the invoice: ' + (err.message || err); }
    render();
  }
}

const viewToggle = () => `<div class="job-view" role="group" aria-label="Show jobs as">${[['board', 'Whiteboard'], ['list', 'List']].map(([k, l]) =>
  `<button type="button" data-job-act="view" data-view="${k}" aria-pressed="${JOB.view === k}">${l}</button>`).join('')}</div>`;

function jobsHtml() {
  if (JOB.view === 'board') return boardHtml();
  JOB.byNumber = invoiceIndex(JOB.inv);
  const t = stageTotals(JOB.jobs);
  const total = Object.values(t).reduce((s, x) => s + x.value, 0) || 1;
  const groups = onXero() ? invoicedGroups(JOB.jobs, JOB.byNumber, today()) : null;
  const awaitingCount = groups ? groups.awaiting.length : 0;
  const tiles = STAGES.map(([key, label]) => {
    const on = JOB.stage === key || (JOB.stage === 'open' && OPEN_STAGES.has(key));
    return `<button type="button" class="job-stage st-${key}${on ? ' on' : ''}" data-job-act="stage" data-stage="${key}" aria-pressed="${on}">
        <span class="job-stage-label">${label}</span>
        <span class="job-stage-value">${escapeHtml(whole(t[key].value))}</span>
        <span class="job-stage-count">${key === 'invoiced' && awaitingCount ? `${awaitingCount} awaiting payment` : `${t[key].count} ${t[key].count === 1 ? 'job' : 'jobs'}`}</span>
        <span class="job-stage-bar"><i style="width:${Math.round(t[key].value / total * 100)}%"></i></span>
      </button>`;
  }).join('');
  const order = Object.fromEntries(STAGES.map(([k], i) => [k, i]));
  const shown = JOB.jobs
    .filter(j => (JOB.stage === 'open' ? OPEN_STAGES.has(j.status) : j.status === JOB.stage))
    .sort((a, b) => (order[b.status] - order[a.status]) ||
      String(a.target_date || '9999').localeCompare(String(b.target_date || '9999')) ||
      (Number(b.value) || 0) - (Number(a.value) || 0));
  const heading = JOB.stage === 'open' ? 'Current jobs' : `${stageLabel(JOB.stage)}`;
  const imported = JOB.jobs.some(j => String(j.source_ref || '').startsWith('projects:'));
  return `<div class="job-stages">${tiles}</div>
    ${clientOptions()}
    <div class="job-list-head">
      <strong>${escapeHtml(heading)}</strong>
      ${JOB.stage !== 'open' ? '<button type="button" class="job-link" data-job-act="stage" data-stage="open">Back to current jobs</button>' : ''}
      ${viewToggle()}
      ${JOB.adding ? '' : '<button type="button" class="btn btn-primary" data-job-act="add">Add a job</button>'}
    </div>
    ${JOB.adding ? jobForm(null) : ''}
    ${JOB.stage === 'invoiced' && groups ? invoicedHtml(groups) : `<div class="job-list">${shown.map(jobCard).join('') ||
      `<p class="job-empty">${JOB.jobs.length ? 'No jobs at this stage.' : 'No jobs yet.'}</p>`}</div>`}
    ${imported ? '' : `<p class="job-note"><button type="button" class="job-link" data-job-act="import" ${JOB.importing ? 'disabled' : ''}>${JOB.importing ? 'Importing…' : 'Import open projects from the old board'}</button></p>`}`;
}

const person = name => (/^philip/i.test(name || '') ? 'philip' : /^jack/i.test(name || '') ? 'jack' : '');
const shortDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** One sticky for a job: client, job, next step, value, target date; the next move as one tap. */
function jobSticky(j) {
  const p = person(j.owner);
  const late = j.target_date && j.status !== 'quoted' && j.target_date < today();
  const xi = onXero() ? jobInvoices(j, JOB.byNumber, today()) : [];
  const xs = xi.find(x => x.state === 'overdue') || xi.find(x => x.state === 'due') || xi.find(x => x.state === 'draft');
  const [to, label] = NEXT[j.status][0] || [];
  return `<article class="job-sticky${p ? ' lp-' + p : ''}${JOB.selected === j.id ? ' on' : ''}" draggable="true" data-drag="job:${j.id}"
      data-job-act="pick" data-id="${j.id}" tabindex="0" style="--tilt:${tilt(j.id)}deg" aria-label="${escapeHtml(`${j.client_name}: ${j.title}, ${stageLabel(j.status)}`)}">
    <span class="js-tape" aria-hidden="true"></span>
    <div class="js-top"><span class="js-client">${escapeHtml(j.client_name)}</span>${p ? `<b class="js-owner" title="${escapeHtml(j.owner)}">${p[0].toUpperCase()}</b>` : ''}</div>
    <div class="js-title">${escapeHtml(j.title)}</div>
    ${j.next_step ? `<div class="js-next">${escapeHtml(j.next_step)}</div>` : ''}
    <div class="js-foot"><strong>${j.value == null ? '<em>no value</em>' : escapeHtml(whole(j.value))}</strong>
      ${j.target_date ? `<span class="js-date${late ? ' late' : ''}">${late ? 'late · ' : ''}${escapeHtml(shortDate(j.target_date))}</span>` : ''}
      ${xs ? `<span class="js-x" data-tone="${XSTATE[xs.state][0]}">${escapeHtml(XSTATE[xs.state][1])}</span>` : ''}</div>
    ${to ? `<button type="button" class="js-move" data-job-act="move" data-status="${to}" data-id="${j.id}" title="Move to ${escapeHtml(stageLabel(to))}">${escapeHtml(label)} →</button>` : ''}
  </article>`;
}

/** A pencilled sticky for an opportunity with one-off work: quote it, or (won) make the job. */
function ideaSticky(o) {
  const p = person(o.owner);
  const won = o.status === 'won';
  return `<article class="job-sticky idea${p ? ' lp-' + p : ''}" draggable="true" data-drag="opp:${o.id}" style="--tilt:${tilt(o.id + 3)}deg"
      aria-label="${escapeHtml(`Idea: ${o.client_name}: ${o.title}`)}">
    <div class="js-top"><span class="js-client">${escapeHtml(o.client_name)}</span>${won ? '<span class="badge badge-green">Won</span>' : o.status === 'proposed' ? '<span class="badge">Proposed</span>' : ''}</div>
    <div class="js-title">${escapeHtml(o.title)}</div>
    ${o.next_step ? `<div class="js-next">${escapeHtml(o.next_step)}</div>` : ''}
    <div class="js-foot"><strong>${escapeHtml(whole(o.one_off))}</strong>${Number(o.mrr) ? `<span class="js-date">+ ${escapeHtml(whole(o.mrr))}/mo</span>` : ''}</div>
    <button type="button" class="js-move" data-job-act="idea" data-stage="${won ? 'agreed' : 'quoted'}" data-id="${o.id}">${won ? 'Create job' : 'Quote it'} →</button>
  </article>`;
}

function ideaForm() {
  return `<form class="job-form job-add" data-job-idea="new">
      <strong class="job-form-title">New idea</strong>
      <label class="wide">Client <input name="client_name" type="text" list="jobClientNames" required placeholder="e.g. MSA Safety"></label>
      <label class="wide">Idea <input name="title" type="text" required placeholder="e.g. Replace the office switches"></label>
      <label>One-off £ (net) <input name="one_off" type="number" min="0" step="0.01" required placeholder="rough is fine"></label>
      <label class="wide">Next step <input name="next_step" type="text" placeholder="e.g. Mention at the next visit"></label>
      <p class="job-muted full">Goes on the Opportunities pipeline as an idea, and on this board.</p>
      <div class="job-actions full">
        <button type="button" class="btn btn-ghost btn-sm" data-job-act="cancelidea">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm">Add idea</button>
      </div>
    </form>`;
}

/**
 * The whiteboard: Ideas (opportunities with one-off work) then the open stages as columns of stickies;
 * drag a sticky to another column, or use its arrow. Invoiced and Lost are drop zones under the board.
 * Clicking a sticky shows its full card (edit, Invoice in Xero) underneath.
 */
function boardHtml() {
  JOB.byNumber = invoiceIndex(JOB.inv);
  const b = boardLanes(JOB.jobs, JOB.opps);
  const count = n => `${n} ${n === 1 ? 'job' : 'jobs'}`;
  const col = (key, label, value, n, body, add) => `<section class="job-col col-${key}" data-drop="${key}" aria-label="${escapeHtml(label)}">
      <header><strong>${escapeHtml(label)}</strong><span>${escapeHtml(whole(value))}</span><small>${escapeHtml(n)}</small></header>
      <div class="job-col-body">${body}</div>${add}</section>`;
  const ideas = col('ideas', 'Ideas', b.ideasValue, `${b.ideas.length} from Opportunities`,
    JOB.oppsError ? `<p class="job-col-note bad">Opportunities didn’t load: ${escapeHtml(JOB.oppsError)}</p>` : b.ideas.map(ideaSticky).join('') || '<p class="job-col-note">One-off ideas show here.</p>',
    '<button type="button" class="job-col-add" data-job-act="addidea">+ Idea</button>');
  const lanes = b.lanes.map(l => col(l.key, stageLabel(l.key), l.value, count(l.items.length), l.items.map(jobSticky).join(''),
    `<button type="button" class="job-col-add" data-job-act="add" data-stage="${l.key}">+ Add</button>`)).join('');
  const sel = JOB.jobs.find(j => j.id === JOB.selected);
  const imported = JOB.jobs.some(j => String(j.source_ref || '').startsWith('projects:'));
  return `${clientOptions()}
    <div class="job-list-head"><strong>Whiteboard</strong>${viewToggle()}
      ${JOB.adding || JOB.addingIdea ? '' : '<button type="button" class="btn btn-primary" data-job-act="add" data-stage="quoted">Add a job</button>'}</div>
    ${JOB.adding ? jobForm(null) : ''}${JOB.addingIdea ? ideaForm() : ''}
    <div class="job-board">${ideas}${lanes}</div>
    <div class="job-drops">
      <div class="job-drop" data-drop="invoiced"><strong>Invoiced</strong><span>${escapeHtml(count(b.done.invoiced))}</span><button type="button" class="job-link" data-job-act="liststage" data-stage="invoiced">See them</button></div>
      <div class="job-drop" data-drop="lost"><strong>Lost</strong><span>${escapeHtml(count(b.done.lost))}</span><button type="button" class="job-link" data-job-act="liststage" data-stage="lost">See them</button></div>
    </div>
    ${sel ? `<div class="job-pinned"><div class="job-list-sub"><span class="job-muted">Picked from the board</span><button type="button" class="job-link" data-job-act="pick" data-id="${sel.id}">Close</button></div>${jobCard(sel)}</div>` : ''}
    ${imported ? '' : `<p class="job-note"><button type="button" class="job-link" data-job-act="import" ${JOB.importing ? 'disabled' : ''}>${JOB.importing ? 'Importing…' : 'Import open projects from the old board'}</button></p>`}`;
}

/** A sticky dropped on a column (or a sticky's arrow): jobs move stage; ideas become jobs. */
async function dropOn(ref, stage) {
  const [kind, raw] = String(ref).split(':');
  const id = Number(raw);
  if (kind === 'job') {
    const j = JOB.jobs.find(x => x.id === id);
    if (!j || j.status === stage || stage === 'ideas') return;
    await moveJob(id, stage, { disabled: false });
    return;
  }
  const o = JOB.opps.find(x => x.id === id);
  const move = o && ideaMove(o, stage, myName());
  if (!move) { if (o && stage !== 'ideas') toast('An idea goes to Quoted or a later stage first', 'info'); return; }
  try {
    const sb = await connectSupabase({ interactive: true });
    let jobId = null;
    if (move.job) {
      const existing = must(await sb.from('jobs').select('*').eq('source_ref', move.job.source_ref).maybeSingle());
      const row = existing || must(await sb.from('jobs').insert(move.job).select('*').single());
      if (!existing) JOB.jobs.unshift(row);
      jobId = row.id;
    }
    const patch = { ...move.opp, ...(jobId ? { job_id: jobId } : {}) };
    if (patch.status === 'won' || patch.status === 'lost') patch.closed_at = new Date().toISOString();
    if (Object.keys(patch).length) {
      const row = must(await sb.from('opportunities').update(patch).eq('id', id).select('id,client_name,title,status,one_off,mrr,job_id,owner,next_step').single());
      JOB.opps = JOB.opps.map(x => (x.id === id ? row : x));
    }
    toast(move.job ? `${o.title}: now a job, ${stageLabel(stage)}${patch.status ? ` (opportunity marked ${patch.status})` : ''}` : `${o.title}: marked lost`, 'success', 6000);
    if (jobId) JOB.selected = jobId;
    render();
  } catch (err) { toast('Could not move the idea: ' + (err.message || err), 'error', 8000); }
}

async function addIdea(f) {
  const row = newOpportunity({ client: f.client_name.value, title: f.title.value, oneOff: f.one_off.value, nextStep: f.next_step.value, owner: myName() });
  if (row.error) { toast(row.error, 'warning'); return; }
  if (!(row.one_off > 0)) { toast('Give it a rough one-off value', 'warning'); return; }
  try {
    const sb = await connectSupabase({ interactive: true });
    JOB.opps.unshift(must(await sb.from('opportunities').insert(row).select('id,client_name,title,status,one_off,mrr,job_id,owner,next_step').single()));
    JOB.addingIdea = false;
    toast('Idea added (also on the Opportunities pipeline)', 'success');
    render();
  } catch (err) { toast('Could not add the idea: ' + (err.message || err), 'error', 7000); }
}

/** Drag and drop between the board's columns (mouse and trackpad; on a phone the arrows do it). */
function onDrag(e) {
  const zone = e.target.closest?.('[data-drop]');
  if (e.type === 'dragstart') {
    const s = e.target.closest?.('[data-drag]');
    if (!s) return;
    JOB.dragging = s.dataset.drag;
    e.dataTransfer.setData('text/plain', JOB.dragging);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => { s.classList.add('dragging'); els('jobWrap')?.classList.add('is-dragging'); });
  } else if (e.type === 'dragend') {
    JOB.dragging = '';
    els('jobWrap')?.classList.remove('is-dragging');
    document.querySelectorAll('#section-jobs .dragging, #section-jobs .drop-over').forEach(x => x.classList.remove('dragging', 'drop-over'));
  } else if (e.type === 'dragover' && zone && JOB.dragging) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!zone.classList.contains('drop-over')) {
      document.querySelectorAll('#section-jobs .drop-over').forEach(x => x.classList.remove('drop-over'));
      zone.classList.add('drop-over');
    }
  } else if (e.type === 'drop' && zone && JOB.dragging) {
    e.preventDefault();
    const ref = JOB.dragging;
    onDrag({ type: 'dragend', target: e.target });
    dropOn(ref, zone.dataset.drop);
  }
}

/**
 * Invoiced jobs are kept as the record (Delete is only for mistakes). Once Xero says every
 * invoice is paid the job is done; the last 90 days of those are shown, the rest on request.
 */
function invoicedHtml(g) {
  const block = (title, note, list) => list.length
    ? `<div class="job-list-sub"><strong>${escapeHtml(title)}</strong>${note ? `<span class="job-muted">${escapeHtml(note)}</span>` : ''}</div><div class="job-list">${list.map(jobCard).join('')}</div>`
    : '';
  const paid = JOB.allPaid ? g.paid : g.recent;
  const older = g.paid.length - g.recent.length;
  const html = block('Awaiting payment', '', g.awaiting) +
    block('Not matched to a Xero invoice', 'Add the invoice number under Edit', g.unmatched) +
    block('Paid', JOB.allPaid ? '' : 'Last 90 days', paid) +
    (older > 0 ? `<p class="job-note"><button type="button" class="job-link" data-job-act="allpaid">${JOB.allPaid ? 'Show only the last 90 days' : `Show ${older} older paid ${older === 1 ? 'job' : 'jobs'}`}</button></p>` : '');
  return html || '<p class="job-empty">No invoiced jobs yet.</p>';
}

/** The direct Xero connection: connect once, then it syncs every hour on Supabase. */
function xeroHtml() {
  const x = JOB.xero;
  if (!x) return '';
  if (!x.connected) {
    return `<div class="job-panel job-xero"><div class="job-panel-head"><strong><span class="xero-mark" role="img" aria-label="Xero"></span>Connect directly</strong></div>
      <button type="button" class="btn btn-primary btn-sm" data-job-act="xero-connect" ${JOB.xeroBusy ? 'disabled' : ''}>${JOB.xeroBusy ? 'Opening Xero…' : 'Connect Xero'}</button></div>`;
  }
  const state = x.last_sync_ok === false ? 'bad' : 'ok';
  return `<div class="job-panel job-xero" data-state="${state}">
      <div class="job-panel-head"><strong><span class="xero-mark" role="img" aria-label="Xero"></span>${escapeHtml(x.tenant_name || 'connected')}</strong>
        <span class="job-muted">${x.last_sync_at ? `${x.last_sync_ok === false ? 'Last sync failed' : 'Synced'} ${escapeHtml(when(x.last_sync_at))} · ` : ''}${escapeHtml(String(x.invoices))} invoices, ${escapeHtml(String(x.repeating))} repeating</span></div>
      ${x.last_sync_ok === false ? `<p class="job-note bad">${escapeHtml(x.last_error)}</p>` : ''}
      <div class="job-actions"><button type="button" class="btn btn-sm" data-job-act="xero-sync" ${JOB.xeroBusy ? 'disabled' : ''}>${JOB.xeroBusy ? 'Syncing…' : 'Sync now'}</button>
        <button type="button" class="btn btn-sm" data-job-act="xero-connect">Reconnect</button></div>
    </div>`;
}

/** supabase-js hides a function's own error behind "non-2xx status code": read the body it sent. */
async function fnError(error, data) {
  if (data?.error) return data.error;
  try { const body = await error?.context?.json(); if (body?.error) return body.error; } catch { /* not JSON */ }
  return error?.message || 'unknown error';
}

async function xeroConnect() {
  JOB.xeroBusy = true; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('xero-auth', { body: {} });
    if (error || !data?.url) throw new Error(await fnError(error, data));
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
    if (error || !data?.ok) throw new Error(await fnError(error, data));
    toast(`Xero synced: ${data.changed} invoice${data.changed === 1 ? '' : 's'} updated`, 'success');
  } catch (err) {
    toast('Xero sync failed: ' + (err.message || err), 'error', 8000);
  } finally {
    JOB.xeroBusy = false;
    load();
  }
}

/**
 * The Refresh button (Philip, 8 Oct: "refresh doesn't do anything"): asks Xero for what changed
 * since the hourly sync (so a payment just made shows), reloads, and says so. Busy while it runs.
 */
async function refresh() {
  const btn = els('jobRefresh');
  if (!btn || btn.disabled || JOB.loading) return;
  btn.disabled = true; btn.classList.add('spinning'); btn.setAttribute('aria-busy', 'true');
  let synced = '';
  try {
    if (JOB.xero?.connected) {
      try {
        const sb = await connectSupabase({ interactive: true });
        const { data, error } = await sb.functions.invoke('xero-sync', { body: {} });
        if (error || !data?.ok) throw new Error(await fnError(error, data));
        synced = data.changed ? ` · ${data.changed} invoice${data.changed === 1 ? '' : 's'} updated from Xero` : ' · Xero has nothing new';
      } catch (err) { synced = ' · Xero sync failed: ' + (err.message || err); }
    }
    await load();
    if (JOB.error) toast('Could not reload jobs: ' + (JOB.error.message || JOB.error), 'error', 8000);
    else toast('Jobs refreshed' + synced, synced.includes('failed') ? 'warning' : 'success', 6000);
  } finally {
    btn.disabled = false; btn.classList.remove('spinning'); btn.removeAttribute('aria-busy');
  }
}

/** Back from Xero's consent screen (#xero=… on the address, saved by src/main.js). */
function xeroReturn() {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem('gecko.xeroResult') || 'null'); sessionStorage.removeItem('gecko.xeroResult'); } catch { /* storage blocked */ }
  if (!r) return;
  JOB.tab = 'xero';
  if (r.result === 'connected') toast(`Xero connected: ${r.detail || 'organisation'}. Invoices are synced.`, 'success', 7000);
  else if (r.result === 'connected-sync-failed') toast('Xero connected, but the first sync failed: ' + r.detail, 'warning', 10000);
  else toast('Xero was not connected: ' + (r.detail || 'cancelled'), 'error', 10000);
}

// ─── Tabs ─────────────────────────────────────────────────────────────
// One strip at the top: Jobs, then each part of the month's sales on its own tab.

/** The tabs to show now: [key, label, badge]. Sales tabs need Xero (or the feed). */
function tabList(s) {
  const o = s && s.source === 'xero' ? owed(JOB.inv, today()) : null;
  const tabs = [['jobs', 'Jobs', String(JOB.jobs.filter(j => OPEN_STAGES.has(j.status)).length)]];
  if (s) {
    tabs.push(['overview', 'Month overview', '']);
    tabs.push(['tocome', 'Still to come', s.recurringToCome.length ? String(s.recurringToCome.length) : '']);
    tabs.push(['invoiced', `Invoiced in ${shortMonth(thisMonth())}`, s.rows.length ? String(s.rows.length) : '']);
    if (o) tabs.push(['owed', 'Owed to us', o.overdue ? 'overdue' : '']);
  }
  if (JOB.xero) tabs.push(['xero', 'Xero', JOB.xero.last_sync_ok === false ? '!' : '']);
  return tabs;
}

const tabStrip = () => document.querySelector('#section-jobs > .app-tabs, #section-jobs > .job-tabs');

function renderTabs(tabs) {
  let strip = tabStrip();
  if (!strip) return;
  // While loading, keep a tab asked for from Overview (show()) until its data is in.
  if (!JOB.loading && !tabs.some(([k]) => k === JOB.tab)) JOB.tab = 'jobs';
  const sig = tabs.map(t => t.join(':')).join('|');
  if (strip.dataset.sig !== sig) {
    strip.outerHTML = tabsHtml(tabs.map(([key, label, badge]) => ({ key, label, badge, warn: badge === 'overdue' || badge === '!' })),
      JOB.tab, { attr: 'data-job-tab', controls: 'jobWrap', label: 'Jobs views' });
    strip = tabStrip();
    strip.dataset.sig = sig;
    strip.querySelectorAll('[data-job-tab]').forEach(b => { b.id = `jobTab-${b.dataset.jobTab}`; });
  }
  strip.querySelectorAll('[data-job-tab]').forEach(b => {
    const on = b.dataset.jobTab === JOB.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  els('jobWrap')?.setAttribute('aria-labelledby', `jobTab-${JOB.tab}`);
  moveInk(strip);
}

function switchTab(key) {
  if (key === JOB.tab) return;
  const keys = [...document.querySelectorAll('#section-jobs [data-job-tab]')].map(b => b.dataset.jobTab);
  JOB.dir = direction(keys, JOB.tab, key);
  JOB.tab = key;
  JOB.animate = true;
  render();
}

function tabHtml(s) {
  const month = thisMonth();
  if (JOB.tab === 'xero') return xeroHtml() || '<p class="job-empty">Xero isn’t set up yet.</p>';
  if (!s) return '<p class="job-empty">Xero sales come from the daily profitability feed until Xero is connected, and the feed isn’t available right now.</p>';
  if (JOB.tab === 'tocome') return toComeHtml(s);
  if (JOB.tab === 'invoiced') return monthInvoicedHtml(s, month);
  if (JOB.tab === 'owed') return owedHtml(owed(JOB.inv, today()));
  return overviewHtml(s, month);
}

// ─── Sales tabs ───────────────────────────────────────────────────────
// Colours (Philip, 8 Oct: "Gecko Green & Indigo"): recurring = green, one-off = indigo; what is
// still to come is the same colour striped. Tokens --viz-* in jobs.css, validated for colour-blind
// separation and contrast in light and dark.

const asOfText = s => (s.source === 'xero'
  ? `Xero, synced ${when(JOB.xero.last_sync_at)}`
  : `Xero feed, ${JOB.feed.generatedAt ? when(JOB.feed.generatedAt) : ''}`);

function overviewHtml(s, month) {
  const direct = s.source === 'xero';
  const hist = direct ? xeroHistory(JOB.inv, { month, n: 6 }) : salesHistory(JOB.feed, { month, n: 6 });
  const jobsToCome = s.toInvoice + s.dueThisMonth;
  const parts = [
    ['Recurring invoiced', s.recurring, 'rec'],
    ['One-off invoiced', s.oneOff, 'one'],
    ['Repeating invoices still to come', s.toCome, 'rec-proj'],
    ['Jobs ready to invoice', s.toInvoice, 'one-proj'],
    ['Jobs due to finish this month', s.dueThisMonth, 'one-proj soft']
  ];
  const pTotal = s.projected || 1;
  const max = Math.max(1, ...hist.map(h => h.total), s.projected);
  const pct = v => (v / max * 100).toFixed(2);
  return `
    <div class="job-panel job-hero">
      <div class="job-hero-top">
        <div><span class="job-hero-label">${escapeHtml(monthName(month))}: on course for</span>
          <strong class="job-hero-value">${escapeHtml(money(s.projected))}</strong>
          <span class="job-muted">${escapeHtml(money(s.invoiced))} invoiced so far · ${escapeHtml(money(s.projected - s.invoiced))} still to come · net of VAT</span></div>
        <span class="job-muted">${escapeHtml(asOfText(s))}</span>
      </div>
      <div class="job-proj-bar" role="img" aria-label="${escapeHtml(parts.filter(([, v]) => v > 0).map(([l, v]) => `${l} ${money(v)}`).join(', '))}">
        ${parts.filter(([, v]) => v > 0).map(([l, v, c]) => `<i class="v-${c}" style="width:${(v / pTotal * 100).toFixed(2)}%"><span class="job-tip">${escapeHtml(l)}<b>${escapeHtml(money(v))}</b></span></i>`).join('')}
      </div>
      <ul class="job-proj-legend">
        ${parts.map(([l, v, c]) => `<li><b class="v-${c}"></b><span>${escapeHtml(l)}</span><strong>${escapeHtml(money(v))}</strong></li>`).join('')}
        <li class="total"><b></b><span>On course for</span><strong>${escapeHtml(money(s.projected))}</strong></li>
      </ul>
      ${s.other ? `<p class="job-muted">Excludes VoIP Unlimited commission (${escapeHtml(money(s.other))}).</p>` : ''}
      ${s.source === 'xero' && s.drafts.length ? `<p class="job-muted">${s.drafts.length} draft ${s.drafts.length === 1 ? 'invoice' : 'invoices'} in Xero (${escapeHtml(money(s.draftValue))}), not counted until approved.</p>` : ''}
    </div>

    <div class="job-panel">
      <div class="job-panel-head"><strong>Last six months</strong><span class="job-muted">Net of VAT</span></div>
      <div class="job-hist" role="list">
        ${hist.map(h => {
          const cur = h.month === month;
          const recTo = cur ? s.toCome : 0, oneTo = cur ? jobsToCome : 0;
          const total = h.total + recTo + oneTo;
          const seg = (cls, v) => (v > 0 ? `<i class="v-${cls}" style="height:${pct(v)}%"></i>` : '');
          const rows = [['Recurring', h.recurring, 'rec'], ['One-off', h.oneOff, 'one'], ...(cur ? [['Repeating to come', recTo, 'rec-proj'], ['Jobs to come', oneTo, 'one-proj']] : [])];
          return `<div class="job-hist-col${cur ? ' cur' : ''}" role="listitem" tabindex="0" aria-label="${escapeHtml(monthName(h.month))}: ${escapeHtml(money(total))}">
            <span class="job-hist-total">${h.has || cur ? escapeHtml(whole(total)) : '—'}</span>
            <div class="job-hist-bar">${seg('one-proj', oneTo)}${seg('rec-proj', recTo)}${seg('one', h.oneOff)}${seg('rec', h.recurring)}</div>
            <span class="job-hist-month">${escapeHtml(shortMonth(h.month))}</span>
            <div class="job-hist-tip"><strong>${escapeHtml(monthName(h.month))}</strong>
              ${rows.map(([l, v, c]) => `<span><b class="v-${c}"></b>${escapeHtml(l)}<em>${escapeHtml(money(v))}</em></span>`).join('')}
              <span class="sum">${cur ? 'On course for' : 'Total'}<em>${escapeHtml(money(total))}</em></span></div>
          </div>`;
        }).join('')}
      </div>
      <ul class="job-proj-legend inline"><li><b class="v-rec"></b><span>Recurring</span></li><li><b class="v-one"></b><span>One-off</span></li><li><b class="v-rec-proj"></b><span>Repeating still to come</span></li><li><b class="v-one-proj"></b><span>Jobs still to come</span></li></ul>
    </div>`;
}

function toComeHtml(s) {
  const direct = s.source === 'xero';
  if (!s.recurringToCome.length) return `<div class="job-panel"><div class="job-panel-head"><strong>Repeating invoices still to come</strong></div><p class="job-muted">All raised for ${escapeHtml(monthName(thisMonth()))}.</p></div>`;
  return `<div class="job-panel">
      <div class="job-panel-head"><strong>Repeating invoices still to come: ${escapeHtml(money(s.toCome))}</strong>
        <span class="job-muted">${direct ? 'Net of VAT' : 'At last month’s amount'}</span></div>
      <table class="job-table"><thead><tr><th>Client</th>${direct ? '<th>Date</th>' : ''}<th class="num">${direct ? 'Net' : 'Last month'}</th></tr></thead>
      <tbody>${s.recurringToCome.map(r => `<tr><td>${clientLink(r.name)}</td>${direct ? `<td>${escapeHtml(fmtDate(r.date))}</td>` : ''}<td class="num">${escapeHtml(money(r.amount))}</td></tr>`).join('')}</tbody></table>
    </div>
    ${s.toInvoiceJobs.length || s.dueJobs.length ? `<div class="job-panel">
      <div class="job-panel-head"><strong>Jobs still to come: ${escapeHtml(money(s.toInvoice + s.dueThisMonth))}</strong></div>
      <table class="job-table"><thead><tr><th>Client</th><th>Job</th><th class="num">Value</th></tr></thead>
      <tbody>${[...s.toInvoiceJobs, ...s.dueJobs].map(j => `<tr><td>${clientLink(j.client_name)}</td><td>${escapeHtml(j.title)} <span class="job-muted">· ${escapeHtml(stageLabel(j.status))}</span></td><td class="num">${escapeHtml(money(j.left ?? j.value))}</td></tr>`).join('')}</tbody></table>
    </div>` : ''}`;
}

function monthInvoicedHtml(s, month) {
  if (!s.rows.length) return `<div class="job-panel"><div class="job-panel-head"><strong>Invoiced in ${escapeHtml(monthName(month))}</strong></div><p class="job-muted">Nothing invoiced yet.</p></div>`;
  const top = Math.max(...s.rows.map(r => r.total), 1);
  return `<div class="job-panel">
      <div class="job-panel-head"><strong>Invoiced in ${escapeHtml(monthName(month))}: ${escapeHtml(money(s.invoiced))}</strong><span class="job-muted">${s.rows.length} ${s.rows.length === 1 ? 'client' : 'clients'} · net of VAT</span></div>
      <table class="job-table job-inv-table"><thead><tr><th>Client</th><th class="num">Recurring</th><th class="num">One-off</th><th class="num">Total</th></tr></thead>
      <tbody>${s.rows.map(r => `<tr><td><span class="job-cell-name">${clientLink(r.name)}</span>
          <span class="job-mini" aria-hidden="true"><i class="v-rec" style="width:${(r.recurring / top * 100).toFixed(2)}%"></i><i class="v-one" style="width:${(r.oneOff / top * 100).toFixed(2)}%"></i></span></td>
        <td class="num">${escapeHtml(money(r.recurring))}</td><td class="num">${escapeHtml(money(r.oneOff))}</td><td class="num"><strong>${escapeHtml(money(r.total))}</strong></td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="1">Total</td><td class="num" data-label="Recurring">${escapeHtml(money(s.recurring))}</td><td class="num" data-label="One-off">${escapeHtml(money(s.oneOff))}</td><td class="num" data-label="Total"><strong>${escapeHtml(money(s.invoiced))}</strong></td></tr></tfoot></table>
      <ul class="job-proj-legend inline"><li><b class="v-rec"></b><span>Recurring</span></li><li><b class="v-one"></b><span>One-off</span></li></ul>
    </div>`;
}

/** Unpaid invoices by client, most overdue first (Xero's amount due, incl. VAT). */
function owedHtml(o) {
  if (!o.count) return '<div class="job-panel"><div class="job-panel-head"><strong>Owed to us</strong></div><p class="job-muted">Nothing owed.</p></div>';
  return `<div class="job-panel">
      <div class="job-panel-head"><strong>Owed to us: ${escapeHtml(money(o.total))}</strong>
        <span class="job-muted">${o.count} unpaid ${o.count === 1 ? 'invoice' : 'invoices'}${o.overdue ? `, ${escapeHtml(money(o.overdue))} overdue` : ', none overdue'} · incl. VAT</span></div>
      <p class="job-muted job-owed-note">Nudge drafts a reminder in your Outlook Drafts; nothing is sent.</p>
      <table class="job-table job-owed"><thead><tr><th>Client</th><th class="num">Invoices</th><th>Oldest overdue</th><th class="num">Overdue</th><th class="num">Owed</th><th>Reminder</th></tr></thead>
      <tbody>${o.rows.map(r => `<tr><td>${clientLink(r.name)}</td><td class="num">${r.invoices}</td><td>${r.oldest ? `<span class="job-late">due ${escapeHtml(fmtDate(r.oldest))}</span>` : '—'}</td><td class="num">${r.overdue ? escapeHtml(money(r.overdue)) : '—'}</td><td class="num"><strong>${escapeHtml(money(r.due))}</strong></td><td>${nudgeCell(r)}</td></tr>`).join('')}</tbody></table>
    </div>`;
}

function nudgeCell(r) {
  const last = JOB.nudges.get(r.name);
  const busy = JOB.nudging === r.name;
  const when = last ? new Date(last.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const by = last ? String(last.created_by || '').split(/\s+/)[0] : '';
  return `<div class="job-nudge">
      ${last ? `<span class="job-muted">Nudged ${escapeHtml(when)}${by ? ` by ${escapeHtml(by)}` : ''}</span>` : ''}
      ${last?.webLink ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(last.webLink)}" target="_blank" rel="noopener">Open draft</a>` : ''}
      <button type="button" class="btn btn-sm${last || !r.overdue ? '' : ' btn-primary'}" data-job-act="nudge" data-name="${escapeHtml(r.name)}" ${busy || JOB.nudging ? 'disabled' : ''}>${busy ? 'Drafting…' : last ? 'Nudge again' : 'Nudge'}</button>
    </div>`;
}

/**
 * Draft a friendly payment reminder in the person's own Outlook Drafts (never sent from here):
 * Xero gives the contact's email and each invoice's pay-online link (xero-invoice, action 'nudge');
 * if it can't, the draft is still made, without a recipient, and the toast says so.
 */
async function nudge(name) {
  const invoices = nudgeInvoices(JOB.inv, name, today());
  if (!invoices.length) { toast(`${name} has nothing unpaid any more`, 'info'); return; }
  JOB.nudging = name; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    let info = { email: '', cc: [], firstName: '', links: {} }, missing = '';
    try {
      const { data, error } = await sb.functions.invoke('xero-invoice', { body: { action: 'nudge', contact_id: invoices[0].contact_id, invoice_ids: invoices.map(i => i.invoice_id) } });
      if (error || data?.error) throw new Error(await fnError(error, data));
      info = data;
      if (!info.email) missing = 'Xero has no email address for this contact';
    } catch (err) { missing = 'Xero didn’t answer (' + (err.message || err) + ')'; }
    const me = myName();
    const mail = nudgeEmail({ contactName: name, firstName: info.firstName, invoices, links: info.links || {}, today: today(),
      sender: me ? `Kind regards,\n${me}\nGecko IT Services` : 'Kind regards,\nGecko IT Services' });
    const draft = await graphFetch('/me/messages', {
      method: 'POST', scopes: ['Mail.ReadWrite'], interactive: true,
      body: JSON.stringify({
        subject: mail.subject, body: { contentType: 'HTML', content: mail.html },
        toRecipients: info.email ? [{ emailAddress: { address: info.email } }] : [],
        ccRecipients: (info.cc || []).map(address => ({ emailAddress: { address } }))
      })
    });
    const row = { contact_id: invoices[0].contact_id || '', contact_name: name, invoice_numbers: invoices.map(i => i.invoice_number),
      amount_due: mail.total, recipient: info.email || '', created_by: me };
    const saved = await sb.from('payment_nudges').insert(row).select('contact_name,created_at,created_by,recipient').single();
    JOB.nudges.set(name, { ...(saved.data || { ...row, created_at: new Date().toISOString() }), webLink: draft?.webLink });
    toast(info.email ? `Reminder to ${info.email} is in your Outlook Drafts. Check it and send.`
      : `Reminder is in your Outlook Drafts without a recipient: ${missing}. Add their email and send.`, info.email ? 'success' : 'warning', 9000);
  } catch (err) {
    toast('Could not create the reminder: ' + (err.message || err), 'error', 8000);
  } finally {
    JOB.nudging = null;
    render();
  }
}

// ─── Events ───────────────────────────────────────────────────────────

async function onClick(event) {
  const tab = event.target.closest('[data-job-tab]');
  if (tab) { switchTab(tab.dataset.jobTab); return; }
  const btn = event.target.closest('[data-job-act]');
  if (!btn || btn.disabled) return;
  const { jobAct: act } = btn.dataset;
  const id = Number(btn.dataset.id);
  if (act === 'reload') { load(); return; }
  if (act === 'connect') { try { await connectSupabase({ interactive: true }); load(); } catch (err) { toast(err.message || 'Could not connect', 'error'); } return; }
  if (act === 'stage') { JOB.stage = JOB.stage === btn.dataset.stage ? 'open' : btn.dataset.stage; render(); return; }
  if (act === 'view') { JOB.view = btn.dataset.view; JOB.stage = 'open'; try { localStorage.setItem('gecko.jobs.view', JOB.view); } catch { /* private window */ } render(); return; }
  if (act === 'pick') { JOB.selected = JOB.selected === id ? null : id; render(); if (JOB.selected) els('jobWrap')?.querySelector('.job-pinned')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  if (act === 'liststage') { JOB.view = 'list'; JOB.stage = btn.dataset.stage; render(); return; }
  if (act === 'idea') { dropOn(`opp:${id}`, btn.dataset.stage); return; }
  if (act === 'addidea') { JOB.addingIdea = true; JOB.adding = false; render(); els('jobWrap')?.querySelector('[data-job-idea] [name="client_name"]')?.focus(); return; }
  if (act === 'cancelidea') { JOB.addingIdea = false; render(); return; }
  if (act === 'add') { JOB.addStage = btn.dataset.stage || 'quoted'; JOB.addingIdea = false; JOB.adding = true; render(); els('jobWrap')?.querySelector('[data-job-form="new"] [name="client_name"]')?.focus(); return; }
  if (act === 'canceladd') { JOB.adding = false; render(); return; }
  if (act === 'edit') { JOB.editing.has(id) ? JOB.editing.delete(id) : JOB.editing.add(id); render(); return; }
  if (act === 'move') { moveJob(id, btn.dataset.status, btn); return; }
  if (act === 'import') { importProjects(); return; }
  if (act === 'xero-connect') { xeroConnect(); return; }
  if (act === 'xero-sync') { xeroSync(); return; }
  if (act === 'xero-invoice') { openInvoice(id); return; }
  if (act === 'xero-retry') { JOB.invoicing = null; openInvoice(id); return; }
  if (act === 'allpaid') { JOB.allPaid = !JOB.allPaid; render(); return; }
  if (act === 'nudge') { nudge(btn.dataset.name); return; }
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

/** Arrow keys move along the tab strip (ARIA tabs pattern). */
const onKey = event => {
  const st = event.target.closest?.('.job-sticky[data-job-act="pick"]');
  if (st && event.target === st && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); st.click(); return; }
  keyNav(event, 'data-job-tab', switchTab);
};

function onSubmit(event) {
  const form = event.target;
  if (form.dataset.jobInvoice) { event.preventDefault(); createInvoice(Number(form.dataset.jobInvoice), form.elements); return; }
  if (form.dataset.jobIdea) { event.preventDefault(); addIdea(form.elements); return; }
  if (!form.dataset.jobForm) return;
  event.preventDefault();
  saveJob(form.dataset.jobForm, form.elements);
}

/** Open a tab (from Overview's tiles and list): 'jobs', 'overview', 'tocome', 'invoiced', 'owed', 'xero'. */
export function show(tab) {
  if (!tab || tab === JOB.tab) return;
  JOB.tab = tab;
  JOB.animate = false;
  if (!JOB.loading) render();
}

export function init() {
  try { JOB.view = localStorage.getItem('gecko.jobs.view') || 'board'; } catch { /* private window: the board */ }
  const section = els('section-jobs');
  section?.addEventListener('click', onClick);
  section?.addEventListener('submit', onSubmit);
  section?.addEventListener('keydown', onKey);
  for (const t of ['dragstart', 'dragend', 'dragover', 'drop']) section?.addEventListener(t, onDrag);
  window.addEventListener('resize', () => moveInk(tabStrip()));
  els('jobRefresh')?.addEventListener('click', refresh);
  xeroReturn();
  load();
}
