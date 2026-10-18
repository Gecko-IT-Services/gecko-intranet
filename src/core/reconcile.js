/* Atera reconcile: pure logic (no window). Tested in tests/reconcile.mjs.
   Design: docs/superpowers/specs/2026-10-18-atera-reconcile-design.md

   Per client and product: what the client uses (Webroot, Acronis live; Keeper and Work from Home typed), what it costs Gecko
   at Atera's prices, and what Xero bills (repeating invoices). Per-device lines are checked by count; a flat line is checked
   against what it was priced on (typed once, kind 'covered'). Every gap carries the action that closes it. */

import { sameClient } from './client.js';
import { sameAteraClient, isInternal } from './devices.js';
import { xeroRepeatingUrl } from './atera-costs.js';

/** Atera's prices to Gecko, USD a month (AppCenter, Oct 2026). */
export const PRICE_USD = { av: 1.20, dns: 1.20, workstation: 3.90, vm: 8.62, server: 24.50, m365: 2.60, gb: 0.04, wfh: 5.00, keeper: 2.62 };
export const PRODUCTS = [
  ['av', 'Antivirus'], ['dns', 'DNS protection'], ['backup', 'Backup (machines)'], ['m365', 'Microsoft 365 backup'],
  ['wfh', 'Work from home'], ['keeper', 'Passwords (Keeper)']
];
export const productLabel = p => (PRODUCTS.find(x => x[0] === p) || [p, p])[1];
/** A Webroot device not seen for this long is still a licence: remove it in Webroot. */
export const DEAD_DAYS = 30;

const lc = s => String(s || '').toLowerCase();
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const same = (vendorName, xeroName) => sameAteraClient(vendorName, xeroName) || sameClient(vendorName, xeroName);

const NOT_ATERA = /hosting|wordpress|website|domain|\bseo\b/;
const BUNDLE = /cloud management|remote it support|remote management|monthly maintenance/;   // Philip's pricing workbook, May 2026

/** The products a repeating-invoice line sells; [] when it isn't an Atera product. */
export function lineProducts(line) {
  const t = lc(line.description) || lc(line.item_code);
  if (NOT_ATERA.test(t)) return [];
  const out = new Set();
  if (/internet security|opentext|webroot|antivirus|pc security|endpoint/.test(t)) out.add('av');
  if (/\bdns\b/.test(t)) out.add('dns');
  // "Acronis/M365 - Cloud Backup", "Cloud Backup - Office365 & Sharepoint": Microsoft 365 only. Any other backup line
  // ("Cloud Backup", "Internet Security & Backup & …") is taken to cover the client's machines and their Microsoft 365 both.
  if (/backup|acronis/.test(t)) {
    out.add('m365');
    if (!/m365|365|sharepoint|office/.test(t)) out.add('backup');
  }
  if (/work from home|\bwfh\b/.test(t)) out.add('wfh');
  if (/keeper|password/.test(t)) out.add('keeper');
  // A management bundle covers antivirus and backup too (Regal, WCF) — unless its antivirus is Microsoft Defender (Technix).
  if (BUNDLE.test(t)) { if (!/defender/.test(t)) out.add('av'); out.add('backup'); out.add('m365'); }
  if (/defender/.test(t)) out.delete('av');
  if (!out.size && /^atera/.test(lc(line.item_code))) out.add('av');   // an "Atera - …" item with no product named
  return [...out];
}

/**
 * Repeating-invoice lines → per client: monthly £, and per product the per-device count billed, the unit price, and the flat
 * lines that cover it. A line is per-device when it sells one product and is a count (qty > 1, or one at ≤ £12);
 * yearly templates (period ≥ 11) bill 12 × the monthly price, so their count is quantity ÷ 12.
 */
export function billing(repeating) {
  const out = new Map();
  for (const t of repeating || []) {
    if (String(t.status || '').toUpperCase() !== 'AUTHORISED') continue;
    const months = Number(t.period) >= 11 ? Number(t.period) : 1;
    for (const l of t.line_items || []) {
      const products = lineProducts(l);
      if (!products.length) continue;
      const qty = Number(l.quantity) || 0, unit = Number(l.unit_amount) || 0;
      const amount = l.line_amount != null ? Number(l.line_amount) : qty * unit;
      const c = out.get(t.contact_name) || { name: t.contact_name, monthly: 0, products: {}, templates: [] };
      c.monthly = r2(c.monthly + amount / months);
      if (!c.templates.some(x => x.id === t.repeating_invoice_id)) c.templates.push({ id: t.repeating_invoice_id, unit: t.unit, period: t.period, next: t.next_date });
      const perDevice = products.length === 1 && (qty > 1 || unit <= 12 || products[0] === 'wfh');
      for (const p of products) {
        const e = c.products[p] || (c.products[p] = { count: 0, unit: null, flat: [], lines: [] });
        const ref = { description: l.description, item_code: l.item_code, quantity: qty, unit, amount: r2(amount / months), template: t.repeating_invoice_id, next: t.next_date };
        if (perDevice) {
          e.count += months > 1 && qty % months === 0 ? qty / months : qty;
          e.unit = months > 1 ? r2(unit) : unit;
          e.lines.push(ref);
        } else {
          e.flat.push(ref);
        }
      }
      out.set(t.contact_name, c);
    }
  }
  return out;
}

/** Webroot per site: active devices, DNS devices, and devices still active but not seen for DEAD_DAYS. */
export function webrootUse(sites, endpoints, now) {
  const at = new Date(now).getTime();
  return (sites || []).filter(s => s.raw?.Deactivated !== true && s.raw?.Deactivated !== 'true').map(s => {
    const eps = (endpoints || []).filter(e => e.site_id === s.site_id && e.raw?.Deactivated !== true && e.raw?.Deactivated !== 'true');
    const dead = eps.filter(e => { const t = new Date(e.raw?.LastSeen || 0).getTime(); return !t || at - t > DEAD_DAYS * 86400000; })
      .map(e => ({ host: e.hostname || e.raw?.HostName || '—', lastSeen: e.raw?.LastSeen || null }));
    return {
      name: s.name, siteId: s.site_id,
      av: Number(s.raw?.TotalEndpoints ?? eps.length) || 0,
      dns: eps.filter(e => /dns/i.test(JSON.stringify(e.raw?.ActiveModules || ''))).length,
      dead
    };
  });
}

/** Acronis per customer (usage rows' raw): workstations, VMs, servers, M365 seats, storage GB (decimal, as Atera bills). */
export function acronisUse(tenants, usage) {
  const v = (rows, name) => rows.filter(u => u.raw?.name === name).reduce((t, u) => t + (Number(u.raw?.value) || 0), 0);
  return (tenants || []).filter(t => t.kind === 'customer').map(t => {
    const rows = (usage || []).filter(u => u.tenant_id === t.tenant_id);
    return {
      name: t.name, workstations: v(rows, 'pw_base_workstations'), vms: v(rows, 'pw_base_vms'), servers: v(rows, 'pw_base_servers'),
      m365: v(rows, 'pw_base_m365_seats'), gb: Math.round(v(rows, 'pw_base_storage') / 1e9)
    };
  });
}

/**
 * The reconcile. inputs: atera_reconcile_inputs rows; rate: GBP per USD (null → costs shown in $ only).
 * → { clients: [{ name, monthly, costUsd, costGbp, margin, rows, dead, webroot, acronis, own }], totals }
 * A row: { product, used, billed, covered, mode, state, gapUnits, gapGbp, costUsd, text, action }
 *   state: leak | over | unbilled | grown | record | enter | check | ok
 *   action: { kind: 'repeating' | 'add_line' | 'record' | 'enter', url?, from?, to?, line? }
 */
export function reconcileAll({ repeating, webrootSites, webrootEndpoints, acronisTenants, acronisUsage, inputs, rate = null, now = new Date() }) {
  const bills = billing(repeating);
  const web = webrootUse(webrootSites, webrootEndpoints, now);
  const acr = acronisUse(acronisTenants, acronisUsage);
  const names = new Map();                        // display name (Xero's when billed) → { web, acr, bill }
  const keyFor = vendorName => [...bills.keys()].find(x => same(vendorName, x)) || [...names.keys()].find(x => same(vendorName, x)) || vendorName;
  for (const [n, b] of bills) names.set(n, { bill: b });
  for (const w of web) { const k = keyFor(w.name); names.set(k, { ...(names.get(k) || {}), web: w }); }
  for (const a of acr) { const k = keyFor(a.name); names.set(k, { ...(names.get(k) || {}), acr: a }); }
  for (const i of inputs || []) { const k = keyFor(i.client_name); if (!names.has(k)) names.set(k, {}); }

  const clients = [...names.entries()].map(([name, src]) => {
    const own = isInternal(name);
    const mine = (inputs || []).filter(i => same(i.client_name, name) || i.client_name === name);
    const input = (p, kind) => mine.find(i => i.product === p && i.kind === kind) || null;
    const w = src.web, a = src.acr, b = src.bill;
    const keeperIn = input('keeper', 'in_use'), wfhIn = input('wfh', 'in_use');
    const used = {
      av: w ? w.av : 0, dns: w ? w.dns : 0,
      backup: a ? a.workstations + a.vms + a.servers : 0, m365: a ? a.m365 : 0,
      wfh: wfhIn ? Number(wfhIn.quantity) : null, keeper: keeperIn ? Number(keeperIn.quantity) : null
    };
    const cost = {
      av: used.av * PRICE_USD.av, dns: used.dns * PRICE_USD.dns,
      backup: a ? a.workstations * PRICE_USD.workstation + a.vms * PRICE_USD.vm + a.servers * PRICE_USD.server + a.gb * PRICE_USD.gb : 0,
      m365: used.m365 * PRICE_USD.m365,
      wfh: (used.wfh || 0) * PRICE_USD.wfh,
      keeper: (used.keeper || 0) * (keeperIn?.unit_usd != null ? Number(keeperIn.unit_usd) : PRICE_USD.keeper)
    };
    const monthly = b ? b.monthly : 0;
    const monthlyTemplate = b?.templates.find(t => String(t.unit || '').toUpperCase() === 'MONTHLY' && Number(t.period || 1) === 1) || b?.templates[0] || null;
    const rows = [];
    for (const [p] of PRODUCTS) {
      const bp = b?.products[p] || null;
      const billed = bp ? bp.count : 0, flat = bp ? bp.flat : [];
      const coveredIn = input(p, 'covered');
      const covered = coveredIn ? Number(coveredIn.quantity) : null;
      const u = used[p];
      const row = { product: p, used: u, billed, covered, mode: flat.length ? 'flat' : billed ? 'per' : 'none', costUsd: r2(cost[p]), state: 'ok', gapUnits: 0, gapGbp: null, text: '', action: null, lines: bp ? [...bp.lines, ...flat] : [] };
      if (u == null && (p === 'wfh' || p === 'keeper')) {
        if (!billed && !flat.length) continue;
        Object.assign(row, { state: 'enter', text: p === 'wfh' ? 'Pick which devices have it' : 'Enter how many users', action: { kind: 'enter' } });
        rows.push(row); continue;
      }
      if (!u && !billed && !flat.length) continue;
      if (own) { Object.assign(row, { state: 'ok', text: 'Gecko’s own' }); rows.push(row); continue; }
      const line = bp?.lines[0] || null;
      const fix = (from, to) => line ? { kind: 'repeating', url: xeroRepeatingUrl(line.template), from, to, line: line.description }
        : monthlyTemplate ? { kind: 'add_line', url: xeroRepeatingUrl(monthlyTemplate.id), from: 0, to, line: productLabel(p) } : null;
      if (row.mode === 'none') {
        Object.assign(row, { state: 'unbilled', gapUnits: u, gapGbp: rate ? r2(cost[p] * rate) : null,
          text: `Not on the invoice (costs you ${usdText(cost[p])} a month)`, action: fix(0, u) });
      } else if (row.mode === 'per') {
        if (u > billed) Object.assign(row, { state: 'leak', gapUnits: u - billed, gapGbp: r2((u - billed) * (bp.unit || 0)), text: `${u - billed} more in use than billed`, action: fix(billed, u) });
        else if (u < billed) Object.assign(row, { state: u === 0 && p === 'av' && !w ? 'check' : 'over', gapUnits: billed - u, gapGbp: r2((billed - u) * (bp.unit || 0)),
          text: u === 0 && p === 'av' && !w ? 'No Webroot site under this name' : `${billed - u} fewer in use than billed`,
          // "Check": the client may be under another name in Webroot, so look before changing anything.
          action: u === 0 && p === 'av' && !w ? { ...fix(billed, u), to: null } : fix(billed, u) });
        else row.text = 'Matches';
      } else if (!u) {
        // Nothing in use under a bundle: fine (a bundle names more than every client takes), unless nothing is there at all.
        if (p !== 'av' || w) continue;
        Object.assign(row, { state: 'check', text: 'No Webroot site under this name', action: { kind: 'repeating', url: xeroRepeatingUrl(flat[0].template), line: flat[0].description } });
      } else {
        const total = (covered ?? 0) + billed;
        if (covered == null) Object.assign(row, { state: 'record', text: 'Flat fee: not recorded yet', fee: r2(flat.reduce((t, f) => t + f.amount, 0)), action: { kind: 'record' } });
        else if (u > total) Object.assign(row, { state: 'grown', gapUnits: u - total, text: `${u - total} more than the fee was priced on`, action: { kind: 'repeating', url: xeroRepeatingUrl(flat[0].template), line: flat[0].description } });
        else row.text = 'Within the fee';
      }
      rows.push(row);
    }
    const costUsd = r2(Object.values(cost).reduce((t, n) => t + n, 0));
    const costGbp = rate ? r2(costUsd * rate) : null;
    return {
      name, own, monthly, costUsd, costGbp, margin: costGbp == null ? null : r2(monthly - costGbp),
      rows, dead: w ? w.dead : [], webroot: w ? w.name : '', acronis: a ? a.name : ''
    };
  }).filter(c => c.rows.length || c.dead.length);

  const RANK = { leak: 0, unbilled: 0, check: 1, over: 1, grown: 1, record: 2, enter: 2, ok: 3 };
  for (const c of clients) {
    c.rows.sort((x, y) => RANK[x.state] - RANK[y.state]);
    c.belowCost = !c.own && c.margin != null && c.monthly > 0 && c.margin < 0;
    c.issues = c.rows.filter(r => r.state !== 'ok').length + (c.dead.length ? 1 : 0) + (c.belowCost ? 1 : 0);
    c.worst = c.rows.length ? RANK[c.rows[0].state] : 3;
  }
  clients.sort((x, y) => (y.issues > 0) - (x.issues > 0) || x.worst - y.worst || y.issues - x.issues || x.name.localeCompare(y.name));
  const sum = (state, k) => r2(clients.reduce((t, c) => t + c.rows.filter(r => r.state === state).reduce((s, r) => s + (Number(r[k]) || 0), 0), 0));
  return {
    clients,
    totals: {
      leakGbp: r2(sum('leak', 'gapGbp') + sum('unbilled', 'gapGbp')),
      overGbp: r2(sum('over', 'gapGbp') + sum('check', 'gapGbp')),
      deadDevices: clients.reduce((t, c) => t + c.dead.length, 0),
      deadUsd: r2(clients.reduce((t, c) => t + c.dead.length, 0) * PRICE_USD.av),
      toRecord: clients.reduce((t, c) => t + c.rows.filter(r => r.state === 'record' || r.state === 'enter').length, 0),
      needsLook: clients.filter(c => c.issues).length,
      clients: clients.length
    }
  };
}

const usdText = n => `$${(Number(n) || 0).toFixed(2)}`;
