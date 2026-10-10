/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   DEVICES (Monitoring hub)                                        ║
   ║                                                                   ║
   ║   Every client's machines from Atera: how many, servers, still on ║
   ║   Windows 10, not seen for 30 days, and what the client is billed ║
   ║   for Atera services in Xero this month. Read only.               ║
   ║   Data: atera_agents (Edge Function atera-sync, 4× a day; Refresh ║
   ║   runs it now). Logic: core/devices.js. Design: docs/superpowers/ ║
   ║   specs/2026-10-11-atera-devices-design.md                        ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { deviceSummary, ateraBilling, STALE_DAYS } from '../core/devices.js';

const DV = { agents: null, invoices: null, status: null, error: null, open: new Set(), filter: 'attention' };
const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const FLAG = { not_billed: ['amber', 'No Atera billing'], win10: ['amber', 'Windows 10'], stale: ['blue', `Not seen ${STALE_DAYS}+ days`] };

async function load() {
  DV.error = null; render();
  try {
    const sb = await connectSupabase();
    const month = today().slice(0, 7);
    const [agents, invoices, status] = await Promise.all([
      sb.from('atera_agents').select('agent_id,customer_name,machine_name,device_type,os,os_version,online,last_seen,last_user,vendor,model').then(must),
      sb.from('xero_invoices').select('contact_name,invoice_date,status,line_items').gte('invoice_date', month + '-01').in('status', ['AUTHORISED', 'PAID']).then(must),
      sb.from('atera_status').select('*').eq('id', 1).maybeSingle().then(must)
    ]);
    DV.agents = agents; DV.invoices = invoices; DV.status = status;
  } catch (err) {
    DV.error = err;
  }
  render();
}

async function syncNow() {
  const b = els('dvRefresh');
  b?.classList.add('spinning'); if (b) b.disabled = true;
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('atera-sync', { body: {} });
    if (error) throw new Error(error.message || 'Atera sync failed');
    if (data && data.ok === false) toast(`Atera didn’t sync: ${data.error}`, 'error', 9000);
    else if (data?.ok) toast(`Synced from Atera: ${data.agents} devices, ${data.customers} customers.`, 'success');
  } catch (err) {
    toast(`Atera didn’t sync: ${err.message || err}`, 'error', 9000);
  } finally {
    b?.classList.remove('spinning'); if (b) b.disabled = false;
    await load();
  }
}

function render() {
  const mount = els('dvWrap');
  if (!mount) return;
  const sync = els('dvLastSync');
  if (sync) sync.textContent = DV.status?.last_sync_at ? `Synced ${when(DV.status.last_sync_at)}` : '';
  if (DV.error) {
    const missing = /atera_/.test(DV.error.message || '');
    mount.innerHTML = DV.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="state-error art art-offline"><strong>Connect to the Gecko database</strong><button type="button" class="btn btn-sm" data-dv-act="connect">Connect</button></div>'
      : `<div class="state-error art art-offline"><strong>Could not load devices.</strong><p>${escapeHtml(missing ? 'The devices tables aren’t in the database yet (they arrive with this update).' : DV.error.message || DV.error)}</p><button type="button" class="btn btn-sm" data-dv-act="reload">Retry</button></div>`;
    return;
  }
  if (!DV.agents) { mount.innerHTML = '<p class="state-empty art art-loading">Loading devices…</p>'; return; }
  const st = DV.status;
  const statusLine = !st?.last_sync_at ? '<div class="dv-note"><strong>Not synced from Atera yet.</strong> Press Refresh to bring the devices in (it also runs by itself four times a day).</div>'
    : st.last_sync_ok === false ? `<div class="state-error"><strong>The last Atera sync failed (${escapeHtml(when(st.last_sync_at))}).</strong><p>${escapeHtml(st.last_error)}</p></div>` : '';
  if (!DV.agents.length) { mount.innerHTML = statusLine || '<p class="state-empty art art-empty">Atera returned no devices.</p>'; return; }

  const s = deviceSummary(DV.agents, ateraBilling(DV.invoices, today().slice(0, 7)), today());
  const t = s.totals;
  const list = DV.filter === 'attention' ? s.clients.filter(c => c.flags.length) : s.clients;
  const figures = `<div class="kpi-panel dv-kpis">
    <div class="kpi"><span class="kpi-label">Devices</span><span class="kpi-value">${t.devices}</span><span class="kpi-sub">${t.workstations} workstations · ${t.servers} servers · ${t.clients} customers</span></div>
    <div class="kpi"><span class="kpi-label">Windows 10</span><span class="kpi-value${t.win10 ? ' dv-warn' : ''}">${t.win10}</span><span class="kpi-sub">Microsoft support ended 14 Oct 2025</span></div>
    <div class="kpi"><span class="kpi-label">Not seen ${STALE_DAYS}+ days</span><span class="kpi-value">${t.stale}</span><span class="kpi-sub">still counted in Atera</span></div>
    <div class="kpi"><span class="kpi-label">No Atera billing</span><span class="kpi-value${t.notBilled ? ' dv-warn' : ''}">${t.notBilled}</span><span class="kpi-sub">customers with devices, nothing billed this month</span></div>
  </div>`;
  const tabs = `<div class="dv-filter" role="group" aria-label="Show">
    <button type="button" class="btn btn-sm${DV.filter === 'attention' ? ' btn-primary' : ' btn-ghost'}" data-dv-filter="attention">Needs a look (${s.clients.filter(c => c.flags.length).length})</button>
    <button type="button" class="btn btn-sm${DV.filter === 'all' ? ' btn-primary' : ' btn-ghost'}" data-dv-filter="all">All customers (${s.clients.length})</button></div>`;
  const rows = list.map(c => {
    const open = DV.open.has(c.name);
    return `<li class="dv-client${open ? ' open' : ''}">
      <button type="button" class="dv-row" data-dv-open="${escapeHtml(c.name)}" aria-expanded="${open}">
        <span class="dv-name">${escapeHtml(c.name)}</span>
        <span class="dv-flags">${c.flags.map(f => `<span class="badge badge-${FLAG[f][0]}">${escapeHtml(FLAG[f][1])}</span>`).join(' ') || (c.internal ? '<span class="badge badge-blue">Gecko’s own</span>' : '<span class="badge badge-green">OK</span>')}</span>
        <span class="dv-fig"><small>Devices</small>${c.devices}</span>
        <span class="dv-fig"><small>Win 10</small>${c.win10}</span>
        <span class="dv-fig"><small>Atera billed</small>${c.billed ? escapeHtml(money(c.billed)) : '—'}</span>
      </button>
      ${open ? detail(c) : ''}
    </li>`;
  }).join('');
  mount.innerHTML = `<div class="app-pane">${statusLine}${figures}${tabs}
    ${list.length ? `<ul class="dv-list">${rows}</ul>` : '<p class="state-empty art art-clear">Nothing needs a look.</p>'}</div>`;
}

function detail(c) {
  const seen = a => (a.days == null ? '—' : a.days === 0 ? 'today' : a.days === 1 ? 'yesterday' : `${a.days} days ago`);
  return `<div class="dv-detail">
    ${c.internal ? '<p class="dv-sub">Gecko’s own machines: not billed to a client.</p>' : c.billedTo ? `<p class="dv-sub">Xero this month (${escapeHtml(c.billedTo)}): ${escapeHtml(c.billedLines.join(' · '))}</p>` : '<p class="dv-sub">No Atera items invoiced to this customer in Xero this month.</p>'}
    <ul class="dv-devices">${c.agents.map(a => `<li>
      <strong>${escapeHtml(a.machine_name || '—')}</strong>
      <span>${a.server ? 'Server' : 'Workstation'} · ${escapeHtml(a.os || 'OS unknown')}</span>
      ${a.win10 ? '<span class="badge badge-amber">Windows 10</span>' : ''}
      <span class="${a.days != null && a.days >= STALE_DAYS ? 'dv-warn' : 'dv-muted'}">seen ${escapeHtml(seen(a))}</span>
    </li>`).join('')}</ul>
    ${c.internal ? '' : `<div class="dv-actions">${clientLink(c.billedTo || c.name)}</div>`}
  </div>`;
}

function onClick(e) {
  if (e.target.closest('[data-open-client]')) return;
  const o = e.target.closest('[data-dv-open]');
  if (o) { const k = o.dataset.dvOpen; DV.open.has(k) ? DV.open.delete(k) : DV.open.add(k); render(); return; }
  const f = e.target.closest('[data-dv-filter]');
  if (f) { DV.filter = f.dataset.dvFilter; render(); return; }
  const a = e.target.closest('[data-dv-act]')?.dataset.dvAct;
  if (a === 'reload') load();
  if (a === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
}

export function init() {
  els('section-devices')?.addEventListener('click', onClick);
  els('dvRefresh')?.addEventListener('click', syncNow);
  load();
}
