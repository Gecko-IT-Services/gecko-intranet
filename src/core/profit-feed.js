// Profitability feed — the file a scheduled job writes so the page no
// longer needs CSV exports. See docs/superpowers/specs/2026-10-06-live-profitability-design.md.
//
// The browser cannot call Xero or TD SYNNEX (no secrets in a public site,
// and Xero blocks browser calls), so a scheduled Claude task reads both and
// writes one JSON file into the portal site's document library. This module
// is the pure half: checking that file and turning it into the shapes the
// existing Xero and CSP import paths already take.

export const FEED_FOLDER = 'Gecko Dashboard Data';
export const FEED_FILE   = 'profitability-feed.json';
export const FEED_PATH   = `${FEED_FOLDER}/${FEED_FILE}`;
export const FEED_VERSION = 1;

/** Older than this and the page says the feed has stopped. */
export const STALE_HOURS = 36;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const isMoney = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Check a parsed feed. Returns { ok, errors }. A bad section is reported,
 * never half-used: money is written from this.
 */
export function validateFeed(feed) {
  const errors = [];
  if (!feed || typeof feed !== 'object') return { ok: false, errors: ['Feed is not a JSON object'] };
  if (feed.version !== FEED_VERSION) errors.push(`Unknown feed version ${feed.version}`);
  if (!feed.generatedAt || isNaN(Date.parse(feed.generatedAt))) errors.push('generatedAt missing or not a date');

  if (feed.xero != null) {
    if (typeof feed.xero !== 'object' || typeof feed.xero.months !== 'object' || !feed.xero.months) {
      errors.push('xero.months missing');
    } else {
      for (const [m, perContact] of Object.entries(feed.xero.months)) {
        if (!MONTH.test(m)) { errors.push(`xero month "${m}" is not YYYY-MM`); continue; }
        if (!perContact || typeof perContact !== 'object') { errors.push(`xero ${m} is not an object`); continue; }
        for (const [name, v] of Object.entries(perContact)) {
          if (!name.trim()) errors.push(`xero ${m} has a blank contact`);
          if (!isMoney(v)) errors.push(`xero ${m} ${name}: "${v}" is not a number`);
        }
      }
      // Optional: the part of each contact's total that came from Xero
      // repeating invoices. One-off = total - recurring, so recurring can
      // never name a contact or month the totals don't, or exceed its total.
      if (feed.xero.recurring != null) {
        if (typeof feed.xero.recurring !== 'object') errors.push('xero.recurring is not an object');
        else for (const [m, perContact] of Object.entries(feed.xero.recurring)) {
          const totals = feed.xero.months[m];
          if (!totals) { errors.push(`xero.recurring ${m} has no matching month`); continue; }
          if (!perContact || typeof perContact !== 'object') { errors.push(`xero.recurring ${m} is not an object`); continue; }
          for (const [name, v] of Object.entries(perContact)) {
            if (!isMoney(v)) { errors.push(`xero.recurring ${m} ${name}: "${v}" is not a number`); continue; }
            if (!(name in totals)) errors.push(`xero.recurring ${m} ${name} is not in that month's totals`);
            else if (v > totals[name] + 0.005) errors.push(`xero.recurring ${m} ${name} is more than its total`);
          }
        }
      }
    }
  }

  const checkCsp = (c, label, needMonth) => {
    if (!c.invoice) errors.push(`${label}.invoice missing`);
    if (needMonth && !MONTH.test(c.month || '')) errors.push(`${label}.month is not YYYY-MM`);
    if (!needMonth && !DAY.test(c.date || '')) errors.push(`${label}.date is not YYYY-MM-DD`);
    if (!isMoney(c.netTotal)) errors.push(`${label}.netTotal missing`);
    if (!Array.isArray(c.customers) || !c.customers.length) errors.push(`${label}.customers missing`);
    else {
      for (const r of c.customers) {
        if (!r || !String(r.customer || '').trim()) errors.push(`${label} customer with no name`);
        else if (!isMoney(r.cost)) errors.push(`${label} ${r.customer}: "${r.cost}" is not a number`);
      }
      // The job checks this too; checking again here means a mis-read
      // invoice can never reach the page looking plausible.
      if (isMoney(c.netTotal) && Math.abs(cspSum(c) - c.netTotal) > 0.05) {
        errors.push(`${label} lines add up to ${cspSum(c).toFixed(2)}, invoice says ${c.netTotal.toFixed(2)}`);
      }
    }
  };
  if (feed.csp != null) checkCsp(feed.csp, 'csp', true);
  // Every TD SYNNEX CSP invoice the job has kept (13 months), so each lands
  // in the month it is dated. `csp` above stays as the latest for older code.
  if (feed.cspInvoices != null) {
    if (!Array.isArray(feed.cspInvoices)) errors.push('cspInvoices is not a list');
    else feed.cspInvoices.forEach((c, i) => c ? checkCsp(c, `cspInvoices[${c.invoice || i}]`, false) : errors.push(`cspInvoices[${i}] is empty`));
  }
  // Supplier invoices charged to clients in the month they are dated
  // (2026-10-07). Both sections are optional; a present one must be whole.
  if (feed.exclaimer != null) {
    const subs = feed.exclaimer.subscriptions;
    if (!Array.isArray(subs)) errors.push('exclaimer.subscriptions missing');
    else subs.forEach((r, i) => {
      if (!r || !DAY.test(r.date || '')) errors.push(`exclaimer line ${i + 1}: date is not YYYY-MM-DD`);
      else if (!String(r.endUser || '').trim()) errors.push(`exclaimer ${r.invoice || i + 1}: no end user`);
      else if (!isMoney(r.net)) errors.push(`exclaimer ${r.invoice || i + 1}: "${r.net}" is not a number`);
      else if (r.shared != null && typeof r.shared !== 'boolean') errors.push(`exclaimer ${r.invoice || i + 1}: shared is not true/false`);
    });
  }
  if (feed.clook != null) {
    const invs = feed.clook.invoices;
    if (!Array.isArray(invs)) errors.push('clook.invoices missing');
    else invs.forEach((inv, i) => {
      if (!inv || !inv.invoice) { errors.push(`clook invoice ${i + 1}: no invoice number`); return; }
      if (!DAY.test(inv.date || '')) { errors.push(`clook ${inv.invoice}: date is not YYYY-MM-DD`); return; }
      if (!Array.isArray(inv.lines) || !inv.lines.length) { errors.push(`clook ${inv.invoice}: no lines`); return; }
      for (const l of inv.lines) {
        if (!l || !String(l.item || '').trim()) errors.push(`clook ${inv.invoice}: a line has no item`);
        else if (!isMoney(l.net)) errors.push(`clook ${inv.invoice} ${l.item}: "${l.net}" is not a number`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Supplier invoices dated in one month, charged to the client they were
 * for. TD SYNNEX lines match by the client name the job assigned (its
 * customer map) or the end-user name as printed; Exclaimer lines match by end-user name; Clook lines carry the
 * client name the job assigned from its domain map (null when it could
 * not). A line marked shared belongs to no client: the Clook reseller
 * hosting plan, and Gecko's own Exclaimer subscription. Nothing here is spread across months: an annual renewal
 * lands whole in the month it was invoiced, which is the point.
 *
 * Returns { byClient: Map(clientId -> { client, total, lines }),
 *           unassigned: [line + name], shared: [line], total }.
 */
export function invoicedCosts(feed, month, match) {
  const byClient = new Map(), unassigned = [], shared = [];
  let total = 0;
  const add = (client, line) => {
    total = round2(total + line.net);
    const e = byClient.get(client.id) || { client, total: 0, lines: [] };
    e.total = round2(e.total + line.net);
    e.lines.push(line);
    byClient.set(client.id, e);
  };
  for (const c of feed?.cspInvoices || []) {
    if (!String(c.date || '').startsWith(month + '-')) continue;
    for (const r of c.customers) {
      const line = { supplier: 'TD SYNNEX', desc: `Microsoft 365 licences — ${r.customer}`, date: c.date, net: round2(r.cost), ref: c.invoice };
      const client = match(r.client || r.customer);
      if (client) add(client, line);
      else { unassigned.push({ ...line, name: r.client || r.customer }); total = round2(total + line.net); }
    }
  }
  for (const s of feed?.exclaimer?.subscriptions || []) {
    if (!String(s.date || '').startsWith(month + '-')) continue;
    const line = { supplier: 'Exclaimer', desc: `${s.product} — ${s.users} users, ${s.months} mo`, date: s.date, net: round2(s.net), ref: s.invoice };
    if (s.shared) { shared.push(line); total = round2(total + line.net); continue; }
    const client = match(s.endUser);
    if (client) add(client, line);
    else { unassigned.push({ ...line, name: s.endUser }); total = round2(total + line.net); }
  }
  for (const inv of feed?.clook?.invoices || []) {
    if (!String(inv.date || '').startsWith(month + '-')) continue;
    for (const l of inv.lines) {
      const line = { supplier: 'Clook', desc: l.item, date: inv.date, net: round2(l.net), ref: inv.invoice };
      if (l.shared) { shared.push(line); total = round2(total + line.net); continue; }
      const client = l.client ? match(l.client) : null;
      if (client) add(client, line);
      else { unassigned.push({ ...line, name: l.client || l.domain || l.item }); total = round2(total + line.net); }
    }
  }
  return { byClient, unassigned, shared, total };
}

function cspSum(c) {
  return Math.round(c.customers.reduce((s, r) => s + r.cost, 0) * 100) / 100;
}

/** Hours since the job last ran. */
export function feedAgeHours(feed, now = new Date()) {
  return (now - new Date(feed.generatedAt)) / 36e5;
}

export function isStale(feed, now = new Date()) {
  return feedAgeHours(feed, now) > STALE_HOURS;
}

/** [[month, {contact: net}]] newest first, skipping empty months. */
export function xeroMonths(feed) {
  const months = feed?.xero?.months || {};
  return Object.entries(months)
    .filter(([, per]) => Object.keys(per).length)
    .sort(([a], [b]) => b.localeCompare(a));
}

/**
 * Per-client totals for one month, given a matcher from contact name to
 * client (prfXeroMatchName). Two Xero contacts that match one client are
 * summed, not overwritten.
 */
export function totalsByClient(perContact, match) {
  const byClient = new Map();
  const unmatched = [];
  for (const [name, amount] of Object.entries(perContact)) {
    const client = match(name);
    if (!client) { unmatched.push({ xeroName: name, total: round2(amount), assignedTo: null }); continue; }
    const e = byClient.get(client.id) || { client, total: 0 };
    e.total = round2(e.total + amount);
    byClient.set(client.id, e);
  }
  return { matched: [...byClient.values()], unmatched };
}

/** True when the feed says which part of a month's Xero billing is recurring. */
export function hasSplit(feed, month) {
  return !!(feed?.xero?.recurring?.[month] && feed?.xero?.months?.[month]);
}

/**
 * Recurring (Xero repeating invoices) vs one-off billing per client for one
 * month: Map clientId -> { client, total, recurring, oneOff }. Contacts that
 * match the same client are summed. Unmatched contacts are left to
 * totalsByClient, which already reports them. Empty map when the feed has
 * no split for that month (older feeds, manual CSV months).
 */
export function splitByClient(feed, month, match) {
  const out = new Map();
  if (!hasSplit(feed, month)) return out;
  const totals = feed.xero.months[month];
  const rec    = feed.xero.recurring[month];
  for (const [name, total] of Object.entries(totals)) {
    const client = match(name);
    if (!client) continue;
    const e = out.get(client.id) || { client, total: 0, recurring: 0, oneOff: 0 };
    const r = rec[name] || 0;
    e.total     = round2(e.total + total);
    e.recurring = round2(e.recurring + r);
    e.oneOff    = round2(e.total - e.recurring);
    out.set(client.id, e);
  }
  return out;
}

/** Matches CspCosts.aggregateByCustomer: [{ customer, cost }]. */
export function cspAggregated(feed) {
  return (feed?.csp?.customers || []).map(r => ({ customer: r.customer, cost: round2(r.cost) }));
}

/** Plain-English "updated" text: "today 06:52", "yesterday 06:52", "3 Oct". */
export function describeWhen(iso, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const day  = x => x.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  if (day(d) === day(now)) return `today ${time}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (day(d) === day(y)) return `yesterday ${time}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

const round2 = n => Math.round(n * 100) / 100;
