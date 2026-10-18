/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   COVERAGE (Monitoring hub)                                       ║
   ║                                                                   ║
   ║   Is everything that should be backed up, backed up? Per client:  ║
   ║   machines with no plan or no good backup in 48 working hours,    ║
   ║   Acronis agents offline or out of date, servers in Atera with no ║
   ║   backup, SharePoint not protected. Read only.                    ║
   ║   Data: acronis_* (Edge Function acronis-sync, 4× a day; Refresh  ║
   ║   runs it now) + atera_agents. Logic: core/coverage.js. Design:   ║
   ║   docs/superpowers/specs/2026-10-18-backup-coverage-design.md     ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink, syncTableLabels } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { coverage, STALE_WORKING_HOURS } from '../core/coverage.js';
import { ATERA_NAMES } from '../core/devices.js';

const CV = { data: null, error: null, open: new Set(), filter: 'attention' };
const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const LEVEL = { red: ['red', 'Needs action'], amber: ['amber', 'Look soon'], info: ['blue', 'Note'], ok: ['green', 'OK'] };

/** Everything the page and Overview need, read once. Throws on a database error. */
async function read(sb) {
  const [tenants, items, atera, status] = await Promise.all([
    sb.from('acronis_tenants').select('tenant_id,name,kind').then(must),
    sb.from('acronis_items').select('kind,tenant_id,raw').in('kind', ['resource_status', 'agent', 'usage', 'alert']).then(must),
    sb.from('atera_agents').select('customer_name,machine_name,device_type,os,online').then(must),
    sb.from('acronis_status').select('*').eq('id', 1).maybeSingle().then(must)
  ]);
  return { result: coverage(tenants, items, atera, new Date()), status };
}

async function load() {
  CV.error = null; render();
  try {
    CV.data = await read(await connectSupabase());
  } catch (err) {
    CV.error = err;
  }
  render();
}

async function syncNow() {
  const b = els('cvRefresh');
  b?.classList.add('spinning'); if (b) b.disabled = true;
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('acronis-sync', { body: {} });
    if (error) throw new Error(error.message || 'Acronis sync failed');
    if (data && data.ok === false) toast(`Acronis didn’t sync: ${data.error}`, 'error', 9000);
    else if (data?.ok) toast(`Synced from Acronis: ${data.customers} customers.`, 'success');
  } catch (err) {
    toast(`Acronis didn’t sync: ${err.message || err}`, 'error', 9000);
  } finally {
    b?.classList.remove('spinning'); if (b) b.disabled = false;
    await load();
  }
}

function render() {
  const mount = els('cvWrap');
  if (!mount) return;
  const sync = els('cvLastSync');
  if (sync) sync.textContent = CV.data?.status?.last_sync_at ? `Synced ${when(CV.data.status.last_sync_at)}` : '';
  if (CV.error) {
    const missing = /acronis_/.test(CV.error.message || '');
    mount.innerHTML = CV.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="state-error art art-offline"><strong>Connect to the Gecko database</strong><button type="button" class="btn btn-sm" data-cv-act="connect">Connect</button></div>'
      : `<div class="state-error art art-offline"><strong>Could not load backup coverage.</strong><p>${escapeHtml(missing ? 'The Acronis tables aren’t in the database yet.' : CV.error.message || CV.error)}</p><button type="button" class="btn btn-sm" data-cv-act="reload">Retry</button></div>`;
    return;
  }
  if (!CV.data) { mount.innerHTML = '<p class="state-empty art art-loading">Loading backup coverage…</p>'; return; }
  const { result, status: st } = CV.data;
  const statusLine = !st?.last_sync_at ? '<div class="cv-note"><strong>Not synced from Acronis yet.</strong> Press Refresh (it also runs by itself four times a day).</div>'
    : st.last_sync_ok === false ? `<div class="state-error"><strong>The last Acronis sync failed (${escapeHtml(when(st.last_sync_at))}).</strong><p>${escapeHtml(st.last_error)} Figures below are from the last good sync.</p></div>`
    : (st.problems || []).length ? `<div class="cv-note"><strong>Part of the last sync didn’t come through:</strong> ${escapeHtml(st.problems.map(p => `${p.tenant} (${p.kind})`).join(', '))}. Those clients may be out of date.</div>` : '';
  if (!result.clients.length) { mount.innerHTML = statusLine || '<p class="state-empty art art-empty">Acronis returned no customers.</p>'; return; }

  const t = result.totals;
  const needs = result.clients.filter(c => c.level !== 'ok');
  const redClients = result.clients.filter(c => c.level === 'red').length;
  const figures = `<div class="kpi-panel cv-kpis">
    <div class="kpi"><span class="kpi-label">Needs action</span><span class="kpi-value${t.red ? ' cv-bad' : ''}">${t.red}</span><span class="kpi-sub">${redClients} client${redClients === 1 ? '' : 's'} · not backed up or failing</span></div>
    <div class="kpi"><span class="kpi-label">Look soon</span><span class="kpi-value${t.amber ? ' cv-warn' : ''}">${t.amber}</span><span class="kpi-sub">warnings, old agents, offline machines</span></div>
    <div class="kpi"><span class="kpi-label">Machines backed up</span><span class="kpi-value">${t.protected}<small> / ${t.machines}</small></span><span class="kpi-sub">good backup in the last ${STALE_WORKING_HOURS} working hours</span></div>
    <div class="kpi"><span class="kpi-label">SharePoint backed up</span><span class="kpi-value">${t.sharepoint}</span><span class="kpi-sub">clients with sites protected</span></div>
  </div>`;
  const tabs = `<div class="cv-filter" role="group" aria-label="Show">
    <button type="button" class="btn btn-sm${CV.filter === 'attention' ? ' btn-primary' : ' btn-ghost'}" data-cv-filter="attention">Needs a look (${needs.length})</button>
    <button type="button" class="btn btn-sm${CV.filter === 'all' ? ' btn-primary' : ' btn-ghost'}" data-cv-filter="all">All clients (${result.clients.length})</button></div>`;
  const list = CV.filter === 'attention' ? needs : result.clients;
  const rows = list.map(c => {
    const open = CV.open.has(c.name);
    const counts = ['red', 'amber'].map(l => [l, c.issues.filter(i => i.level === l).length]).filter(([, n]) => n);
    const badges = counts.length ? counts.map(([l, n]) => `<span class="badge badge-${LEVEL[l][0]}">${n} ${escapeHtml(LEVEL[l][1].toLowerCase())}</span>`).join(' ') : '<span class="badge badge-green">OK</span>';
    const first = c.issues.find(i => i.level !== 'info');
    return `<li class="cv-client cv-${c.level}${open ? ' open' : ''}">
      <button type="button" class="cv-row" data-cv-open="${escapeHtml(c.name)}" aria-expanded="${open}">
        <span class="cv-name">${escapeHtml(c.name)}</span>
        <span class="cv-flags">${badges}</span>
        <span class="cv-first">${first ? `${escapeHtml(first.what)}: ${escapeHtml(first.text)}` : ''}</span>
        <span class="cv-fig"><small>Machines</small>${c.machines.length}</span>
        <span class="cv-fig"><small>SharePoint</small>${c.m365 ? (c.m365.sites ? `${c.m365.sites} sites` : '—') : '—'}</span>
      </button>
      ${open ? detail(c) : ''}
    </li>`;
  }).join('');
  mount.innerHTML = `<div class="app-pane">${statusLine}${figures}${tabs}
    ${list.length ? `<ul class="cv-list">${rows}</ul>` : '<p class="state-empty art art-clear">Every client is covered.</p>'}
    <p class="cv-foot">From Acronis directly, not the emails: a machine that stops sending emails still shows here. Read only: fix things in the Acronis console.</p></div>`;
  syncTableLabels(mount);
}

function detail(c) {
  const issues = c.issues.length ? `<ul class="cv-issues">${c.issues.map(i => `<li><span class="badge badge-${LEVEL[i.level][0]}">${escapeHtml(LEVEL[i.level][1])}</span>
      <strong>${escapeHtml(i.what)}</strong><span>${escapeHtml(i.text)}</span></li>`).join('')}</ul>` : '<p class="cv-sub">Nothing to look at.</p>';
  const machines = c.machines.length ? `<table class="cv-machines"><thead><tr><th>Machine</th><th>Plan</th><th>Last good backup</th><th>Next</th><th>Agent</th></tr></thead><tbody>
      ${c.machines.map(m => `<tr class="${m.stale || !m.protected ? 'cv-row-bad' : ''}">
        <td>${escapeHtml(m.name)}${m.vm ? ' <small>(VM on host)</small>' : ''}</td>
        <td>${escapeHtml(m.plans.join(', ') || 'None')}</td>
        <td>${escapeHtml(m.lastSuccess ? when(m.lastSuccess) : 'Never')}${m.state === 'running' ? ` <small>backing up${m.progress != null ? ` ${escapeHtml(m.progress)}%` : ''}</small>` : ''}</td>
        <td>${escapeHtml(m.nextRun ? when(m.nextRun) : '—')}</td>
        <td>${m.agentOnline == null ? '—' : m.agentOnline ? 'Online' : 'Offline'}${m.agentVersion ? ` <small>${escapeHtml(m.agentVersion)}</small>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="cv-sub">No machines backed up in Acronis.</p>';
  const m = c.m365;
  const m365 = m ? `<p class="cv-sub">Microsoft 365 in Acronis: ${m.any ? `${m.seats} users · ${m.sites} SharePoint sites · ${m.teams} Teams` : 'not set up'}${c.alerts ? ` · ${c.alerts} open alert${c.alerts === 1 ? '' : 's'} in Acronis` : ''}</p>` : '';
  return `<div class="cv-detail">${issues}${machines}${m365}<div class="cv-actions">${clientLink(ATERA_NAMES[c.name] || c.name)}</div></div>`;
}

function onClick(e) {
  if (e.target.closest('[data-open-client]')) return;
  const o = e.target.closest('[data-cv-open]');
  if (o) { const k = o.dataset.cvOpen; CV.open.has(k) ? CV.open.delete(k) : CV.open.add(k); render(); return; }
  const f = e.target.closest('[data-cv-filter]');
  if (f) { CV.filter = f.dataset.cvFilter; render(); return; }
  const a = e.target.closest('[data-cv-act]')?.dataset.cvAct;
  if (a === 'reload') load();
  if (a === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
}

export function init() {
  els('section-coverage')?.addEventListener('click', onClick);
  els('cvRefresh')?.addEventListener('click', syncNow);
  load();
}

/**
 * For Overview › Today: what needs action, read from the database (no Acronis call). Never throws:
 * { ok, red: [{ client, what, text }], amber, syncedAt, syncOk } or { ok: false, error }.
 */
export async function snapshot() {
  try {
    const { result, status } = await read(await connectSupabase());
    const red = result.clients.flatMap(c => c.issues.filter(i => i.level === 'red').map(i => ({ client: c.name, what: i.what, text: i.text })));
    return { ok: true, red, amber: result.totals.amber, syncedAt: status?.last_sync_at || null, syncOk: status?.last_sync_ok !== false };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
