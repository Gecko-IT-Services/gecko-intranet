/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   UPGRADES (Monitoring hub)                                       ║
   ║                                                                   ║
   ║   What in each client's estate needs upgrading, and how soon:     ║
   ║   Windows and Office out of support, PCs too old for Windows 11,  ║
   ║   servers, low memory, full disks, old hardware. Per client: what ║
   ║   to do per device, and Add task (pre-filled). Read only.         ║
   ║   Data: atera_agents (atera-sync). Logic: core/upgrades.js.       ║
   ║   Design: docs/superpowers/specs/2026-10-18-upgrades-design.md    ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink, syncTableLabels } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { upgrades, taskFor, SEEN_DAYS } from '../core/upgrades.js';
import { vendorMarks } from '../core/vendors.js';

const UP = { agents: null, status: null, error: null, open: new Set(), filter: 'asap', showGone: false };
const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const shortDay = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');
const PLAN = {
  replace: ['red', 'Replace PC'], upgrade: ['green', 'Free Windows 11 upgrade'], update: ['blue', 'Windows 11 update'],
  server: ['purple', 'Server'], office: ['amber', 'Office'], other: ['amber', 'To plan'],
};

async function load() {
  UP.error = null; render();
  try {
    const sb = await connectSupabase();
    const [agents, status] = await Promise.all([
      sb.from('atera_agents').select('customer_name,machine_name,device_type,os,last_seen,last_user,model,raw').then(must),
      sb.from('atera_status').select('*').eq('id', 1).maybeSingle().then(must)
    ]);
    UP.agents = agents; UP.status = status;
  } catch (err) {
    UP.error = err;
  }
  render();
}

async function syncNow() {
  const b = els('upRefresh');
  b?.classList.add('spinning'); if (b) b.disabled = true;
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('atera-sync', { body: {} });
    if (error) throw new Error(error.message || 'Atera sync failed');
    if (data && data.ok === false) toast(`Atera didn’t sync: ${data.error}`, 'error', 9000);
    else if (data?.ok) toast(`Synced from Atera: ${data.agents} devices.`, 'success');
  } catch (err) {
    toast(`Atera didn’t sync: ${err.message || err}`, 'error', 9000);
  } finally {
    b?.classList.remove('spinning'); if (b) b.disabled = false;
    await load();
  }
}

function render() {
  const mount = els('upWrap');
  if (!mount) return;
  const sync = els('upLastSync');
  if (sync) sync.textContent = UP.status?.last_sync_at ? `Synced ${when(UP.status.last_sync_at)}` : '';
  if (UP.error) {
    mount.innerHTML = UP.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="state-error art art-offline"><strong>Connect to the Gecko database</strong><button type="button" class="btn btn-sm" data-up-act="connect">Connect</button></div>'
      : `<div class="state-error art art-offline"><strong>Could not load devices.</strong><p>${escapeHtml(UP.error.message || UP.error)}</p><button type="button" class="btn btn-sm" data-up-act="reload">Retry</button></div>`;
    return;
  }
  if (!UP.agents) { mount.innerHTML = '<p class="state-empty art art-loading">Loading devices…</p>'; return; }
  const r = upgrades(UP.agents, today());
  const t = r.totals;
  const figures = `<div class="kpi-panel up-kpis">
    <div class="kpi"><span class="kpi-label">Upgrade now</span><span class="kpi-value${t.asap ? ' up-bad' : ''}">${t.asap}</span><span class="kpi-sub">devices out of support · ${t.clients} client${t.clients === 1 ? '' : 's'}</span></div>
    <div class="kpi"><span class="kpi-label">Replace</span><span class="kpi-value${t.replace ? ' up-bad' : ''}">${t.replace}</span><span class="kpi-sub">PCs too old for Windows 11</span></div>
    <div class="kpi"><span class="kpi-label">Free to fix</span><span class="kpi-value">${t.upgrade + t.update}</span><span class="kpi-sub">${t.upgrade} Windows 11 upgrade${t.upgrade === 1 ? '' : 's'} · ${t.update} Windows 11 update${t.update === 1 ? '' : 's'}</span></div>
    <div class="kpi"><span class="kpi-label">Old Office</span><span class="kpi-value${t.office ? ' up-warn' : ''}">${t.office}</span><span class="kpi-sub">no longer gets security updates</span></div>
  </div>`;
  const list = UP.filter === 'asap' ? r.clients.filter(c => c.asap) : r.clients;
  const tabs = `<div class="up-filter" role="group" aria-label="Show">
    <button type="button" class="btn btn-sm${UP.filter === 'asap' ? ' btn-primary' : ' btn-ghost'}" data-up-filter="asap">Upgrade now (${t.clients} clients)</button>
    <button type="button" class="btn btn-sm${UP.filter === 'all' ? ' btn-primary' : ' btn-ghost'}" data-up-filter="all">Everything to plan (${r.clients.filter(c => !c.own).length})</button></div>`;
  mount.innerHTML = `<div class="app-pane up-pane">${figures}
    <section class="up-block"><header><h2>By client</h2><p>Worst first. Open a client for each device and what to do; Add task puts the list on the Tasks list.</p></header>
      ${tabs}${list.length ? `<ul class="up-clients">${list.map(clientHtml).join('')}</ul>` : '<p class="up-none">Nothing out of support.</p>'}</section>
    ${r.gone.length ? goneHtml(r.gone) : ''}
    <p class="up-foot">From Atera’s device records (Windows, Office, processor, memory, disk, BIOS date), devices seen in the last ${SEEN_DAYS} days.
    Support dates are Microsoft’s published ones for Home and Pro editions. “Free Windows 11 upgrade”: the processor is on Microsoft’s list
    (Intel 8th generation and later, AMD Ryzen 2000 and later); older ones need a new PC.</p></div>`;
  syncTableLabels(mount);
}

function chips(c) {
  const items = [[c.replace, 'replace', `${c.replace} replace`], [c.server, 'server', `${c.server} server${c.server === 1 ? '' : 's'}`],
    [c.upgrade, 'upgrade', `${c.upgrade} Windows 11 upgrade${c.upgrade === 1 ? '' : 's'}`], [c.update, 'update', `${c.update} Windows 11 update${c.update === 1 ? '' : 's'}`],
    [c.office, 'office', `${c.office} old Office`]];
  return items.filter(([n]) => n).map(([, k, l]) => `<span class="badge badge-${k === 'office' ? 'amber' : PLAN[k][0]}">${escapeHtml(l)}</span>`).join(' ')
    || (c.soon ? '<span class="badge badge-amber">To plan</span>' : '');
}

function clientHtml(c) {
  const open = UP.open.has(c.name);
  return `<li class="${open ? 'open' : ''}">
    <button type="button" class="up-crow" data-up-open="${escapeHtml(c.name)}" aria-expanded="${open}">
      <span class="up-cname">${escapeHtml(c.name)}${c.own ? ' <small>Gecko’s own</small>' : ''}</span>
      <span class="up-chips">${chips(c)}</span>
      <span class="up-num${c.asap ? ' up-bad' : ''}"><small>Now</small>${c.asap}</span>
      <span class="up-num"><small>To plan</small>${c.soon}</span>
    </button>
    ${open ? detail(c) : ''}</li>`;
}

function detail(c) {
  const task = taskFor(c);
  const rows = c.devices.map(d => `<tr class="${d.level === 'asap' ? 'up-row-now' : ''}">
      <td><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml([d.user, d.model].filter(Boolean).join(' · '))}</small></td>
      <td>${d.findings.map(f => `<span class="up-find up-${f.level}">${f.what === 'Office' ? vendorMarks('Microsoft') : ''}${escapeHtml(f.text)}</span>`).join('')}</td>
      <td><span class="badge badge-${PLAN[d.plan][0]}">${escapeHtml(PLAN[d.plan][1])}</span><small>${escapeHtml([...new Set(d.findings.map(f => f.fix))].join('; '))}</small></td>
      <td>${escapeHtml(shortDay(d.lastSeen))}${d.url ? `<a class="up-atera" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">Open in Atera</a>` : ''}</td>
    </tr>`).join('');
  return `<div class="up-detail">
    <table class="up-devices"><colgroup><col style="width:24%"><col style="width:38%"><col style="width:28%"><col style="width:10%"></colgroup><thead><tr><th>Device</th><th>What’s wrong</th><th>What to do</th><th>Last seen</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="up-actions">${c.own ? '' : `<button type="button" class="btn btn-sm btn-primary" data-tk="add" data-client="${escapeHtml(c.name)}" data-title="${escapeHtml(task.title)}" data-note="${escapeHtml(task.note)}">Add task</button> ${clientLink(c.name)}`}</div>
  </div>`;
}

function goneHtml(gone) {
  return `<section class="up-block"><header><h2>Probably gone</h2><p>${gone.length} devices Atera hasn’t seen for ${SEEN_DAYS}+ days. If they’re retired, remove them from Atera and Webroot so they stop costing a licence.</p></header>
    <button type="button" class="btn btn-sm btn-ghost" data-up-act="gone" aria-expanded="${UP.showGone}">${UP.showGone ? 'Hide' : 'Show'} the ${gone.length}</button>
    ${UP.showGone ? `<ul class="up-gone">${gone.map(g => `<li><strong>${escapeHtml(g.name)}</strong><span>${escapeHtml(g.client)}</span><small>last seen ${escapeHtml(g.lastSeen ? new Date(g.lastSeen).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never')}</small></li>`).join('')}</ul>` : ''}</section>`;
}

function onClick(e) {
  if (e.target.closest('[data-open-client]') || e.target.closest('[data-tk]')) return;
  const o = e.target.closest('[data-up-open]');
  if (o) { const k = o.dataset.upOpen; UP.open.has(k) ? UP.open.delete(k) : UP.open.add(k); render(); return; }
  const f = e.target.closest('[data-up-filter]');
  if (f) { UP.filter = f.dataset.upFilter; render(); return; }
  const a = e.target.closest('[data-up-act]')?.dataset.upAct;
  if (a === 'gone') { UP.showGone = !UP.showGone; render(); }
  if (a === 'reload') load();
  if (a === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
}

export function init() {
  els('section-upgrades')?.addEventListener('click', onClick);
  els('upRefresh')?.addEventListener('click', syncNow);
  load();
}
