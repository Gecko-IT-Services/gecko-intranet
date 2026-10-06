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
    }
  }

  if (feed.csp != null) {
    const c = feed.csp;
    if (!c.invoice) errors.push('csp.invoice missing');
    if (!MONTH.test(c.month || '')) errors.push('csp.month is not YYYY-MM');
    if (!isMoney(c.netTotal)) errors.push('csp.netTotal missing');
    if (!Array.isArray(c.customers) || !c.customers.length) errors.push('csp.customers missing');
    else {
      for (const r of c.customers) {
        if (!r || !String(r.customer || '').trim()) errors.push('csp customer with no name');
        else if (!isMoney(r.cost)) errors.push(`csp ${r.customer}: "${r.cost}" is not a number`);
      }
      // The job checks this too; checking again here means a mis-read
      // invoice can never reach the preview looking plausible.
      if (isMoney(c.netTotal) && Math.abs(cspSum(c) - c.netTotal) > 0.05) {
        errors.push(`csp lines add up to ${cspSum(c).toFixed(2)}, invoice says ${c.netTotal.toFixed(2)}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
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
