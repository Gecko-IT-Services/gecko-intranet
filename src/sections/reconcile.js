/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   RECONCILE (Clients hub)                                         ║
   ║                                                                   ║
   ║   Per client and product: what the client uses (Webroot, Acronis  ║
   ║   live; Keeper and Work from Home typed here), what it costs at   ║
   ║   Atera's prices, and what Xero's repeating invoices bill. Every  ║
   ║   gap has its action: the exact repeating-invoice change with a   ║
   ║   link to it in Xero, or a box to record what a flat fee covers.  ║
   ║   Writes only atera_reconcile_inputs. Logic: core/reconcile.js.   ║
   ║   Design: docs/superpowers/specs/2026-10-18-atera-reconcile-      ║
   ║   design.md                                                       ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink, syncTableLabels } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { reconcileAll, productLabel, DEAD_DAYS } from '../core/reconcile.js';
import { sameAteraClient } from '../core/devices.js';
import { sameClient } from '../core/client.js';

const RC = { raw: null, error: null, open: new Set(), filter: 'attention', saving: false, editing: null };
const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const gbp = n => (n == null ? '—' : (n < 0 ? '−£' : '£') + Math.abs(Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const myName = () => (els('userName')?.textContent || '').trim();
const STATE = {
  leak: ['red', 'Bill more'], unbilled: ['red', 'Not billed'], over: ['amber', 'Over-billed'], check: ['amber', 'Check'],
  grown: ['amber', 'Grown'], record: ['blue', 'Record'], enter: ['blue', 'Enter'], ok: ['green', 'OK']
};

async function load() {
  RC.error = null; render();
  try {
    const sb = await connectSupabase();
    const [repeating, webrootSites, webrootEndpoints, acronisTenants, acronisUsage, inputs, agents, bills, wst, ast] = await Promise.all([
      sb.from('xero_repeating_invoices').select('repeating_invoice_id,contact_name,status,unit,period,next_date,line_items').then(must),
      sb.from('webroot_sites').select('site_id,name,raw').then(must),
      sb.from('webroot_endpoints').select('site_id,hostname,raw').then(must),
      sb.from('acronis_tenants').select('tenant_id,name,kind').then(must),
      sb.from('acronis_items').select('tenant_id,raw').eq('kind', 'usage').like('raw->>name', 'pw_base_%').then(must),
      sb.from('atera_reconcile_inputs').select('*').then(must),
      sb.from('atera_agents').select('customer_name,machine_name,device_type,online').then(must),
      sb.from('atera_bills').select('usd,gbp,charged_on').not('gbp', 'is', null).order('charged_on', { ascending: false }).limit(1).then(must),
      sb.from('webroot_status').select('*').eq('id', 1).maybeSingle().then(must),
      sb.from('acronis_status').select('*').eq('id', 1).maybeSingle().then(must)
    ]);
    const rate = bills[0] && Number(bills[0].usd) ? Number(bills[0].gbp) / Number(bills[0].usd) : null;
    RC.raw = { repeating, webrootSites, webrootEndpoints, acronisTenants, acronisUsage, inputs, agents, rate, webrootStatus: wst, acronisStatus: ast };
  } catch (err) {
    RC.error = err;
  }
  render();
}

const result = () => reconcileAll({ ...RC.raw, now: new Date() });

function render() {
  const mount = els('rcWrap');
  if (!mount) return;
  const sync = els('rcLastSync');
  if (sync) sync.textContent = RC.raw?.webrootStatus?.last_sync_at ? `Webroot ${when(RC.raw.webrootStatus.last_sync_at)} · Acronis ${when(RC.raw.acronisStatus?.last_sync_at)}` : '';
  if (RC.error) {
    const missing = /atera_reconcile|webroot_|acronis_/.test(RC.error.message || '');
    mount.innerHTML = RC.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="state-error art art-offline"><strong>Connect to the Gecko database</strong><button type="button" class="btn btn-sm" data-rc-act="connect">Connect</button></div>'
      : `<div class="state-error art art-offline"><strong>Could not load the reconcile.</strong><p>${escapeHtml(missing ? 'The reconcile tables aren’t in the database yet.' : RC.error.message || RC.error)}</p><button type="button" class="btn btn-sm" data-rc-act="reload">Retry</button></div>`;
    return;
  }
  if (!RC.raw) { mount.innerHTML = '<p class="state-empty art art-loading">Loading the reconcile…</p>'; return; }
  const r = result();
  const t = r.totals;
  const stale = [['Webroot', RC.raw.webrootStatus], ['Acronis', RC.raw.acronisStatus]].filter(([, s]) => s?.last_sync_ok === false);
  const statusLine = stale.length ? `<div class="state-error"><strong>The last ${stale.map(s => s[0]).join(' and ')} sync failed.</strong><p>${escapeHtml(stale.map(s => s[1].last_error).join(' · '))} Counts below are from the last good sync.</p></div>` : '';
  const figures = `<div class="kpi-panel rc-kpis">
    <div class="kpi"><span class="kpi-label">To bill</span><span class="kpi-value${t.leakGbp ? ' rc-bad' : ''}">${escapeHtml(gbp(t.leakGbp))}</span><span class="kpi-sub">a month: in use, not on the invoice</span></div>
    <div class="kpi"><span class="kpi-label">Over-billed</span><span class="kpi-value${t.overGbp ? ' rc-warn' : ''}">${escapeHtml(gbp(t.overGbp))}</span><span class="kpi-sub">a month: billed for more than is in use</span></div>
    <div class="kpi"><span class="kpi-label">Dead devices</span><span class="kpi-value${t.deadDevices ? ' rc-warn' : ''}">${t.deadDevices}</span><span class="kpi-sub">in Webroot, not seen ${DEAD_DAYS}+ days ($${t.deadUsd.toFixed(2)}/mo)</span></div>
    <div class="kpi"><span class="kpi-label">To record</span><span class="kpi-value">${t.toRecord}</span><span class="kpi-sub">flat fees and counts to note once</span></div>
  </div>`;
  const needs = r.clients.filter(c => c.issues);
  const list = RC.filter === 'attention' ? needs : r.clients;
  const tabs = `<div class="rc-filter" role="group" aria-label="Show">
    <button type="button" class="btn btn-sm${RC.filter === 'attention' ? ' btn-primary' : ' btn-ghost'}" data-rc-filter="attention">Needs a look (${needs.length})</button>
    <button type="button" class="btn btn-sm${RC.filter === 'all' ? ' btn-primary' : ' btn-ghost'}" data-rc-filter="all">All clients (${r.clients.length})</button></div>`;
  const rows = list.map(c => {
    const open = RC.open.has(c.name);
    const states = [...new Set(c.rows.filter(x => x.state !== 'ok').map(x => x.state))];
    const badges = [...states.map(s => `<span class="badge badge-${STATE[s][0]}">${escapeHtml(STATE[s][1])}</span>`),
      c.dead.length ? `<span class="badge badge-amber">${c.dead.length} dead</span>` : '', c.belowCost ? '<span class="badge badge-red">Below cost</span>' : ''].filter(Boolean).join(' ')
      || (c.own ? '<span class="badge badge-blue">Gecko’s own</span>' : '<span class="badge badge-green">OK</span>');
    const first = c.rows.find(x => x.state !== 'ok');
    return `<li class="rc-client${open ? ' open' : ''}">
      <button type="button" class="rc-row" data-rc-open="${escapeHtml(c.name)}" aria-expanded="${open}">
        <span class="rc-name">${escapeHtml(c.name)}</span>
        <span class="rc-flags">${badges}</span>
        <span class="rc-first">${first ? `${escapeHtml(productLabel(first.product))}: ${escapeHtml(first.text)}` : ''}</span>
        <span class="rc-fig"><small>Billed</small>${escapeHtml(gbp(c.monthly))}</span>
        <span class="rc-fig"><small>Costs</small>${escapeHtml(gbp(c.costGbp))}</span>
      </button>
      ${open ? detail(c) : ''}
    </li>`;
  }).join('');
  mount.innerHTML = `<div class="app-pane">${statusLine}${figures}${tabs}
    ${list.length ? `<ul class="rc-list">${rows}</ul>` : '<p class="state-empty art art-clear">Everything reconciles.</p>'}
    <p class="rc-foot">Used: Webroot and Acronis live, Keeper and Work from Home as entered here. Billed: Xero repeating invoices (synced hourly).
    Costs at Atera’s prices${RC.raw.rate ? `, £ at ${RC.raw.rate.toFixed(4)} per $ (last Atera receipt)` : ''}. Gecko HQ never changes an invoice or a device: the links open the place to do it.</p></div>`;
  syncTableLabels(mount);
}

function actionHtml(c, x) {
  const a = x.action;
  if (!a) return '';
  if (a.kind === 'repeating' && a.to != null) return `<a class="btn btn-sm btn-primary" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Change ${escapeHtml(a.from)} → ${escapeHtml(a.to)} in Xero</a>`;
  if (a.kind === 'repeating') return `<a class="btn btn-sm" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Review the fee in Xero</a>`;
  if (a.kind === 'add_line') return `<a class="btn btn-sm btn-primary" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Add ${escapeHtml(a.to)} × ${escapeHtml(a.line)} in Xero</a>`;
  if (a.kind === 'record' || a.kind === 'enter') {
    const key = `${c.name}|${x.product}`;
    if (RC.editing !== key) return `<button type="button" class="btn btn-sm" data-rc-edit="${escapeHtml(key)}">${a.kind === 'record' ? 'Record' : x.product === 'wfh' ? 'Pick devices' : 'Enter'}</button>`;
    return editorHtml(c, x);
  }
  return '';
}

function editorHtml(c, x) {
  if (x.product === 'wfh') {
    const devices = RC.raw.agents.filter(a => sameAteraClient(a.customer_name, c.name) || sameClient(a.customer_name, c.name));
    const ticked = new Set(inputFor(c.name, 'wfh', 'in_use')?.devices || []);
    return `<form class="rc-edit" data-rc-form="wfh|${escapeHtml(c.name)}">
      ${devices.length ? `<fieldset><legend>Devices with Work from Home</legend>${devices.map(d => `<label><input type="checkbox" name="d" value="${escapeHtml(d.machine_name)}"${ticked.has(d.machine_name) ? ' checked' : ''}> ${escapeHtml(d.machine_name)}</label>`).join('')}</fieldset>`
        : '<p class="rc-sub">No Atera devices under this client; enter a number instead.</p><input type="number" name="q" min="0" step="1" value="0" aria-label="How many">'}
      <button type="submit" class="btn btn-sm btn-primary">Save</button> <button type="button" class="btn btn-sm btn-ghost" data-rc-act="cancel">Cancel</button></form>`;
  }
  const kind = x.state === 'enter' ? 'in_use' : 'covered';
  const value = kind === 'in_use' ? (x.used ?? x.billed ?? 0) : x.used;
  return `<form class="rc-edit" data-rc-form="${kind}|${escapeHtml(x.product)}|${escapeHtml(c.name)}">
    <label>${kind === 'in_use' ? 'In use' : 'The fee covers'} <input type="number" name="q" min="0" step="1" value="${escapeHtml(value)}"></label>
    <button type="submit" class="btn btn-sm btn-primary">Save</button> <button type="button" class="btn btn-sm btn-ghost" data-rc-act="cancel">Cancel</button></form>`;
}

function detail(c) {
  const toRecord = c.rows.filter(x => x.state === 'record');
  const table = `<table class="rc-products"><thead><tr><th>Product</th><th>In use</th><th>Billed</th><th>Priced on</th><th>Costs</th><th>What it means</th><th>Do</th></tr></thead><tbody>
    ${c.rows.map(x => `<tr class="rc-${STATE[x.state][0]}">
      <td><span class="badge badge-${STATE[x.state][0]}">${escapeHtml(STATE[x.state][1])}</span> ${escapeHtml(productLabel(x.product))}</td>
      <td>${x.used == null ? '—' : escapeHtml(x.used)}</td>
      <td>${x.mode === 'flat' ? 'flat fee' : escapeHtml(x.billed)}</td>
      <td>${x.covered == null ? '—' : escapeHtml(x.covered)}</td>
      <td>$${escapeHtml(x.costUsd.toFixed(2))}</td>
      <td>${escapeHtml(x.text)}${x.gapGbp ? ` <strong>${escapeHtml(gbp(x.gapGbp))}/mo</strong>` : ''}</td>
      <td>${actionHtml(c, x)}</td></tr>`).join('')}</tbody></table>`;
  const record = toRecord.length > 1 ? `<button type="button" class="btn btn-sm" data-rc-baseline="${escapeHtml(c.name)}">Use today’s counts as what the fee covers (${toRecord.map(x => `${productLabel(x.product)} ${x.used}`).join(', ')})</button>` : '';
  const dead = c.dead.length ? `<div class="rc-dead"><strong>${c.dead.length} device${c.dead.length === 1 ? '' : 's'} in Webroot not seen for ${DEAD_DAYS}+ days</strong> (still a licence):
    ${c.dead.map(d => `${escapeHtml(d.host)} <small>last seen ${escapeHtml(d.lastSeen ? String(d.lastSeen).slice(0, 10) : 'never')}</small>`).join(', ')}.
    Deactivate in <a href="https://my.webrootanywhere.com/gsm.aspx#/sites" target="_blank" rel="noopener">Webroot › Sites › ${escapeHtml(c.webroot)}</a> (device › Agent Commands › Deactivate).</div>` : '';
  const money = `<p class="rc-sub">Atera lines on Xero: ${escapeHtml(gbp(c.monthly))} a month · costs ${escapeHtml(gbp(c.costGbp))} ($${escapeHtml(c.costUsd.toFixed(2))}) · ${c.margin == null ? '' : `margin ${escapeHtml(gbp(c.margin))}`}${c.belowCost ? ' — <strong class="rc-bad">below cost</strong>' : ''}.
    ${[c.webroot && `Webroot: ${c.webroot}`, c.acronis && `Acronis: ${c.acronis}`].filter(Boolean).map(escapeHtml).join(' · ')}</p>`;
  return `<div class="rc-detail">${money}${table}${record}${dead}<div class="rc-actions">${c.own ? '' : clientLink(c.name)}</div></div>`;
}

const inputFor = (client, product, kind) => (RC.raw?.inputs || []).find(i => i.client_name === client && i.product === product && i.kind === kind) || null;

async function saveInputs(rows) {
  if (RC.saving) return;
  RC.saving = true;
  try {
    const sb = await connectSupabase({ interactive: true });
    const by = myName();
    const saved = must(await sb.from('atera_reconcile_inputs').upsert(rows.map(r => ({ ...r, updated_by: by })), { onConflict: 'client_name,product,kind' }).select('*'));
    for (const s of saved) {
      const i = RC.raw.inputs.findIndex(x => x.client_name === s.client_name && x.product === s.product && x.kind === s.kind);
      if (i >= 0) RC.raw.inputs[i] = s; else RC.raw.inputs.push(s);
    }
    RC.editing = null;
    toast('Saved.', 'success');
  } catch (err) {
    toast(`Didn’t save: ${err.message || err}`, 'error', 9000);
  } finally {
    RC.saving = false;
    render();
  }
}

function onSubmit(e) {
  const f = e.target.closest('[data-rc-form]');
  if (!f) return;
  e.preventDefault();
  const [kind, ...rest] = f.dataset.rcForm.split('|');
  if (kind === 'wfh') {
    const client = rest.join('|');
    const ticked = [...f.querySelectorAll('input[name="d"]:checked')].map(i => i.value);
    const typed = f.querySelector('input[name="q"]');
    saveInputs([{ client_name: client, product: 'wfh', kind: 'in_use', quantity: typed ? Math.max(0, Number(typed.value) || 0) : ticked.length, devices: ticked }]);
    return;
  }
  const [product, ...name] = rest;
  const q = Math.max(0, Math.round(Number(f.querySelector('input[name="q"]').value) || 0));
  saveInputs([{ client_name: name.join('|'), product, kind, quantity: q }]);
}

function onClick(e) {
  if (e.target.closest('[data-open-client]') || e.target.closest('.rc-edit') && !e.target.closest('[data-rc-act]')) return;
  const o = e.target.closest('[data-rc-open]');
  if (o) { const k = o.dataset.rcOpen; RC.open.has(k) ? RC.open.delete(k) : RC.open.add(k); render(); return; }
  const f = e.target.closest('[data-rc-filter]');
  if (f) { RC.filter = f.dataset.rcFilter; render(); return; }
  const ed = e.target.closest('[data-rc-edit]');
  if (ed) { RC.editing = ed.dataset.rcEdit; render(); return; }
  const bl = e.target.closest('[data-rc-baseline]');
  if (bl) {
    const c = result().clients.find(x => x.name === bl.dataset.rcBaseline);
    if (c) saveInputs(c.rows.filter(x => x.state === 'record').map(x => ({ client_name: c.name, product: x.product, kind: 'covered', quantity: x.used, note: `Today’s counts, ${new Date().toLocaleDateString('en-GB')}` })));
    return;
  }
  const a = e.target.closest('[data-rc-act]')?.dataset.rcAct;
  if (a === 'cancel') { RC.editing = null; render(); }
  if (a === 'reload') load();
  if (a === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
}

async function syncNow() {
  const b = els('rcRefresh');
  b?.classList.add('spinning'); if (b) b.disabled = true;
  try {
    const sb = await connectSupabase({ interactive: true });
    const runs = await Promise.all(['webroot-sync', 'acronis-sync', 'xero-sync'].map(fn => sb.functions.invoke(fn, { body: {} }).then(({ data, error }) => ({ fn, ok: !error && data?.ok !== false, msg: error?.message || data?.error || '' }))));
    const bad = runs.filter(x => !x.ok);
    if (bad.length) toast(`Didn’t sync: ${bad.map(x => `${x.fn} (${x.msg})`).join(', ')}`, 'error', 9000);
    else toast('Synced from Webroot, Acronis and Xero.', 'success');
  } catch (err) {
    toast(`Didn’t sync: ${err.message || err}`, 'error', 9000);
  } finally {
    b?.classList.remove('spinning'); if (b) b.disabled = false;
    await load();
  }
}

export function init() {
  const s = els('section-reconcile');
  s?.addEventListener('click', onClick);
  s?.addEventListener('submit', onSubmit);
  els('rcRefresh')?.addEventListener('click', syncNow);
  load();
}
