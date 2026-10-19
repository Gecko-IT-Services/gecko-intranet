/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   DEVICES (Monitoring hub)                                        ║
   ║                                                                   ║
   ║   Every client's machines from Atera: how many, servers, still on ║
   ║   Windows 10, not seen for 30 days, and what the client is billed ║
   ║   for Atera services in Xero this month. Read only, except "Known ║
   ║   about" on Not on this morning (core/offline.js, 19 Oct 2026).   ║
   ║   Data: atera_agents (Edge Function atera-sync, 4× a day; Refresh ║
   ║   runs it now). Logic: core/devices.js. Design: docs/superpowers/ ║
   ║   specs/2026-10-11-atera-devices-design.md                        ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { deviceSummary, ateraBilling, STALE_DAYS, ATERA_NAMES } from '../core/devices.js';
import { notOnYet } from '../core/offline.js';
import { readAll } from '../core/rows.js';

const DV = { agents: null, invoices: null, status: null, seenDays: [], hidden: [], offError: null, error: null, open: new Set(), offOpen: new Set(), filter: 'attention' };
const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const FLAG = { not_billed: ['amber', 'No Atera billing'], win10: ['amber', 'Windows 10'], stale: ['blue', `Not seen ${STALE_DAYS}+ days`] };

// What the Not on this morning check needs from Atera's record, picked out of raw by the database.
const AGENT_COLS = 'agent_id,customer_name,machine_name,device_type,os,os_version,online,last_seen,last_user,vendor,model,'
  + 'disks:raw->HardwareDisks,bios:raw->>BiosReleaseDate,reboot:raw->>LastRebootTime,battery:raw->BatteryInfo,url:raw->>AppViewUrl';
const SEEN_FROM_DAYS = 21;

/** The check's inputs: devices, the daily record and what's marked known about. */
async function readOffline(sb) {
  const since = new Date(Date.now() - SEEN_FROM_DAYS * 86400000).toISOString().slice(0, 10);
  const [agents, seenDays, hidden, status] = await Promise.all([
    sb.from('atera_agents').select(AGENT_COLS).then(must),
    readAll(() => sb.from('atera_seen_days').select('agent_id,day,first_seen,last_seen').gte('day', since).order('day').order('agent_id')),
    sb.from('device_offline_ok').select('agent_id,machine_name,until,note,updated_by').gte('until', today()).then(must),
    sb.from('atera_status').select('*').eq('id', 1).maybeSingle().then(must)
  ]);
  return { agents, seenDays, hidden, status };
}

/** For Overview › Today: who isn't on, as of the last Atera sync. Never throws. */
export async function snapshot() {
  try {
    const { agents, seenDays, hidden, status } = await readOffline(await connectSupabase());
    if (status?.last_sync_ok === false) return { ok: false, error: `the last Atera sync failed: ${status.last_error}` };
    return { ok: true, ...notOnYet({ agents, seenDays, hidden, syncedAt: status?.last_sync_at }) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function load() {
  DV.error = null; render();
  try {
    const sb = await connectSupabase();
    const month = today().slice(0, 7);
    const [agents, invoices, status] = await Promise.all([
      sb.from('atera_agents').select(AGENT_COLS).then(must),
      sb.from('xero_invoices').select('contact_name,invoice_date,status,line_items').gte('invoice_date', month + '-01').in('status', ['AUTHORISED', 'PAID']).then(must),
      sb.from('atera_status').select('*').eq('id', 1).maybeSingle().then(must)
    ]);
    DV.agents = agents; DV.invoices = invoices; DV.status = status;
    // The check's own tables arrive with their migration; until then the rest of the page still works.
    try {
      const o = await readOffline(sb);
      DV.seenDays = o.seenDays; DV.hidden = o.hidden; DV.offError = null;
    } catch (err) { DV.offError = err; }
  } catch (err) {
    DV.error = err;
  }
  render();
}

/** "Known about": leave it off the check until the date given (today by default). */
async function knownAbout(agentId, until) {
  const a = (DV.agents || []).find(x => Number(x.agent_id) === Number(agentId));
  try {
    const sb = await connectSupabase({ interactive: true });
    const me = (document.getElementById('userName')?.textContent || '').trim();
    must(await sb.from('device_offline_ok').upsert({ agent_id: Number(agentId), machine_name: a?.machine_name || '', until, updated_by: me }, { onConflict: 'agent_id' }).select('agent_id'));
    toast(`${a?.machine_name || 'That device'} is off the check until ${until === today() ? 'tomorrow' : until}.`, 'success');
    DV.hidden = [...DV.hidden.filter(h => Number(h.agent_id) !== Number(agentId)), { agent_id: Number(agentId), until }];
    render();
  } catch (err) {
    toast(`Couldn’t save that: ${err.message || err}`, 'error', 9000);
  }
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
  mount.innerHTML = `<div class="app-pane">${statusLine}${offCard()}${figures}${tabs}
    ${list.length ? `<ul class="dv-list">${rows}</ul>` : '<p class="state-empty art art-clear">Nothing needs a look.</p>'}</div>`;
}

const longWhen = iso => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : 'never');
const dayLong = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Not on this morning: the PCs that are normally on by now and aren't, and servers gone quiet, with the likely reasons. */
function offCard() {
  if (DV.offError) return `<div class="state-error dv-off"><strong>Couldn’t check which PCs are on this morning.</strong><p>${escapeHtml(/atera_seen_days|device_offline_ok/.test(DV.offError.message || '') ? 'The check’s tables aren’t in the database yet (they arrive with this update).' : DV.offError.message || DV.offError)}</p></div>`;
  if (DV.status?.last_sync_ok === false) return '';
  const r = notOnYet({ agents: DV.agents, seenDays: DV.seenDays, hidden: DV.hidden, syncedAt: DV.status?.last_sync_at });
  const asOf = DV.status?.last_sync_at ? new Date(DV.status.last_sync_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '';
  const sub = [r.state === 'closed' ? 'not a working day: servers only'
      : r.state === 'early' ? `too early to say for PCs (as of ${asOf}; checked from 09:30)` : `as of ${asOf}`,
    r.learning && r.state !== 'closed' ? `still learning which PCs are on every day: until ${dayLong(r.learnUntil)} it lists any PC that was on the last working day, in amber` : '',
    r.hidden ? `${r.hidden} marked known about` : ''].filter(Boolean).join(' · ');
  const head = `<div class="dv-off-head"><h3>Not on this morning</h3><span>${escapeHtml(sub)}</span></div>`;
  if (!r.items.length) return `<div class="dv-off">${head}<p class="dv-off-none">${r.state === 'early' ? 'Nothing to report yet.' : 'Everything that’s normally on is on.'}</p></div>`;
  const items = r.items.map(i => {
    const key = String(i.agent);
    const open = DV.offOpen.has(key);
    const badge = i.server ? '<span class="badge badge-red">Server offline</span>' : i.level === 'red' ? '<span class="badge badge-red">Not on</span>' : '<span class="badge badge-amber">Not on yet</span>';
    const client = ATERA_NAMES[i.customer] || i.customer;
    const taskNote = `Last checked in ${longWhen(i.lastSeen)}. Possible reasons:\n${i.reasons.map(x => '• ' + x.text).join('\n')}`;
    return `<li class="dv-off-item${open ? ' open' : ''}">
      <button type="button" class="dv-off-row" data-dv-off="${escapeHtml(key)}" aria-expanded="${open}">
        ${badge}<strong>${escapeHtml(i.machine)}</strong>
        <span class="dv-muted">${escapeHtml([i.user, i.customer].filter(Boolean).join(' · '))}</span>
        <span class="dv-off-seen">last seen ${escapeHtml(longWhen(i.lastSeen))}</span>
      </button>
      ${open ? `<div class="dv-off-detail">
        <p class="dv-sub">${i.server ? 'Servers should never go quiet.' : `Normally ${escapeHtml(i.usual)}${i.expectedBy ? `, expected by ${escapeHtml(i.expectedBy)}` : ''}${i.laptop ? ' (a laptop)' : ''}.`} A PC that can’t start can’t tell Atera anything, so these are the likely reasons, most telling first:</p>
        <ol class="dv-off-why">${i.reasons.map(x => `<li>${escapeHtml(x.text)}</li>`).join('')}</ol>
        <div class="dv-actions">
          ${i.url ? `<a class="btn btn-sm btn-ghost" href="${escapeHtml(i.url)}" target="_blank" rel="noopener">Open in Atera</a>` : ''}
          <button type="button" class="btn btn-sm btn-primary" data-tk="add" data-client="${escapeHtml(client)}" data-title="${escapeHtml(`${i.machine} isn’t on: find out why`)}" data-note="${escapeHtml(taskNote)}">Add task</button>
          <button type="button" class="btn btn-sm btn-ghost" data-dv-known="${escapeHtml(key)}">Known about: hide today</button>
          ${clientLink(client)}
        </div>
      </div>` : ''}
    </li>`;
  }).join('');
  return `<div class="dv-off">${head}<ul class="dv-off-list">${items}</ul></div>`;
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
  const off = e.target.closest('[data-dv-off]');
  if (off) { const k = off.dataset.dvOff; DV.offOpen.has(k) ? DV.offOpen.delete(k) : DV.offOpen.add(k); render(); return; }
  const kn = e.target.closest('[data-dv-known]');
  if (kn) { knownAbout(kn.dataset.dvKnown, today()); return; }
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
