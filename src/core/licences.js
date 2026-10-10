/* Microsoft 365 licence check: pure logic (no window). Tested in tests/licences.mjs.
   Design: docs/superpowers/specs/2026-10-10-licence-check-design.md

   Compares what TD SYNNEX charges Gecko for each client's Microsoft 365 licences (the monthly CSP invoice, from the
   feed's cspInvoices) with the M365 lines Gecko invoices that client in Xero the same month (xero_invoices).
   It reports differences; it never suggests prices beyond the client's own rate, and it never writes anywhere.

   Two levels, depending on what the feed holds for the TD invoice:
   - cost only (customers[{ customer, client, cost }]): per client TD cost vs Xero M365 revenue and margin;
     on TD but nothing in Xero, or billed in Xero but not on TD.
   - seat detail (customers[].skus[{ mfpn, product, seats, unitCost, total, commitment }]): per client and product,
     TD seats vs Xero seats, with the variance types Philip's monthly reconciliation uses. */

import { sameClient } from './client.js';

/** Products, matched on the MFPN prefix (TD side) or the words on the Xero line. Order matters for Xero text. */
export const PRODUCTS = [
  { key: 'exo1', label: 'Exchange Online Plan 1', mfpn: ['CFQ7TTC0LH16'], words: /exchange[^,]*plan\s*1|hosted (microsoft )?exchange|exchange[^,]*50\s*gb|exchange online \(plan 1\)/i },
  { key: 'exo2', label: 'Exchange Online Plan 2', mfpn: ['CFQ7TTC0LH1P'], words: /exchange[^,]*plan\s*2|exchange[^,]*100\s*gb/i },
  { key: 'archive', label: 'Exchange Online Archiving', mfpn: ['CFQ7TTC0LH0J'], words: /archiving/i },
  { key: 'bprem', label: 'Business Premium', mfpn: ['CFQ7TTC0LCHC'], words: /business premium|\bpremium\b/i },
  { key: 'bstd', label: 'Business Standard', mfpn: ['CFQ7TTC0LDPB'], words: /business standard|\bstandard\b/i },
  { key: 'bbasic', label: 'Business Basic', mfpn: ['CFQ7TTC0LH18'], words: /business basic|\bbasic\b/i },
  { key: 'onedrive', label: 'OneDrive / 1TB storage', mfpn: ['CFQ7TTC0LHSV'], words: /one\s?drive|1\s?tb/i }
];
const LABEL = Object.fromEntries(PRODUCTS.map(p => [p.key, p.label]));
export const productLabel = key => LABEL[key] || (key === 'any' ? 'M365 (product not named)' : key);

export const TYPES = {
  UNBILLED_CLIENT: 'Not billed',
  UNBILLED_SKU: 'Product not billed',
  SEAT_SHORT: 'Fewer seats billed',
  SEAT_OVER: 'More seats billed',
  NO_TD_LINE: 'Not on TD SYNNEX',
  UNMATCHABLE: 'Can’t compare seats',
  MATCH: 'Matches'
};

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** TD product → key, by MFPN prefix first, then the description. '' when unknown. */
export function tdProduct(sku) {
  const m = String(sku?.mfpn || '').toUpperCase();
  const hit = PRODUCTS.find(p => p.mfpn.some(x => m.startsWith(x)));
  if (hit) return hit.key;
  return xeroProduct(sku?.product || '') || '';
}

/** The product a Xero line names, or '' ("M365 Subscription" alone names none). Exchange 50Gb + archiving is Plan 1. */
export function xeroProduct(text) {
  const s = String(text || '');
  if (/hosted (microsoft )?exchange|exchange[^,]*50\s*gb/i.test(s)) return 'exo1';
  return (PRODUCTS.find(p => p.words.test(s)) || {}).key || '';
}

/** Is this Xero line a Microsoft 365 licence? Item code M365 (Philip's), never backup or other items. */
export const isLicenceLine = l => String(l?.item_code || '').trim().toUpperCase() === 'M365';

/**
 * A Xero line → [{ product, seats, unit, total, lump }]. Lump lines (qty 1 carrying several seats) are opened up
 * when the text says how many: "Business Standard x 3", "(13 seats: 8x Business Standard, 4x Exchange Online Plan 2)".
 */
export function xeroSeats(line) {
  const text = String(line.description || '');
  const qty = Number(line.quantity) || 0;
  const total = r2(line.line_amount ?? qty * (Number(line.unit_amount) || 0));
  const parts = [...text.matchAll(/(\d+)\s*x\s+([^,()]+)/gi)].map(m => ({ seats: Number(m[1]), product: xeroProduct(m[2]) }));
  if (qty === 1 && parts.length > 1 && parts.every(p => p.product)) {
    return parts.map(p => ({ product: p.product, seats: p.seats, unit: null, total: null, lump: true, groupTotal: total }));
  }
  const times = text.match(/\bx\s*(\d+)\b/i);
  if (qty === 1 && times && Number(times[1]) > 1) {
    const seats = Number(times[1]);
    return [{ product: xeroProduct(text), seats, unit: r2(total / seats), total, lump: false }];
  }
  return [{ product: xeroProduct(text), seats: qty, unit: r2(Number(line.unit_amount) || 0), total, lump: false }];
}

/** The months that have a TD SYNNEX invoice, newest first. */
export function licenceMonths(feed) {
  return [...new Set((feed?.cspInvoices || []).map(c => String(c.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
}

/** M365 lines invoiced in Xero in `month` (approved or paid; drafts and voided don't count), per contact. */
export function xeroLicences(invoices, month) {
  const out = new Map();
  for (const inv of invoices || []) {
    if (!String(inv.invoice_date || '').startsWith(month)) continue;
    if (!['AUTHORISED', 'PAID'].includes(String(inv.status || '').toUpperCase())) continue;
    for (const l of inv.line_items || []) {
      if (!isLicenceLine(l)) continue;
      const e = out.get(inv.contact_name) || { contact: inv.contact_name, lines: [] };
      for (const s of xeroSeats(l)) e.lines.push({ ...s, invoice: inv.invoice_number, text: l.description || '' });
      out.set(inv.contact_name, e);
    }
  }
  return [...out.values()];
}

/**
 * The check for one month.
 * feed: the profit feed (cspInvoices). invoices: xero_invoices rows ({ contact_name, invoice_number, invoice_date, status,
 * line_items }). prev: the same check for the month before (to tag a variance as "repeat"), optional.
 * → { month, invoice, detail, clients: [...], totals, unknown: [...] }
 */
export function licenceCheck(feed, invoices, month, prev = null) {
  const tdInvoices = (feed?.cspInvoices || []).filter(c => String(c.date || '').startsWith(month));
  const xero = xeroLicences(invoices, month);
  const detail = tdInvoices.length > 0 && tdInvoices.every(c => (c.customers || []).every(r => Array.isArray(r.skus) && r.skus.length));
  const byClient = new Map();
  const key = name => {
    for (const k of byClient.keys()) if (sameClient(k, name)) return k;
    return name;
  };
  const entry = name => {
    const k = key(name);
    if (!byClient.has(k)) byClient.set(k, { client: k, tdCost: 0, xeroRevenue: 0, td: [], xero: [], invoices: new Set() });
    return byClient.get(k);
  };
  for (const c of tdInvoices) {
    for (const r of c.customers || []) {
      const e = entry(r.client || r.customer);
      e.tdName = r.customer;
      e.tdCost = r2(e.tdCost + r.cost);
      for (const s of r.skus || []) e.td.push({ product: tdProduct(s), name: s.product || s.mfpn || '', seats: Number(s.seats) || 0, unit: Number(s.unitCost) || 0, total: r2(s.total), commitment: s.commitment || '', tenant: s.tenant || '' });
    }
  }
  for (const x of xero) {
    const e = entry(x.contact);
    e.xeroName = x.contact;
    for (const l of x.lines) {
      e.xero.push(l);
      if (l.total != null) e.xeroRevenue = r2(e.xeroRevenue + l.total);
      else if (l.groupTotal != null && !e.invoices.has(`${l.invoice}|${l.text}`)) e.xeroRevenue = r2(e.xeroRevenue + l.groupTotal);
      e.invoices.add(`${l.invoice}|${l.text}`);
    }
  }

  const prevRows = new Map();
  // Same client, product and kind of difference last month = repeat; a month without seat detail matches on client and kind.
  for (const c of prev?.clients || []) for (const r of c.rows) if (r.type !== 'MATCH') { prevRows.set(`${c.client}|${r.product}|${r.type}`, true); prevRows.set(`${c.client}||${r.type}`, r.product); }
  const repeat = (client, r) => prevRows.has(`${client}|${r.product}|${r.type}`) || ((!prev?.detail || r.product === 'any') && prevRows.has(`${client}||${r.type}`));

  const clients = [...byClient.values()].map(e => {
    const rows = detail ? seatRows(e) : costRows(e);
    for (const r of rows) if (r.type !== 'MATCH') r.cause = repeat(e.client, r) ? 'repeat' : (prev ? 'new this month' : '');
    const margin = r2(e.xeroRevenue - e.tdCost);
    const monthly = e.td.filter(t => /month/i.test(t.commitment)).map(t => productLabel(t.product));
    return {
      client: e.client, tdName: e.tdName || '', xeroName: e.xeroName || '', tdCost: e.tdCost, xeroRevenue: e.xeroRevenue, margin,
      marginPct: e.xeroRevenue > 0 ? Math.round(margin / e.xeroRevenue * 100) : null,
      invoices: [...new Set(e.xero.map(l => l.invoice))], rows, monthly,
      worth: r2(rows.reduce((s, r) => s + Math.abs(r.worth || 0), 0)),
      ok: rows.every(r => r.type === 'MATCH')
    };
  }).sort((a, b) => b.worth - a.worth || a.client.localeCompare(b.client));

  const tdCost = r2(tdInvoices.reduce((s, c) => s + (Number(c.netTotal) || 0), 0));
  const xeroRevenue = r2(clients.reduce((s, c) => s + c.xeroRevenue, 0));
  return {
    month, detail, invoice: tdInvoices.map(c => ({ invoice: c.invoice, date: c.date, netTotal: c.netTotal })),
    clients,
    totals: {
      tdCost, xeroRevenue, margin: r2(xeroRevenue - tdCost),
      marginPct: xeroRevenue > 0 ? Math.round((xeroRevenue - tdCost) / xeroRevenue * 100) : null,
      differences: clients.reduce((s, c) => s + c.rows.filter(r => r.type !== 'MATCH').length, 0),
      worth: r2(clients.reduce((s, c) => s + c.rows.filter(r => r.worth > 0).reduce((t, r) => t + r.worth, 0), 0))
    }
  };
}

/** Cost-only level: one row per client. worth = £/month on TD that nothing in Xero covers. */
function costRows(e) {
  if (e.tdCost > 0 && !e.xero.length) return [{ product: 'any', type: 'UNBILLED_CLIENT', tdTotal: e.tdCost, worth: e.tdCost }];
  if (!e.tdCost && e.xero.length) return [{ product: 'any', type: 'NO_TD_LINE', xeroTotal: e.xeroRevenue, worth: 0 }];
  return [{ product: 'any', type: 'MATCH', tdTotal: e.tdCost, xeroTotal: e.xeroRevenue, worth: 0 }];
}

/** Seat level: TD rolled up per product (all subscriptions and commitments), compared with Xero per product. */
function seatRows(e) {
  const td = new Map(), xe = new Map();
  for (const t of e.td) {
    const k = t.product || `td:${t.name}`;
    const a = td.get(k) || { seats: 0, total: 0, units: new Set() };
    a.seats += t.seats; a.total = r2(a.total + t.total); a.units.add(t.unit);
    td.set(k, a);
  }
  const generic = { seats: 0, total: 0, lines: [] };
  for (const l of e.xero) {
    if (!l.product) { generic.seats += l.seats; generic.total = r2(generic.total + (l.total || 0)); generic.lines.push(l); continue; }
    const a = xe.get(l.product) || { seats: 0, total: 0, unit: null, lump: false, invoice: l.invoice, text: l.text };
    a.seats += l.seats; a.total = r2(a.total + (l.total || 0)); a.lump = a.lump || l.lump;
    if (l.unit != null) a.unit = a.unit == null ? l.unit : Math.max(a.unit, l.unit);
    xe.set(l.product, a);
  }
  if (!e.xero.length) {
    return [...td.entries()].map(([k, a]) => ({ product: k, type: 'UNBILLED_CLIENT', tdSeats: a.seats, tdTotal: a.total, tdUnit: unitOf(a), worth: a.total }));
  }
  const rows = [];
  const leftover = [];
  for (const [k, a] of td) {
    const x = xe.get(k);
    if (!x) { leftover.push([k, a]); continue; }
    const base = { product: k, tdSeats: a.seats, tdUnit: unitOf(a), tdTotal: a.total, xeroSeats: x.seats, xeroUnit: x.unit, xeroTotal: x.lump ? null : x.total, invoice: x.invoice };
    if (x.seats === a.seats) rows.push({ ...base, type: 'MATCH', worth: 0 });
    else if (x.seats < a.seats) rows.push({ ...base, type: 'SEAT_SHORT', worth: x.unit != null ? r2((a.seats - x.seats) * x.unit) : r2((a.seats - x.seats) * unitOf(a)), fix: x.unit != null ? { invoice: x.invoice, line: x.text, from: x.seats, to: a.seats, unit: x.unit } : null });
    else rows.push({ ...base, type: 'SEAT_OVER', worth: 0 });
  }
  // Xero lines that name no product ("M365 Subscription"): they cover what is left, if the seats add up.
  const leftSeats = leftover.reduce((s, [, a]) => s + a.seats, 0);
  if (generic.seats) {
    const unit = generic.seats ? r2(generic.total / generic.seats) : null;
    if (leftover.length && generic.seats === leftSeats) {
      for (const [k, a] of leftover) rows.push({ product: k, type: 'MATCH', tdSeats: a.seats, tdUnit: unitOf(a), tdTotal: a.total, xeroSeats: a.seats, xeroUnit: unit, note: 'billed as “M365 Subscription”', worth: 0 });
    } else if (leftover.length) {
      rows.push({ product: 'any', type: 'UNMATCHABLE', tdSeats: leftSeats, xeroSeats: generic.seats, xeroUnit: unit, invoice: generic.lines[0].invoice,
        note: `${leftover.map(([k, a]) => `${a.seats} × ${productLabel(k)}`).join(', ')} on TD SYNNEX; Xero line doesn’t name the product`,
        worth: generic.seats < leftSeats && unit ? r2((leftSeats - generic.seats) * unit) : 0 });
    } else {
      rows.push({ product: 'any', type: 'NO_TD_LINE', xeroSeats: generic.seats, xeroTotal: generic.total, invoice: generic.lines[0].invoice, note: 'Xero line doesn’t name the product', worth: 0 });
    }
  } else {
    for (const [k, a] of leftover) {
      rows.push({ product: k, type: 'UNBILLED_SKU', tdSeats: a.seats, tdUnit: unitOf(a), tdTotal: a.total, xeroSeats: 0, worth: a.total });
    }
  }
  for (const [k, x] of xe) {
    if (td.has(k)) continue;
    rows.push({ product: k, type: 'NO_TD_LINE', xeroSeats: x.seats, xeroUnit: x.unit, xeroTotal: x.lump ? null : x.total, invoice: x.invoice, worth: 0 });
  }
  return rows;
}

const unitOf = a => (a.units.size === 1 ? [...a.units][0] : a.seats ? r2(a.total / a.seats) : 0);

/**
 * A price to suggest for a product the client isn't billed for, and which rule gave it (Philip's order):
 * 1. the client's own rate for that product elsewhere, 2. the client's own mark-up on their other licences applied to
 * the TD cost, 3. the median rate for that product across the book. Always an estimate. → { unit, rule } or null.
 */
export function suggestRate(check, client, product, tdUnit) {
  const c = check.clients.find(x => x.client === client);
  const own = c?.rows.find(r => r.product === product && r.xeroUnit);
  if (own) return { unit: own.xeroUnit, rule: 'their own rate for this product' };
  const matched = (c?.rows || []).filter(r => r.xeroUnit && r.tdUnit && r.type !== 'UNBILLED_SKU');
  if (matched.length && tdUnit) {
    const markup = matched.reduce((s, r) => s + r.xeroUnit * (r.xeroSeats || 1), 0) / matched.reduce((s, r) => s + r.tdUnit * (r.xeroSeats || 1), 0);
    return { unit: r2(tdUnit * markup), rule: `their own mark-up on other licences (× ${markup.toFixed(2)})` };
  }
  const book = check.clients.flatMap(x => x.rows).filter(r => r.product === product && r.xeroUnit).map(r => r.xeroUnit).sort((a, b) => a - b);
  if (book.length) return { unit: book[Math.floor((book.length - 1) / 2)], rule: `median across clients (${book.length})` };
  return null;
}
