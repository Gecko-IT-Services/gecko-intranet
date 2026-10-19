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
import { readAll } from '../core/rows.js';
import { reconcileAll, productLabel, DEAD_DAYS, PRICE_USD, vendorMargins } from '../core/reconcile.js';
import { vendorMarks } from '../core/vendors.js';
import { sameAteraClient } from '../core/devices.js';
import { sameClient } from '../core/client.js';

const RC = { raw: null, error: null, open: new Set(), who: new Set(), filter: 'attention', saving: false, editing: null };
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
    const [repeating, webrootSites, webrootEndpoints, acronisTenants, acronisUsage, inputs, agents, bills, wst, ast, usageAll, seats] = await Promise.all([
      sb.from('xero_repeating_invoices').select('repeating_invoice_id,contact_name,status,unit,period,next_date,line_items').then(must),
      sb.from('webroot_sites').select('site_id,name,raw').then(must),
      sb.from('webroot_endpoints').select('site_id,hostname,raw').then(must),
      sb.from('acronis_tenants').select('tenant_id,name,kind').then(must),
      Promise.all([
        readAll(() => sb.from('acronis_items').select('tenant_id,kind,raw').eq('kind', 'usage').like('raw->>name', 'pw_base_%').order('item_id')),
        readAll(() => sb.from('acronis_items').select('tenant_id,kind,raw').eq('kind', 'm365_user').order('item_id'))]).then(([u, m]) => u.concat(m)),
      sb.from('atera_reconcile_inputs').select('*').then(must),
      sb.from('atera_agents').select('customer_name,machine_name,device_type,online').then(must),
      sb.from('atera_bills').select('usd,gbp,charged_on').not('gbp', 'is', null).order('charged_on', { ascending: false }).limit(1).then(must),
      sb.from('webroot_status').select('*').eq('id', 1).maybeSingle().then(must),
      sb.from('acronis_status').select('*').eq('id', 1).maybeSingle().then(must),
      sb.from('atera_usage').select('month,product,usd').then(must),
      sb.from('atera_bills').select('usd,month,charged_on').eq('kind', 'seats').order('charged_on', { ascending: false }).limit(1).then(must)
    ]);
    const lastMonth = usageAll.reduce((m, u) => (u.month > m ? u.month : m), '');
    const rate = bills[0] && Number(bills[0].usd) ? Number(bills[0].gbp) / Number(bills[0].usd) : null;
    RC.raw = { repeating, webrootSites, webrootEndpoints, acronisTenants, acronisUsage, inputs, agents, rate, webrootStatus: wst, acronisStatus: ast,
      usage: usageAll.filter(u => u.month === lastMonth), usageMonth: lastMonth, seatsUsd: seats[0] ? Number(seats[0].usd) : 0 };
  } catch (err) {
    RC.error = err;
  }
  render();
}

const result = () => reconcileAll({ ...RC.raw, now: new Date() });
const monthName = m => (m ? new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '');

function render() {
  const mount = els('rcWrap');
  if (!mount) return;
  const sync = els('rcLastSync');
  if (sync) sync.textContent = RC.raw?.webrootStatus?.last_sync_at ? `Synced ${when(RC.raw.webrootStatus.last_sync_at)}` : '';
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
  const fixes = fixList(r);
  const setup = r.clients.filter(c => !c.own && c.rows.some(x => x.state === 'record' || x.state === 'enter'));
  const figures = `<div class="kpi-panel rc-kpis">
    <div class="kpi"><span class="kpi-label">To bill</span><span class="kpi-value${t.leakGbp ? ' rc-bad' : ''}">${escapeHtml(gbp(t.leakGbp))}</span><span class="kpi-sub">a month · in use, not invoiced</span></div>
    <div class="kpi"><span class="kpi-label">Over-billed</span><span class="kpi-value${t.overGbp ? ' rc-warn' : ''}">${escapeHtml(gbp(t.overGbp))}</span><span class="kpi-sub">a month · invoiced, not in use</span></div>
    <div class="kpi"><span class="kpi-label">Dead devices</span><span class="kpi-value${t.deadDevices ? ' rc-warn' : ''}">${t.deadDevices}</span><span class="kpi-sub">licensed in Webroot, gone ${DEAD_DAYS}+ days</span></div>
    <div class="kpi"><span class="kpi-label">Set up once</span><span class="kpi-value">${setup.length}</span><span class="kpi-sub">client${setup.length === 1 ? '' : 's'} with fees or counts to record</span></div>
  </div>`;
  mount.innerHTML = `<div class="app-pane rc-pane">${statusLine}${figures}
    ${block('Margin by supplier', `What clients pay for each part against what Atera charged you${RC.raw.usageMonth ? ` (${monthName(RC.raw.usageMonth)} invoice)` : ''}. Flat fees are shared across what they cover by what each part costs you.`, marginTable(r))}
    ${block('Fix these', fixes.length ? `${fixes.length} to do · biggest first` : '', fixes.length
      ? `<ul class="rc-fixes">${fixes.map(fixHtml).join('')}</ul>`
      : '<p class="rc-none">Nothing to fix: every invoice matches what’s in use.</p>')}
    ${setup.length ? block('Set up once', 'Flat fees don’t say how many devices they cover. Record today’s counts once; after that only growth is flagged.',
      `<ul class="rc-setup">${setup.map(setupHtml).join('')}</ul>`) : ''}
    ${block('All clients', 'What each client pays for Atera services against what it costs you. Open one for the detail.', clientsTable(r))}
    <p class="rc-foot">In use: Webroot and Acronis (live, synced 4 times a day), Keeper and Work from Home as entered here. Billed: Xero repeating invoices (hourly).
    Costs at Atera’s prices${RC.raw.rate ? `, £ at ${RC.raw.rate.toFixed(4)} per $` : ''}. Gecko HQ never changes an invoice or a device: each button opens the place to do it.</p></div>`;
  syncTableLabels(mount);
}

function marginTable(r) {
  if (!RC.raw.rate) return '<p class="rc-none">No £ rate yet: the margin needs an Atera receipt with the £ paid.</p>';
  const m = vendorMargins(r, RC.raw.usage, RC.raw.seatsUsd, RC.raw.rate);
  const pctCls = p => (p == null ? '' : p < 0 ? ' rc-bad' : p < 40 ? ' rc-warn' : ' rc-good');
  const MARK = { acronis: 'Acronis', webroot: 'Webroot', keeper: 'Keeper', atera_wfh: '', atera_seats: '' };
  const row = (x, total = false) => `<tr class="${total ? 'rc-total' : ''}">
      <td>${total ? '' : vendorMarks(MARK[x.key] || '')}<strong>${escapeHtml(x.label)}</strong>${x.what ? `<small>${escapeHtml(x.what)}</small>` : ''}</td>
      <td>${escapeHtml(gbp(x.incomeGbp))}</td>
      <td>${escapeHtml(gbp(x.costGbp))}${x.unassignedGbp ? `<small>${escapeHtml(gbp(x.unassignedGbp))} not tied to a client</small>` : ''}</td>
      <td class="${x.marginGbp < 0 ? 'rc-bad' : ''}">${escapeHtml(gbp(x.marginGbp))}</td>
      <td><span class="rc-pct${pctCls(x.pct)}">${x.pct == null ? '—' : `${escapeHtml(x.pct)}%`}</span>${x.pct != null ? `<span class="rc-bar"><i style="width:${Math.max(0, Math.min(100, x.pct))}%"></i></span>` : ''}</td>
    </tr>`;
  return `<table class="rc-margins"><thead><tr><th>Supplier</th><th>Clients pay</th><th>Atera charges</th><th>Margin</th><th>Margin %</th></tr></thead>
    <tbody>${m.rows.map(x => row(x)).join('')}${row(m.total, true)}</tbody></table>`;
}

const block = (title, sub, body) => `<section class="rc-block"><header><h2>${escapeHtml(title)}</h2>${sub ? `<p>${escapeHtml(sub)}</p>` : ''}</header>${body}</section>`;
const PRODUCT_MARK = { av: 'Webroot antivirus', dns: 'DNS protection', backup: 'Acronis backup', m365: 'Acronis Microsoft 365', wfh: '', keeper: 'Keeper' };
const product = p => `<span class="rc-product">${vendorMarks(PRODUCT_MARK[p] || '')}${escapeHtml(productLabel(p))}</span>`;
const n = v => (v == null ? '—' : escapeHtml(v));

/** Money problems across all clients, one line each: red first, then by £ a month. */
function fixList(r) {
  const out = [];
  for (const c of r.clients) {
    if (c.own) continue;
    for (const x of c.rows) if (['leak', 'unbilled', 'over', 'check', 'grown'].includes(x.state)) out.push({ c, x, gbp: x.gapGbp || 0, red: x.state === 'leak' || x.state === 'unbilled' });
    if (c.dead.length) out.push({ c, dead: c.dead, gbp: null, red: false });
    if (c.belowCost) out.push({ c, below: true, gbp: -c.margin, red: true });
  }
  return out.sort((a, b) => Number(b.red) - Number(a.red) || (b.gbp || 0) - (a.gbp || 0) || a.c.name.localeCompare(b.c.name));
}

function fixHtml(f) {
  const { c, x } = f;
  if (f.dead) {
    return `<li class="rc-fix"><span class="badge badge-amber">Dead devices</span>
      <div class="rc-fix-what"><strong>${escapeHtml(c.name)}</strong>${product('av')}</div>
      <div class="rc-fix-fact rc-dead-list">${f.dead.map(d => `<span>${escapeHtml(d.host)} <small>last seen ${escapeHtml(d.lastSeen ? new Date(d.lastSeen).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never')}</small></span>`).join('')}</div>
      <div class="rc-fix-money">$${(f.dead.length * PRICE_USD.av).toFixed(2)}<small>/mo</small></div>
      <div class="rc-fix-do"><a class="btn btn-sm" href="https://my.webrootanywhere.com/gsm.aspx#/sites" target="_blank" rel="noopener">Deactivate in Webroot</a></div></li>`;
  }
  if (f.below) {
    return `<li class="rc-fix"><span class="badge badge-red">Below cost</span>
      <div class="rc-fix-what"><strong>${escapeHtml(c.name)}</strong><span class="rc-product">All Atera services</span></div>
      <div class="rc-fix-fact">Billed ${escapeHtml(gbp(c.monthly))}, costs ${escapeHtml(gbp(c.costGbp))}</div>
      <div class="rc-fix-money rc-bad">${escapeHtml(gbp(c.margin))}<small>/mo</small></div><div class="rc-fix-do"></div></li>`;
  }
  const fact = x.mode === 'flat' ? `${n(x.used)} in use · ${x.covered == null ? 'flat fee' : `fee priced on ${n(x.covered)}`}` : `${n(x.used)} in use · ${n(x.billed)} billed`;
  return `<li class="rc-fix"><span class="badge badge-${STATE[x.state][0]}">${escapeHtml(STATE[x.state][1])}</span>
    <div class="rc-fix-what"><strong>${escapeHtml(c.name)}</strong>${product(x.product)}</div>
    <div class="rc-fix-fact">${fact}<small>${escapeHtml(x.text)}</small>${whoButton(c, x)}</div>
    <div class="rc-fix-money${f.red ? ' rc-bad' : ''}">${x.gapGbp ? `${escapeHtml(gbp(x.gapGbp))}<small>/mo</small>` : '—'}</div>
    <div class="rc-fix-do">${actionHtml(x)}</div>${whoList(c, x)}</li>`;
}

const TAG = { dead: ['amber', 'Not seen 30+ days'], shared: ['blue', 'Shared / role mailbox'], admin: ['purple', 'Admin login'],
  not_ms: ['amber', 'No Microsoft licence'], leaver: ['blue', 'Leaver'] };

function whoButton(c, x) {
  if (!x.who) return '';
  const key = `${c.name}|${x.product}`, open = RC.who.has(key);
  return `<button type="button" class="rc-who-btn" data-rc-who="${escapeHtml(key)}" aria-expanded="${open}">${open ? 'Hide' : 'Who'} (${x.who.counted.length})</button>`;
}

/** The people or devices behind a count; the special accounts tagged so the odd ones out stand out. */
function whoList(c, x) {
  if (!x.who || !RC.who.has(`${c.name}|${x.product}`)) return '';
  const item = i => `<li><strong>${escapeHtml(i.name)}</strong>${i.detail ? `<small>${escapeHtml(i.detail)}</small>` : ''}${i.tags.filter(t => TAG[t]).map(t => `<span class="badge badge-${TAG[t][0]}">${escapeHtml(TAG[t][1])}</span>`).join('')}</li>`;
  const odd = x.who.counted.filter(i => i.tags.some(t => t !== 'leaver')).length;
  const what = x.product === 'm365' ? 'Acronis charges a seat for' : x.product === 'wfh' ? 'Ticked as having Work from Home' : 'In use in Webroot';
  return `<div class="rc-who">
    <p>${escapeHtml(what)}: ${x.who.counted.length}${odd ? ` · <strong>${odd} not a regular person or device</strong>` : ''}${x.mode === 'per' && x.billed ? ` · Xero bills ${escapeHtml(x.billed)} (the invoice doesn’t say who)` : ''}</p>
    <ul>${x.who.counted.map(item).join('')}</ul>
    ${x.who.notCounted.length ? `<p class="rc-who-not">Not charged: ${x.who.notCounted.map(i => escapeHtml(i.name)).join(', ')}</p>` : ''}
  </div>`;
}

function actionHtml(x) {
  const a = x.action;
  if (!a) return '';
  if (a.kind === 'repeating' && a.to != null) return `<a class="btn btn-sm btn-primary" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Change ${escapeHtml(a.from)} → ${escapeHtml(a.to)} in Xero</a>`;
  if (a.kind === 'repeating') return `<a class="btn btn-sm" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Review in Xero</a>`;
  if (a.kind === 'add_line') return `<a class="btn btn-sm btn-primary" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Add ${escapeHtml(a.to)} to invoice in Xero</a>`;
  return '';
}

/** One line per client with something to record: today's counts as chips, one button to keep them, Edit to change them. */
function setupHtml(c) {
  const rec = c.rows.filter(x => x.state === 'record');
  const enter = c.rows.filter(x => x.state === 'enter');
  const editing = RC.editing === c.name;
  const fee = rec.length ? Math.max(...rec.map(x => x.fee || 0)) : 0;
  const chips = rec.map(x => `<span class="rc-chip">${vendorMarks(PRODUCT_MARK[x.product] || '')}${escapeHtml(productLabel(x.product))} <strong>${n(x.used)}</strong></span>`).join('');
  const asks = enter.map(x => `<button type="button" class="btn btn-sm" data-rc-edit="${escapeHtml(c.name)}|${x.product}">${x.product === 'wfh' ? 'Pick Work from Home devices' : 'Enter Keeper users'}</button>`).join('');
  const editor = typeof RC.editing === 'string' && RC.editing.startsWith(c.name + '|') ? enterForm(c, RC.editing.split('|').pop()) : '';
  return `<li class="rc-set">
    <div class="rc-set-who"><strong>${escapeHtml(c.name)}</strong>${fee ? `<small>flat fee ${escapeHtml(gbp(fee))}/mo</small>` : ''}</div>
    <div class="rc-set-chips">${rec.length ? (editing ? coverForm(c, rec) : chips) : ''}</div>
    <div class="rc-set-do">${rec.length && !editing ? `<button type="button" class="btn btn-sm btn-primary" data-rc-baseline="${escapeHtml(c.name)}">Use these counts</button>
      <button type="button" class="btn btn-sm btn-ghost" data-rc-edit="${escapeHtml(c.name)}">Edit</button>` : ''}${asks}</div>
    ${editor}</li>`;
}

function coverForm(c, rec) {
  return `<form class="rc-edit" data-rc-form="covered|${escapeHtml(c.name)}">
    ${rec.map(x => `<label>${escapeHtml(productLabel(x.product))} <input type="number" name="${x.product}" min="0" step="1" value="${n(x.used)}"></label>`).join('')}
    <button type="submit" class="btn btn-sm btn-primary">Save</button><button type="button" class="btn btn-sm btn-ghost" data-rc-act="cancel">Cancel</button></form>`;
}

function enterForm(c, p) {
  if (p === 'wfh') {
    const devices = RC.raw.agents.filter(a => sameAteraClient(a.customer_name, c.name) || sameClient(a.customer_name, c.name))
      .sort((a, b) => String(a.machine_name).localeCompare(String(b.machine_name)));
    const ticked = new Set(inputFor(c.name, 'wfh', 'in_use')?.devices || []);
    return `<form class="rc-edit rc-edit-wide" data-rc-form="wfh|${escapeHtml(c.name)}">
      ${devices.length ? `<fieldset><legend>Which of ${escapeHtml(c.name)}’s devices have Work from Home?</legend>${devices.map(d => `<label><input type="checkbox" name="d" value="${escapeHtml(d.machine_name)}"${ticked.has(d.machine_name) ? ' checked' : ''}> ${escapeHtml(d.machine_name)}</label>`).join('')}</fieldset>`
        : '<label>How many devices have Work from Home? <input type="number" name="q" min="0" step="1" value="0"></label>'}
      <div><button type="submit" class="btn btn-sm btn-primary">Save</button><button type="button" class="btn btn-sm btn-ghost" data-rc-act="cancel">Cancel</button></div></form>`;
  }
  return `<form class="rc-edit rc-edit-wide" data-rc-form="in_use|${escapeHtml(p)}|${escapeHtml(c.name)}">
    <label>${escapeHtml(productLabel(p))} users in use <input type="number" name="q" min="0" step="1" value="0"></label>
    <button type="submit" class="btn btn-sm btn-primary">Save</button><button type="button" class="btn btn-sm btn-ghost" data-rc-act="cancel">Cancel</button></form>`;
}

function clientsTable(r) {
  const status = c => {
    const fix = c.rows.filter(x => ['leak', 'unbilled', 'over', 'check', 'grown'].includes(x.state)).length + (c.dead.length ? 1 : 0) + (c.belowCost ? 1 : 0);
    const setup = c.rows.some(x => x.state === 'record' || x.state === 'enter');
    return c.own ? '<span class="badge badge-blue">Gecko’s own</span>'
      : fix ? `<span class="badge badge-${c.rows.some(x => x.state === 'leak' || x.state === 'unbilled') || c.belowCost ? 'red' : 'amber'}">${fix} to fix</span>`
      : setup ? '<span class="badge badge-blue">Set up</span>' : '<span class="badge badge-green">OK</span>';
  };
  return `<ul class="rc-clients">${r.clients.map(c => {
    const open = RC.open.has(c.name);
    return `<li class="${open ? 'open' : ''}"><button type="button" class="rc-crow" data-rc-open="${escapeHtml(c.name)}" aria-expanded="${open}">
      <span class="rc-cname">${escapeHtml(c.name)}</span>${status(c)}
      <span class="rc-num"><small>Billed</small>${escapeHtml(gbp(c.monthly))}</span>
      <span class="rc-num"><small>Costs</small>${escapeHtml(gbp(c.costGbp))}</span>
      <span class="rc-num${c.margin != null && c.margin < 0 ? ' rc-bad' : ''}"><small>Margin</small>${escapeHtml(gbp(c.margin))}</span>
    </button>${open ? detail(c) : ''}</li>`;
  }).join('')}</ul>`;
}

function detail(c) {
  const rows = c.rows.map(x => `<tr>
      <td>${product(x.product)}${whoButton(c, x)}</td>
      <td>${n(x.used)}</td>
      <td>${x.mode === 'flat' ? `flat fee${x.covered != null ? ` · priced on ${n(x.covered)}` : ''}` : n(x.billed)}</td>
      <td><span class="badge badge-${STATE[x.state][0]}">${escapeHtml(STATE[x.state][1])}</span> ${escapeHtml(x.text)}</td>
    </tr>${RC.who.has(`${c.name}|${x.product}`) ? `<tr class="rc-who-row"><td colspan="4">${whoList(c, x)}</td></tr>` : ''}`).join('');
  return `<div class="rc-detail">
    <table class="rc-products"><thead><tr><th>Product</th><th>In use</th><th>Billed</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="rc-sub">${[c.webroot && `Webroot site: ${c.webroot}`, c.acronis && `Acronis: ${c.acronis}`, `costs $${c.costUsd.toFixed(2)} a month`].filter(Boolean).map(escapeHtml).join(' · ')}
    ${c.own ? '' : ` · ${clientLink(c.name)}`}</p></div>`;
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
  if (kind === 'covered') {
    const client = rest.join('|');
    saveInputs([...f.querySelectorAll('input[type="number"]')].map(i => ({ client_name: client, product: i.name, kind: 'covered', quantity: Math.max(0, Math.round(Number(i.value) || 0)) })));
    return;
  }
  if (kind === 'wfh') {
    const client = rest.join('|');
    const ticked = [...f.querySelectorAll('input[name="d"]:checked')].map(i => i.value);
    const typed = f.querySelector('input[name="q"]');
    saveInputs([{ client_name: client, product: 'wfh', kind: 'in_use', quantity: typed ? Math.max(0, Number(typed.value) || 0) : ticked.length, devices: ticked }]);
    return;
  }
  const [prod, ...name] = rest;
  const q = Math.max(0, Math.round(Number(f.querySelector('input[name="q"]').value) || 0));
  saveInputs([{ client_name: name.join('|'), product: prod, kind, quantity: q }]);
}

function onClick(e) {
  if (e.target.closest('[data-open-client]') || e.target.closest('.rc-edit') && !e.target.closest('[data-rc-act]')) return;
  const o = e.target.closest('[data-rc-open]');
  if (o) { const k = o.dataset.rcOpen; RC.open.has(k) ? RC.open.delete(k) : RC.open.add(k); render(); return; }
  const f = e.target.closest('[data-rc-filter]');
  if (f) { RC.filter = f.dataset.rcFilter; render(); return; }
  const wb = e.target.closest('[data-rc-who]');
  if (wb) { const k = wb.dataset.rcWho; RC.who.has(k) ? RC.who.delete(k) : RC.who.add(k); render(); return; }
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
