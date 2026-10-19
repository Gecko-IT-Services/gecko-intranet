/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   NETWORK (client page tab)                                       ║
   ║                                                                   ║
   ║   The client's network, drawn from what Gecko HQ knows: sites by ║
   ║   internet address, servers and PCs, home and remote workers,     ║
   ║   cloud services. Lenses colour every machine by health, backup   ║
   ║   or antivirus; click one for its details and Help with this.     ║
   ║   Sites can be named; download as an image or print to PDF.       ║
   ║   Logic: core/network.js. Design: docs/superpowers/specs/         ║
   ║   2026-10-19-client-network-design.md                             ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { readAll } from '../core/rows.js';
import { sameAteraClient } from '../core/devices.js';
import { sameClient } from '../core/client.js';
import { upgrades } from '../core/upgrades.js';
import { coverage, coverageFor, machineKey } from '../core/coverage.js';
import { sites, drawing, lensOf, LENSES, EXPORT_CSS } from '../core/network.js';
import { openIncident } from './incident.js';

const NW = { client: '', data: null, error: null, lens: 'health', selected: '' };
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const same = (a, b) => sameAteraClient(a, b) || sameAteraClient(b, a) || sameClient(a, b);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const myName = () => (document.getElementById('userName')?.textContent || '').trim();
const CONNECTION = { ethernet: 'Ethernet', leased_line: 'Leased line', fttp: 'Full fibre (FTTP)', fttc: 'Fibre (FTTC)', sogea: 'SOGEA broadband' };
const VERDICT = { good: 'fine', warn: 'worth a look', bad: 'needs action', none: 'not covered' };

/** The tab's markup; the first call for a client starts loading and the tab redraws itself when done. */
export function html(clientName) {
  if (NW.client !== clientName) { Object.assign(NW, { client: clientName, data: null, error: null, selected: '' }); load(clientName); }
  return `<div id="nwMount">${body()}</div>`;
}

async function load(name) {
  try {
    const sb = await connectSupabase();
    const [agents, tenants, items, wsites, endpoints, names, dealer] = await Promise.all([
      sb.from('atera_agents').select('agent_id,customer_name,machine_name,device_type,os,os_version,online,last_seen,last_user,model,raw').then(must),
      sb.from('acronis_tenants').select('tenant_id,name,kind').then(must),
      readAll(() => sb.from('acronis_items').select('kind,tenant_id,raw').in('kind', ['resource_status', 'agent', 'usage']).order('kind').order('item_id')),
      sb.from('webroot_sites').select('site_id,name,raw').then(({ data, error }) => (error ? [] : data || [])),
      sb.from('webroot_endpoints').select('site_id,hostname,raw').then(({ data, error }) => (error ? [] : data || [])),
      // Before the sites table exists (this update), no names: the drawing still works.
      sb.from('client_sites').select('client_name,site_key,name').then(({ data, error }) => (error ? [] : data || [])),
      sb.from('voip_dealer_services').select('client_name,service,quantity').then(({ data, error }) => (error ? [] : data || []))
    ]);
    if (NW.client !== name) return;
    const mine = agents.filter(a => same(a.customer_name, name));
    const cov = coverageFor(coverage(tenants, items, agents, new Date()), name);
    const site = wsites.find(s => same(s.name, name) && s.raw?.Deactivated !== true);
    const av = new Set(endpoints.filter(e => site && e.site_id === site.site_id).flatMap(e => [String(e.hostname || '').toLowerCase(), machineKey(e.hostname)]));
    const up = upgrades(mine, today()).clients[0];
    const lines = dealer.filter(d => same(d.client_name, name));
    const conn = lines.map(d => CONNECTION[d.service]).find(Boolean) || '';
    const voice = lines.filter(d => /voxone|voip/.test(d.service)).reduce((t, d) => t + (Number(d.quantity) || 0), 0);
    const m = cov?.m365;
    const cloud = [
      m?.any ? `Microsoft 365 backup: ${m.seats} accounts${m.sites ? `, ${m.sites} SharePoint sites` : ''}${m.teams ? `, ${m.teams} Teams` : ''}` : '',
      site ? `Webroot antivirus: ${Number(site.raw?.TotalEndpoints) || av.size / 2} machines` : '',
      cov?.machines?.length ? `Acronis backups: ${cov.machines.filter(x => x.protected).length} machines` : '',
      voice ? `VoxOne phones: ${voice}` : ''
    ].filter(Boolean);
    NW.data = { agents: mine, names: Object.fromEntries(names.filter(n => same(n.client_name, name)).map(n => [n.site_key, n.name])), cloud, connection: conn,
      ctx: { findings: new Map((up?.devices || []).map(d => [d.name, d.findings])), backups: new Map((cov?.machines || []).map(x => [x.key, x])), av } };
  } catch (err) {
    if (NW.client === name) NW.error = err;
  }
  draw();
}

function draw() {
  const m = document.getElementById('nwMount');
  if (m) m.innerHTML = body();
}

const layout = () => sites(NW.data.agents, { names: NW.data.names, today: today() });
const svgNow = () => drawing({ client: NW.client, layout: layout(), lens: NW.lens, ctx: NW.data.ctx, cloud: NW.data.cloud, connection: NW.data.connection, selected: NW.selected });

function body() {
  if (NW.error) return `<div class="cl-error art art-offline"><strong>Could not draw the network for ${escapeHtml(NW.client)}.</strong>${escapeHtml(NW.error.message || NW.error)}</div>`;
  if (!NW.data) return '<p class="cl-empty art art-loading">Drawing the network…</p>';
  if (!NW.data.agents.length) return `<p class="cl-empty art art-empty">No machines in Atera for ${escapeHtml(NW.client)}, so there’s nothing to draw yet.</p>`;
  const l = layout();
  const bar = `<div class="nw-bar"><div class="nw-lenses" role="group" aria-label="Colour by">${LENSES.map(([k, label]) =>
      `<button type="button" class="btn btn-sm${NW.lens === k ? ' btn-primary' : ' btn-ghost'}" data-nw-lens="${k}" aria-pressed="${NW.lens === k}">${label}</button>`).join('')}</div>
    <div class="nw-out"><button type="button" class="btn btn-sm btn-ghost" data-nw-act="download">Download image</button>
      <button type="button" class="btn btn-sm btn-ghost" data-nw-act="print">Print or save as PDF</button></div></div>`;
  return `${bar}<div class="nw-canvas">${svgNow()}</div><div class="nw-side">${detail(l)}${namer(l)}</div>`;
}

/** The machine clicked: what Gecko HQ knows, and Help with this. */
function detail(l) {
  const all = [...l.sites.flatMap(s => s.machines.map(m => ({ ...m, site: s.name }))), ...l.remote.map(m => ({ ...m, site: 'Home and remote' }))];
  const m = all.find(x => x.name === NW.selected);
  if (!m) return '<section class="nw-card"><h3>Click a machine</h3><p class="nw-muted">to see who uses it, how it’s doing and what to do about it. Colour the drawing by health, backups or antivirus with the buttons above.</p></section>';
  const f = NW.data.ctx.findings.get(m.name) || [];
  const b = NW.data.ctx.backups.get(m.key);
  const row = (k, v) => (v ? `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>` : '');
  const states = Object.fromEntries(LENSES.map(([k, label]) => [label, VERDICT[lensOf(m, k, NW.data.ctx)]]));
  return `<section class="nw-card"><h3>${escapeHtml(m.name)}</h3><dl>
    ${row('Where', m.site)}${row('Used by', m.user)}${row('What', [m.server ? 'Server' : m.laptop ? 'Laptop' : m.mac ? 'Mac' : 'Desktop', m.model].filter(Boolean).join(', '))}
    ${row('Windows', m.os)}${row('Last seen', m.lastSeen ? new Date(m.lastSeen).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never')}
    ${row('Network', [m.lan, m.publicIp].filter(Boolean).join(' · '))}
    ${row('Backup', b ? (b.protected ? `${b.stale ? 'late' : 'backed up'}${b.lastSuccess ? `, last good ${String(b.lastSuccess).slice(0, 10)}` : ''}` : 'no plan') : 'not in Acronis')}
    ${Object.entries(states).map(([k, v]) => row(k, v)).join('')}
    ${f.map(x => row(x.what, `${x.text}. ${x.fix}`)).join('')}</dl>
    <div class="nw-acts"><button type="button" class="btn btn-sm btn-primary" data-nw-act="help">Help with this</button>
      ${m.url ? `<a class="btn btn-sm btn-ghost" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">Open in Atera</a>` : ''}</div></section>`;
}

/** Name the sites Gecko HQ found (kept in client_sites against the internet address). */
function namer(l) {
  if (!l.sites.length) return '';
  return `<section class="nw-card"><h3>Sites</h3><p class="nw-muted">Found from the internet address the machines share. Give each a name once; it stays.</p>
    ${l.sites.map(s => `<form class="nw-name-row" data-nw-site="${escapeHtml(s.key)}"><label><span>${escapeHtml(s.publicIp)}${s.lan ? ` · ${escapeHtml(s.lan)}` : ''} · ${s.machines.length} machines</span>
      <input name="name" value="${escapeHtml(s.named ? s.name : '')}" placeholder="${escapeHtml(s.name)}" maxlength="60"></label><button class="btn btn-sm" type="submit">Save</button></form>`).join('')}</section>`;
}

async function saveName(key, name) {
  const v = name.trim();
  try {
    const sb = await connectSupabase({ interactive: true });
    if (v) must(await sb.from('client_sites').upsert({ client_name: NW.client, site_key: key, name: v, updated_by: myName() }, { onConflict: 'client_name,site_key' }).select('site_key'));
    else must(await sb.from('client_sites').delete().eq('client_name', NW.client).eq('site_key', key).select('site_key'));
    if (v) NW.data.names[key] = v; else delete NW.data.names[key];
    toast(v ? `Saved: ${v}.` : 'Name cleared.', 'success');
    draw();
  } catch (err) {
    toast(/client_sites/.test(err.message || '') ? 'Couldn’t save the name yet: the database update for it hasn’t arrived (it comes with this change).' : `Couldn’t save the name: ${err.message || err}`, 'error', 9000);
  }
}

/** The drawing on its own, light like a Visio page, with its title. */
function standalone() {
  const svg = svgNow().replace(/^<svg([^>]*)>/, `<svg$1><style>${EXPORT_CSS}</style>`).replace(' width="100%"', ' width="960"');
  return svg;
}
function download() {
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${standalone()}`], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${NW.client} network ${today()}.svg`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function print() {
  const w = window.open('', '_blank');
  if (!w) { toast('The browser blocked the new window: allow pop-ups for Gecko HQ, then try again.', 'error', 8000); return; }
  w.document.write(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml(NW.client)}: network</title><style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #1f2933; } h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 16px; color: #5f6b76; font-size: 12px; }
    svg { width: 100%; height: auto; } @page { size: A4 landscape; margin: 12mm; }</style></head><body>
    <h1>${escapeHtml(NW.client)}: network</h1><p>Drawn by Gecko IT Services from monitoring data, ${escapeHtml(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}.</p>${standalone()}</body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
}

/** Clicks and forms inside the tab (the client page draws it; these listeners are added once). */
export function wire(root) {
  root.addEventListener('click', e => {
    if (!e.target.closest?.('#nwMount')) return;
    const lens = e.target.closest('[data-nw-lens]');
    if (lens) { NW.lens = lens.dataset.nwLens; draw(); return; }
    const m = e.target.closest('[data-nw-m]');
    if (m) { NW.selected = NW.selected === m.dataset.nwM ? '' : m.dataset.nwM; draw(); return; }
    const a = e.target.closest('[data-nw-act]')?.dataset.nwAct;
    if (a === 'download') download();
    if (a === 'print') print();
    if (a === 'help') {
      const f = NW.data.ctx.findings.get(NW.selected) || [];
      openIncident({ client: NW.client, device: NW.selected, problem: f[0] ? `${f[0].text}` : 'A question about this machine, asked from the network drawing',
        details: { findings: f.map(x => `${x.text}: ${x.fix}`), backup: NW.data.ctx.backups.get(machineKey(NW.selected)) || 'not in Acronis' } });
    }
  });
  root.addEventListener('keydown', e => {
    const m = e.target.closest?.('#nwMount [data-nw-m]');
    if (m && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); NW.selected = m.dataset.nwM; draw(); }
  });
  root.addEventListener('submit', e => {
    const f = e.target.closest?.('#nwMount [data-nw-site]');
    if (!f) return;
    e.preventDefault();
    saveName(f.dataset.nwSite, f.elements.name.value);
  });
}
