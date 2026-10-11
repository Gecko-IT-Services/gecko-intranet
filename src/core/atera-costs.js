/* Atera costs: pure logic (no window). Tested in tests/atera-costs.mjs.
   Design: docs/superpowers/specs/2026-10-12-atera-costs-design.md

   What Atera charges Gecko (technician seats + AppCenter add-ons, atera_bills) against what clients are charged for
   Atera services in Xero (item codes "Atera …"), split by feature: Backup (Acronis), Security (Webroot / OpenText),
   Passwords (Keeper), Work from home (remote access), Management (paid for by the technician seats). The add-ons charge
   is one line on Atera's receipt; the split per client and feature comes from Atera's usage report (atera_usage), which
   is only stored when its lines add up to the charge. Without a report the page still shows the bill, the sales and the
   leaks it can see from devices, and says what the report would add. */

import { sameAteraClient, isInternal, isServer, daysSince, STALE_DAYS } from './devices.js';

export const FEATURES = [
  { key: 'backup', label: 'Backup', maker: 'Acronis' },
  { key: 'security', label: 'Security', maker: 'Webroot / OpenText' },
  { key: 'passwords', label: 'Passwords', maker: 'Keeper' },
  { key: 'remote', label: 'Work from home', maker: 'remote access' },
  { key: 'management', label: 'Management', maker: 'Atera technician seats' },
  { key: 'other', label: 'Other add-ons', maker: 'e.g. Network Discovery' }
];
export const featureLabel = key => (FEATURES.find(f => f.key === key) || { label: key }).label;

/** Atera's loyalty offer (Abril / Erik, 11–16 Sep 2026): $143.10 per technician a month on annual billing, vs $189. */
export const SEAT_OFFER_USD = 143.10;
/** A usage report must add up to the add-ons charge within this (Atera rounds per line). Same rule as save_atera_usage. */
export const RECONCILE_USD = 1.00;

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const lc = s => String(s || '').toLowerCase();

// — Features from words. A retainer line ("Remote IT Support, Defender AV, Windows Backup, Remote Management…") is
//   management only: its backup and antivirus are Windows' own, not Atera add-ons. —
const RETAINER = /remote it support|monthly maintenance|remote management|cloud management/;
const PATTERNS = [
  ['backup', /acronis|cloud backup|hosted storage|workload|(?<!windows )\bbackup\b/],
  ['security', /webroot|opentext|internet security|pc security|endpoint|dns protection|antivirus/],
  ['passwords', /keeper|password|breachwatch/],
  ['remote', /work from home|\bwfh\b|enduser remote|end user remote|splashtop|remote access/]
];

/** Features a Xero line sells, from its description (item code as a fallback). [] = no Atera feature named. */
export function saleFeatures(text) {
  const t = lc(text);
  const found = PATTERNS.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (RETAINER.test(t)) return t.includes('cloud management') ? [...new Set([...found, 'management'])] : ['management'];
  return found;
}

/** The one feature an Atera usage line (an AppCenter product) is for. */
export function costFeature(product) {
  const t = lc(product);
  for (const [k, re] of PATTERNS) if (re.test(t)) return k;
  return 'other';
}

// — Usage report: a CSV or spreadsheet whose columns we find by their headings (Atera's layout isn't documented). —
const HEAD = {
  customer: /customer|client|company|account|organi[sz]ation/,
  product: /product|item|service|app|plan|sku|description|package/,
  quantity: /qty|quantity|units|count|seats|devices|endpoints|workloads|usage|\bgb\b/,
  amount: /total|amount|cost|charge|price|usd|\$/
};

/** CSV text → rows of cells (quotes, doubled quotes and line breaks inside quotes handled). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

/** "$1,234.50", "(12.00)", 12 → number; NaN when it isn't money. */
export function money(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = Number(s.replace(/[()$£€,\s-]|USD|GBP/gi, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/**
 * Finds the heading row and which column holds what. → { header, customer, product, quantity, amount, headings } with
 * column indexes (-1 when not found). Among money columns a "total" beats "amount" beats "cost" beats a unit price.
 */
export function detectColumns(rows) {
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const heads = rows[h].map(c => lc(c).trim());
    const find = (re, not = []) => heads.findIndex((t, i) => t && re.test(t) && !not.includes(i));
    const customer = find(HEAD.customer);
    const amountRank = re => heads.findIndex(t => re.test(t) && !/unit|per |rate/.test(t));
    let amount = [/total/, /amount/, /cost|charge/, /usd|\$/].map(amountRank).find(i => i >= 0) ?? -1;
    if (amount < 0) amount = find(/price/);
    if (customer < 0 || amount < 0) continue;
    const product = find(HEAD.product, [customer, amount]);
    const quantity = find(HEAD.quantity, [customer, amount, product]);
    return { header: h, customer, product, quantity, amount, headings: rows[h].map(c => String(c).trim()) };
  }
  return { header: -1, customer: -1, product: -1, quantity: -1, amount: -1, headings: (rows[0] || []).map(c => String(c).trim()) };
}

/**
 * Rows + columns → usage lines { row_no, customer, product, feature, quantity, usd } and what was left out.
 * Total / subtotal rows and rows without an amount are skipped (and counted) so they can't double the cost.
 */
export function usageLines(rows, cols) {
  const lines = [], skipped = [];
  if (!cols || cols.header < 0) return { lines, skipped, total: 0 };
  let lastCustomer = '';
  for (let i = cols.header + 1; i < rows.length; i++) {
    const r = rows[i];
    const cell = k => (cols[k] >= 0 ? String(r[cols[k]] ?? '').trim() : '');
    const usd = money(r[cols.amount]);
    let customer = cell('customer');
    const product = cell('product');
    if (/^(grand\s*)?(sub)?total\b/i.test(customer) || /^(grand\s*)?(sub)?total\b/i.test(product)) { skipped.push({ row: i + 1, why: 'total row' }); continue; }
    if (!Number.isFinite(usd)) { if (customer || product) skipped.push({ row: i + 1, why: 'no amount' }); continue; }
    if (!customer && product && lastCustomer) customer = lastCustomer;     // grouped reports name the customer once
    if (!customer && !product) { skipped.push({ row: i + 1, why: 'total row' }); continue; }
    lastCustomer = customer;
    const q = cols.quantity >= 0 ? money(r[cols.quantity]) : NaN;
    lines.push({ row_no: i + 1, customer, product, feature: costFeature(product), quantity: Number.isFinite(q) ? q : null, usd: r2(usd) });
  }
  return { lines, skipped, total: r2(lines.reduce((t, l) => t + l.usd, 0)) };
}

/** Does a report's total match the add-ons charge? → { ok, diff } (diff = file − charge, USD). */
export function reconcile(totalUsd, billUsd) {
  if (billUsd == null) return { ok: false, diff: null };
  const diff = r2(totalUsd - billUsd);
  return { ok: Math.abs(diff) <= RECONCILE_USD, diff };
}

// — The bill —

/** atera_bills rows → per month (newest first): { month, seats:{usd,gbp}, addons:{usd,gbp}, usd, gbp, rate, estimated, techs }. */
export function billMonths(bills) {
  const by = new Map();
  for (const b of bills || []) {
    const e = by.get(b.month) || { month: b.month, seats: { usd: 0, gbp: 0 }, addons: { usd: 0, gbp: 0 }, estimated: false, techs: 0, charges: [] };
    const part = e[b.kind] || (e[b.kind] = { usd: 0, gbp: 0 });
    part.usd = r2(part.usd + Number(b.usd));
    part.gbp = r2(part.gbp + Number(b.gbp ?? 0));
    if (b.gbp == null || b.gbp_source === 'rate') e.estimated = true;
    if (b.kind === 'seats') e.techs += Number((String(b.product).match(/\((\d+)\)/) || [])[1] || 0);
    e.charges.push(b);
    by.set(b.month, e);
  }
  return [...by.values()].map(e => {
    const usd = r2(e.seats.usd + e.addons.usd), gbp = r2(e.seats.gbp + e.addons.gbp);
    return { ...e, usd, gbp, rate: usd ? gbp / usd : null };
  }).sort((a, b) => b.month.localeCompare(a.month));
}

/** The feed's `atera` section → atera_bills rows to add (GBP at the feed's rate). Months already held are left alone. */
export function billsFromFeed(atera, have = []) {
  if (!atera?.charges?.length) return [];
  const held = new Set((have || []).map(b => `${b.charged_on}|${b.kind}`));
  return atera.charges.map(c => {
    const kind = /appcenter|usage/i.test(c.product) ? 'addons' : 'seats';
    const usd = r2(c.usd);
    return { month: String(c.date).slice(0, 7), charged_on: c.date, kind, product: String(c.product || ''), usd,
      gbp: atera.usdToGbp ? r2(usd * atera.usdToGbp) : null, gbp_source: 'rate', ref: 'feed' };
  }).filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.charged_on) && !held.has(`${b.charged_on}|${b.kind}`));
}

// — What clients are charged —

/** Xero invoices → Atera lines per contact for `month`: Map(contact → { contact, total, lines:[{ text, amount, features }] }). */
export function ateraSales(invoices, month) {
  const out = new Map();
  for (const inv of invoices || []) {
    if (!String(inv.invoice_date || '').startsWith(month)) continue;
    if (!['AUTHORISED', 'PAID'].includes(String(inv.status || '').toUpperCase())) continue;
    for (const l of inv.line_items || []) {
      const code = String(l.item_code || '');
      if (!/^atera\b/i.test(code)) continue;
      const amount = r2(l.line_amount != null ? l.line_amount : (Number(l.quantity) || 0) * (Number(l.unit_amount) || 0));
      const text = String(l.description || code);
      let features = saleFeatures(text);
      if (!features.length) features = saleFeatures(code);
      const e = out.get(inv.contact_name) || { contact: inv.contact_name, total: 0, lines: [] };
      e.total = r2(e.total + amount);
      e.lines.push({ text, amount, features });
      out.set(inv.contact_name, e);
    }
  }
  return out;
}

/** Atera sales per month for a list of months: { 'YYYY-MM': total }. */
export function salesByMonth(invoices, months) {
  const o = {};
  for (const m of months) o[m] = r2([...ateraSales(invoices, m).values()].reduce((t, c) => t + c.total, 0));
  return o;
}

// — The month, put together —

/**
 * month: 'YYYY-MM'. bill: one billMonths() entry (or null). usage / prevUsage: atera_usage rows for this and the previous
 * month (or null when no report). invoices: xero_invoices. agents: atera_agents. today: 'YYYY-MM-DD'. fallbackRate: GBP
 * per USD when the month has no paid amount. lastSeats: the latest seats charge ({ usd, techs }), so the seat offer shows in a month
 * whose seats charge hasn't come yet.
 * → { hasUsage, rate, cost, sale, margin, features, clients, own, leaks, leakTotal, changes, unmatched }
 */
export function ateraMonth({ month, bill, usage, prevUsage, invoices, agents, today, fallbackRate = null, lastSeats = null }) {
  const rate = bill?.rate || fallbackRate;
  const gbp = usd => (rate ? r2(usd * rate) : null);
  const hasUsage = !!(usage && usage.length);
  const sales = ateraSales(invoices, month);
  // Every contact ever charged for Atera, so a client with nothing invoiced this month still shows under its Xero name.
  const contacts = [...new Set([...sales.keys(), ...(invoices || []).filter(i => (i.line_items || []).some(l => /^atera\b/i.test(String(l.item_code || '')))).map(i => i.contact_name)])];

  // One entry per client, keyed by the Xero contact when there is one.
  const clients = new Map();
  const entry = (ateraName, contact) => {
    const key = contact || `atera:${ateraName}`;
    let c = clients.get(key);
    if (!c) {
      c = { key, name: contact || ateraName, contact: contact || '', ateraNames: new Set(), internal: isInternal(ateraName || contact),
        costUsd: Object.fromEntries(FEATURES.map(f => [f.key, 0])), products: [], devices: 0, stale: 0, servers: 0, saleLines: [] };
      clients.set(key, c);
    }
    if (ateraName) c.ateraNames.add(ateraName);
    return c;
  };
  const contactFor = ateraName => contacts.find(x => sameAteraClient(ateraName, x)) || '';

  for (const s of sales.values()) entry('', s.contact).saleLines.push(...s.lines);
  for (const u of usage || []) {
    const c = entry(u.customer, contactFor(u.customer));
    c.costUsd[u.feature] = r2((c.costUsd[u.feature] || 0) + Number(u.usd));
    c.products.push(u);
  }
  for (const a of agents || []) {
    const c = entry(a.customer_name, contactFor(a.customer_name));
    c.devices++;
    if (isServer(a)) c.servers++;
    const d = daysSince(a.last_seen, today);
    if (d != null && d >= STALE_DAYS) c.stale++;
  }

  const list = [...clients.values()].map(c => {
    const costUsd = r2(Object.values(c.costUsd).reduce((t, v) => t + v, 0));
    const saleByFeature = Object.fromEntries(FEATURES.map(f => [f.key, 0]));
    let bundled = 0, split = false;
    for (const l of c.saleLines) {
      const fs = l.features.length ? l.features : ['management'];
      if (fs.length === 1) { saleByFeature[fs[0]] = r2(saleByFeature[fs[0]] + l.amount); continue; }
      // A bundle: split by what each of its features costs this client, or evenly when that isn't known.
      const weights = fs.map(f => c.costUsd[f] || 0);
      const sum = weights.reduce((t, w) => t + w, 0);
      fs.forEach((f, i) => { saleByFeature[f] = r2(saleByFeature[f] + l.amount * (sum ? weights[i] / sum : 1 / fs.length)); });
      bundled = r2(bundled + l.amount); split = true;
    }
    const sale = r2(c.saleLines.reduce((t, l) => t + l.amount, 0));
    const cost = hasUsage ? gbp(costUsd) : null;
    return {
      ...c, ateraNames: [...c.ateraNames], costUsd: hasUsage ? c.costUsd : null, costUsdTotal: hasUsage ? costUsd : null,
      cost, costByFeature: hasUsage ? Object.fromEntries(Object.entries(c.costUsd).map(([k, v]) => [k, gbp(v)])) : null,
      sale, saleByFeature, bundled, split, margin: cost != null ? r2(sale - cost) : null
    };
  });
  const own = list.filter(c => c.internal);
  const clientsOut = list.filter(c => !c.internal)
    .sort((a, b) => (a.margin ?? a.sale) - (b.margin ?? b.sale) || a.name.localeCompare(b.name));

  // Features: add-on cost from the report; management is paid for by the technician seats.
  const features = FEATURES.map(f => {
    const sale = r2(clientsOut.reduce((t, c) => t + c.saleByFeature[f.key], 0));
    let cost = null;
    if (f.key === 'management') cost = bill ? (bill.seats.gbp || gbp(bill.seats.usd)) : null;
    else if (hasUsage) cost = gbp(list.reduce((t, c) => t + (c.costUsd?.[f.key] || 0), 0));
    return { ...f, cost, sale, margin: cost != null ? r2(sale - cost) : null };
  }).filter(f => f.cost || f.sale);

  const sale = r2(clientsOut.reduce((t, c) => t + c.sale, 0));
  const cost = bill ? (bill.gbp || gbp(bill.usd)) : null;

  // — Leaks: money going out that no client pays for, largest first. —
  const leaks = [];
  const seats = bill?.seats?.usd ? { usd: bill.seats.usd, techs: bill.techs } : lastSeats;
  if (seats?.usd) {
    const techs = seats.techs || 2;
    const save = r2(seats.usd - techs * SEAT_OFFER_USD);
    if (save > 0) leaks.push({ kind: 'seat_offer', client: '', perMonth: gbp(save), usd: save, sure: true,
      text: `Technician seats: ${techs} × ${dollars(seats.usd / techs)} a month. Atera offered ${dollars(SEAT_OFFER_USD)} a seat on annual billing (Sep): ${dollars(save * 12)} a year less.` });
  }
  for (const c of clientsOut) {
    if (hasUsage && c.cost > 0 && c.sale === 0) {
      leaks.push({ kind: 'unbilled', client: c.name, perMonth: c.cost, sure: true, text: `Add-ons cost ${fmt(c.cost)} a month; no Atera line in Xero this month.` });
      continue;
    }
    if (hasUsage && c.sale > 0 && c.cost > c.sale) leaks.push({ kind: 'below_cost', client: c.name, perMonth: r2(c.cost - c.sale), sure: true, text: `Charged ${fmt(c.sale)} but the add-ons cost ${fmt(c.cost)}.` });
    if (hasUsage && c.sale > 0) {
      const sold = new Set(c.saleLines.flatMap(l => l.features));
      for (const f of FEATURES) {
        const v = c.costByFeature[f.key];
        if (f.key === 'management' || f.key === 'other' || !(v >= 0.5) || sold.has(f.key)) continue;
        leaks.push({ kind: 'unbilled_feature', client: c.name, perMonth: v, sure: true, text: `${f.label} (${f.maker}) costs ${fmt(v)} a month; no Xero line mentions it.` });
      }
    }
    if (!hasUsage && c.devices && c.sale === 0) {
      leaks.push({ kind: 'devices_unbilled', client: c.name, perMonth: null, sure: false, text: `${c.devices} device${c.devices === 1 ? '' : 's'} in Atera, no Atera line in Xero. Any add-ons on them are Gecko’s cost.` });
    }
    if (c.stale) {
      const per = hasUsage && c.devices && c.cost ? r2(c.cost / c.devices * c.stale) : null;
      leaks.push({ kind: 'stale', client: c.name, perMonth: per, sure: false,
        text: `${c.stale} device${c.stale === 1 ? '' : 's'} not seen for ${STALE_DAYS}+ days${per != null ? `: about ${fmt(per)} a month if they carry add-ons like the rest` : ''}. Remove them in Atera.` });
    }
  }
  for (const o of own) {
    if (hasUsage && o.cost > 0) leaks.push({ kind: 'own', client: o.name, perMonth: o.cost, sure: false, text: `Gecko’s own machines: add-ons ${fmt(o.cost)} a month (not billed to anyone).` });
    if (o.stale) leaks.push({ kind: 'stale', client: o.name, perMonth: null, sure: false, text: `${o.stale} of Gecko’s own devices not seen for ${STALE_DAYS}+ days. Remove them in Atera.` });
  }
  const ORDER = { seat_offer: 0, unbilled: 1, below_cost: 2, unbilled_feature: 3, stale: 4, devices_unbilled: 5, own: 6 };
  leaks.sort((a, b) => (b.perMonth ?? -1) - (a.perMonth ?? -1) || ORDER[a.kind] - ORDER[b.kind]);
  const leakTotal = r2(leaks.filter(l => l.sure && l.perMonth).reduce((t, l) => t + l.perMonth, 0));

  return { month, hasUsage, rate, cost, sale, margin: cost != null ? r2(sale - cost) : null, features, clients: clientsOut, own,
    leaks, leakTotal, changes: usageChanges(usage, prevUsage, gbp), unmatched: clientsOut.filter(c => !c.contact && c.costUsdTotal > 0).map(c => c.name) };
}

const fmt = n => '£' + (Number(n) || 0).toFixed(2);
const dollars = n => '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Why the add-ons went up or down: per customer and product, this month's report against last month's.
 * → { total: { usd, gbp }, lines: [{ customer, product, feature, before, after, diff, qtyBefore, qtyAfter, gbp }] } biggest first,
 * or null without both reports.
 */
export function usageChanges(usage, prevUsage, gbp = () => null) {
  if (!usage?.length || !prevUsage?.length) return null;
  const key = u => `${lc(u.customer)}|${lc(u.product)}`;
  const sum = rows => {
    const m = new Map();
    for (const u of rows) {
      const e = m.get(key(u)) || { customer: u.customer, product: u.product, feature: u.feature, usd: 0, qty: null };
      e.usd = r2(e.usd + Number(u.usd));
      if (u.quantity != null) e.qty = r2((e.qty || 0) + Number(u.quantity));
      m.set(key(u), e);
    }
    return m;
  };
  const now = sum(usage), before = sum(prevUsage);
  const lines = [];
  for (const k of new Set([...now.keys(), ...before.keys()])) {
    const a = before.get(k), b = now.get(k), base = b || a;
    const diff = r2((b?.usd || 0) - (a?.usd || 0));
    if (Math.abs(diff) < 0.01) continue;
    lines.push({ customer: base.customer, product: base.product, feature: base.feature, before: a?.usd || 0, after: b?.usd || 0, diff,
      qtyBefore: a?.qty ?? null, qtyAfter: b?.qty ?? null, gbp: gbp(diff), state: !a ? 'new' : !b ? 'gone' : diff > 0 ? 'up' : 'down' });
  }
  lines.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  const total = r2(lines.reduce((t, l) => t + l.diff, 0));
  return { total: { usd: total, gbp: gbp(total) }, lines };
}

