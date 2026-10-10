/* Analytics: pure logic (no window). Tested in tests/analytics.mjs.
   Design: docs/superpowers/specs/2026-10-10-analytics-design.md

   Four questions, each answered from data another section already owns:
   Revenue (Xero invoices, as Jobs reads them), Clients (the feed and service lines, as Profitability
   counts them, against timesheet hours), Time (timesheet entries and leave), Ahead (SSA run-out dates
   and the Opportunities gaps). Nothing here changes a figure's meaning: it only lines them up. */

import { monthOf, previousMonth, repeatDates, xeroHistory, xeroMonthSales } from './jobs.js';
import { invoicedCosts, splitByClient, hasSplit, xeroMonths } from './profit-feed.js';
import { ENGINEERS, addDays, monday } from './weekly.js';
import { SSA_BLOCK_PRICE } from './ssa-renewal.js';

export const TARGET_RATE = 65;    // £ kept per hour worked: the SSA price (£650) over ten hours. Philip to confirm.
export const DEPENDENCE = 0.15;   // a client above this share of recurring revenue is a dependency
export const SOON_DAYS = 30;      // an SSA block running out within this many days is amber

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
const day = d => String(d || '').slice(0, 10);
const COUNTED = new Set(['AUTHORISED', 'PAID']);
const VOIP = /voip\s*unlimited/i;   // dealer commission is never a client's revenue (Philip, 8 Oct)
const isRepeat = i => !!String(i.repeating_invoice_id || '').trim();
const isWork = e => !e.deleted_at && !/^system$/i.test(String(e.engineer || '').trim()) && num(e.hours) > 0;

// ─── Revenue ──────────────────────────────────────────────────────────

/** Recurring net per Xero contact for one month: Map(name -> £). */
function recurringBy(invoices, month, exclude) {
  const out = new Map();
  for (const i of invoices || []) {
    if (monthOf(i.invoice_date) !== month || !COUNTED.has(i.status) || !isRepeat(i)) continue;
    const name = i.contact_name || 'Unknown contact';
    if (exclude && exclude.test(name)) continue;
    out.set(name, round2((out.get(name) || 0) + num(i.sub_total)));
  }
  return out;
}

/**
 * Why recurring revenue changed from the month before `month` to `month`, per Xero contact.
 * `month` counts what is raised plus what its repeating invoices will still raise (their own dates and
 * amounts), so a month in progress is compared whole. Each move says what kind it is:
 *   gained: 'new' (first recurring invoice ever) | 'periodic' (billed before, not last month) | 'more'
 *   lost:   'left' (no repeating invoice any more) | 'notdue' (still has one, none due this month) | 'less'
 */
export function recurringMoves(invoices, repeating, { month, exclude = VOIP } = {}) {
  const from = previousMonth(month);
  const prev = recurringBy(invoices, from, exclude);
  const now = recurringBy(invoices, month, exclude);
  let toCome = 0;
  const live = new Set();
  for (const r of repeating || []) {
    const name = r.contact_name || 'Unknown contact';
    if (r.status === 'DELETED' || (exclude && exclude.test(name))) continue;
    if (!r.end_date || day(r.end_date) >= `${month}-01`) live.add(name);
    for (let n = repeatDates(r, month).length; n > 0; n--) {
      now.set(name, round2((now.get(name) || 0) + num(r.sub_total)));
      toCome = round2(toCome + num(r.sub_total));
    }
  }
  const before = new Set();
  for (const i of invoices || []) if (COUNTED.has(i.status) && isRepeat(i) && monthOf(i.invoice_date) < from) before.add(i.contact_name || 'Unknown contact');

  const gained = [], lost = [];
  for (const name of new Set([...prev.keys(), ...now.keys()])) {
    const a = prev.get(name) || 0, b = now.get(name) || 0, v = round2(b - a);
    if (Math.abs(v) < 0.005) continue;
    if (v > 0) gained.push({ name, v, kind: a ? 'more' : before.has(name) ? 'periodic' : 'new' });
    else lost.push({ name, v, kind: b ? 'less' : live.has(name) ? 'notdue' : 'left' });
  }
  gained.sort((x, y) => y.v - x.v || x.name.localeCompare(y.name));
  lost.sort((x, y) => x.v - y.v || x.name.localeCompare(y.name));
  const total = m => round2([...m.values()].reduce((t, v) => t + v, 0));
  return {
    from, to: month, prev: total(prev), now: total(now), toCome,
    gained, lost, gSum: round2(gained.reduce((t, m) => t + m.v, 0)), lSum: round2(-lost.reduce((t, m) => t + m.v, 0)),
    shares: [...now.entries()].map(([name, v]) => ({ name, v })).filter(s => s.v > 0).sort((x, y) => y.v - x.v || x.name.localeCompare(y.name))
  };
}

/**
 * Invoiced per month, oldest first, from the first month with anything in it. The month in progress also
 * carries what is still to come: repeating invoices not yet raised, and jobs to invoice or due this month
 * (the same sums as Jobs › This month).
 */
export function monthSeries(invoices, repeating, jobs, { month, n = 12 } = {}) {
  const hist = xeroHistory(invoices || [], { month, n });
  const first = hist.findIndex(h => h.has);
  if (first < 0) return [];
  const cur = xeroMonthSales(invoices || [], repeating || [], jobs || [], { month });
  return hist.slice(first).map(h => (h.month === month
    ? { ...h, recToCome: cur.toCome, oneToCome: round2(cur.toInvoice + cur.dueThisMonth) }
    : { ...h, recToCome: 0, oneToCome: 0 }));
}

/** Share of recurring revenue per contact, with who is over the dependence line. */
export function concentration(shares, line = DEPENDENCE) {
  const total = round2(shares.reduce((t, s) => t + s.v, 0));
  const rows = shares.map(s => ({ ...s, share: total > 0 ? s.v / total : 0 })).map(s => ({ ...s, over: s.share >= line }));
  return { total, rows, top3: rows.slice(0, 3).reduce((t, s) => t + s.share, 0), over: rows.filter(s => s.over).length };
}

// ─── Money per client, as Profitability counts it ─────────────────────

/**
 * One month for every client, by Profitability's rules (7 Oct 2026): recurring and one-off from Xero in
 * the feed; cost = the monthly service lines + supplier invoices dated that month. While the feed covers
 * supplier invoices for the month, m365 lines (TD SYNNEX) and hosting lines (Clook) contribute no typed cost.
 * The month's total cost includes shared and unassigned supplier lines, as Profitability's total does.
 * clients: [{ id, name }]; services: [{ clientName, category, cost }]; match: Xero name -> client.
 */
export function monthMoney(feed, month, clients, services, match) {
  const covered = xeroMonths(feed).some(([m]) => m === month) && (feed.cspInvoices != null || feed.exclaimer != null || feed.clook != null);
  const inv = covered ? invoicedCosts(feed, month, match) : null;
  const split = hasSplit(feed, month) ? splitByClient(feed, month, match) : null;
  const m365 = !!(inv && Array.isArray(feed.cspInvoices)), hosting = !!(inv && feed.clook);
  let lineCost = 0;
  const rows = (clients || []).map(c => {
    const typed = round2((services || []).filter(s => s.clientName === c.name)
      .reduce((t, s) => t + ((s.category === 'm365' && m365) || (s.category === 'hosting' && hosting) ? 0 : num(s.cost)), 0));
    lineCost = round2(lineCost + typed);
    const x = split?.get(c.id);
    return { client: c, cost: round2(typed + (inv?.byClient.get(c.id)?.total || 0)), recurring: x?.recurring || 0, oneOff: x?.oneOff || 0, total: x?.total || 0 };
  });
  const recurring = round2(rows.reduce((t, r) => t + r.recurring, 0));
  const cost = round2(lineCost + (inv ? inv.total : 0));
  return {
    month, split: !!split, rows, recurring, cost,
    margin: split && recurring > 0 ? (recurring - cost) / recurring : null,
    // The TD SYNNEX invoice lands around the 16th: until then a month's margin flatters.
    licenceIn: (feed?.cspInvoices || []).some(c => String(c.date || '').startsWith(month + '-'))
  };
}

/** Hours worked per client over `months` (YYYY-MM list): Map(clientId -> hours). `clientOf` maps a timesheet client name to a client. */
export function hoursByClient(entries, months, clientOf) {
  const out = new Map(), want = new Set(months);
  for (const e of entries || []) {
    if (!isWork(e) || !want.has(monthOf(e.date))) continue;
    const c = clientOf(e.clientName);
    if (c) out.set(c.id, round2((out.get(c.id) || 0) + num(e.hours)));
  }
  return out;
}

/**
 * What each client leaves after suppliers, per hour worked, over the given months (monthMoney results).
 * Only clients with hours logged can have a rate; the rest are counted, not ranked. Worst first.
 */
export function earnedPerHour(months, hours, target = TARGET_RATE) {
  const by = new Map();
  for (const m of months) for (const r of m.rows) {
    const e = by.get(r.client.id) || { name: r.client.name, invoiced: 0, cost: 0 };
    e.invoiced = round2(e.invoiced + r.total); e.cost = round2(e.cost + r.cost);
    by.set(r.client.id, e);
  }
  const rows = [], noHours = [];
  for (const [id, e] of by) {
    const h = hours.get(id) || 0, kept = round2(e.invoiced - e.cost);
    if (h > 0) rows.push({ name: e.name, hours: h, kept, rate: kept / h, short: round2(Math.max(0, h * target - kept)), under: kept / h < target });
    else if (e.invoiced > 0) noHours.push(e.name);
  }
  rows.sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));
  const under = rows.filter(r => r.under), allH = round2(rows.reduce((t, r) => t + r.hours, 0)), kept = round2(rows.reduce((t, r) => t + r.kept, 0));
  return {
    target, rows, noHours: noHours.sort(),
    totals: {
      hours: allH, kept, rate: allH > 0 ? kept / allH : null, under: under.length,
      underHours: round2(under.reduce((t, r) => t + r.hours, 0)), short: round2(under.reduce((t, r) => t + r.short, 0))
    }
  };
}

// ─── Time ─────────────────────────────────────────────────────────────

/**
 * Every weekday for the last `weeks` weeks, per person: 'ok' (hours logged), 'away' (approved leave),
 * 'closed', 'blank' (a working day with nothing logged) or 'future'. Today is never blank: the day isn't over.
 * leave: [{ person, start, end, status }].
 */
export function logGrid(entries, leave, { today, weeks = 26, people = ENGINEERS } = {}) {
  const start = addDays(monday(today), -7 * (weeks - 1));
  const hrs = new Map(), top = new Map();
  for (const e of entries || []) {
    if (!isWork(e)) continue;
    const k = `${e.engineer}|${day(e.date)}`;
    hrs.set(k, round2((hrs.get(k) || 0) + num(e.hours)));
    const t = top.get(k) || {};
    t[e.clientName] = (t[e.clientName] || 0) + num(e.hours);
    top.set(k, t);
  }
  const away = new Set();
  for (const r of leave || []) {
    if (!/approved/i.test(r.status || '')) continue;
    for (let d = day(r.start); d && d <= day(r.end || r.start); d = addDays(d, 1)) away.add(`${r.person}|${d}`);
  }
  // ponytail: a weekday nobody logged counts as closed (bank holidays aren't known here), so a day both
  // forgot is not flagged. Read gov.uk's bank-holiday list if that ever hides real gaps.
  const closed = d => !people.some(p => hrs.get(`${p}|${d}`));
  let blanks = 0, okDays = 0, okHours = 0;
  const grid = people.map(name => ({
    name,
    weeks: Array.from({ length: weeks }, (_, w) => Array.from({ length: 5 }, (_, i) => {
      const date = addDays(start, w * 7 + i), h = hrs.get(`${name}|${date}`) || 0;
      const state = h > 0 ? 'ok' : date >= today ? 'future' : away.has(`${name}|${date}`) ? 'away' : closed(date) ? 'closed' : 'blank';
      if (state === 'ok') { okDays++; okHours += h; }
      if (state === 'blank') blanks++;
      const t = top.get(`${name}|${date}`);
      return { date, state, hours: h, top: t ? Object.entries(t).sort((a, b) => b[1] - a[1])[0][0] : '' };
    }))
  }));
  const avgDay = okDays ? okHours / okDays : 0;
  return { start, weeks, people: grid, blanks, avgDay, missing: round2(blanks * avgDay) };
}

/** Support (remote and on site), planned work (projects, set-ups, maintenance) or other. */
export const workKind = type => (/support/i.test(type || '') ? 'support' : /project|set ?up|maintenance/i.test(type || '') ? 'planned' : 'other');

/** Hours per week by kind of work for the last `weeks` weeks, oldest first, the week in progress included. */
export function weeklyKinds(entries, { today, weeks = 13 } = {}) {
  const first = addDays(monday(today), -7 * (weeks - 1));
  const rows = Array.from({ length: weeks }, (_, i) => ({ start: addDays(first, i * 7), support: 0, planned: 0, other: 0, total: 0 }));
  for (const e of entries || []) {
    if (!isWork(e)) continue;
    const i = Math.floor((Date.parse(day(e.date) + 'T00:00:00Z') - Date.parse(first + 'T00:00:00Z')) / (7 * 864e5));
    if (i < 0 || i >= weeks || day(e.date) > today) continue;
    const k = workKind(e.workType);
    rows[i][k] = round2(rows[i][k] + num(e.hours));
    rows[i].total = round2(rows[i].total + num(e.hours));
  }
  return rows;
}

/** Support's share of the hours in these weeks (null when nothing was logged). */
export function supportShare(rows) {
  const total = rows.reduce((t, r) => t + r.total, 0);
  return total > 0 ? rows.reduce((t, r) => t + r.support, 0) / total : null;
}

// ─── Ahead ────────────────────────────────────────────────────────────

/**
 * When each SSA block runs out, soonest first, from the SSA dashboard's rows (core/ssa.js ssaBoard: balances
 * are read as they stand, never recalculated). A balance at or below zero is due now. Clients using nothing
 * have no date and are only counted. byMonth is the renewal income to expect, one block each.
 */
export function renewals(rows, today, price = SSA_BLOCK_PRICE) {
  const list = [], quiet = [];
  for (const r of rows || []) {
    const over = r.remaining <= 0;
    if (!over && !r.runsOut) { quiet.push(r.name); continue; }
    const out = over ? today : r.runsOut;
    const days = Math.round((Date.parse(out + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);
    list.push({ name: r.name, remaining: r.remaining, perMonth: r.perMonth, out, over, days, state: over ? 'over' : days <= SOON_DAYS ? 'soon' : 'ok' });
  }
  list.sort((a, b) => a.out.localeCompare(b.out) || a.remaining - b.remaining || a.name.localeCompare(b.name));
  const by = new Map();
  for (const r of list) by.set(monthOf(r.out), (by.get(monthOf(r.out)) || 0) + 1);
  return { rows: list, quiet, price, byMonth: [...by.entries()].map(([month, count]) => ({ month, count, value: round2(count * price) })) };
}

/**
 * Whitespace per product from the Opportunities gaps map: for each product, one token per client
 * ('has' | 'deal' | 'gap' | 'off') and what filling its gaps is worth a month. Largest first.
 * clients: [{ name, mrr, cells: { [productKey]: { state, mrr } } }], state as mapCell returns it.
 */
export function whitespace({ products = [], clients = [] } = {}) {
  const TOKEN = { won: 'has', has: 'has', deal: 'deal', strong: 'gap', some: 'gap', maybe: 'gap' };
  const order = [...clients].sort((a, b) => num(b.mrr) - num(a.mrr) || a.name.localeCompare(b.name));
  const rows = products.map(p => {
    const tokens = order.map(c => {
      const cell = c.cells?.[p.key] || {};
      const state = TOKEN[cell.state] || 'off';
      return { client: c.name, state, mrr: state === 'gap' || state === 'deal' ? num(cell.mrr) : 0, why: cell.state === 'no' ? 'Not interested' : '' };
    });
    return {
      key: p.key, name: p.name, tokens,
      total: round2(tokens.filter(t => t.state === 'gap').reduce((t, x) => t + x.mrr, 0)),
      pipeline: round2(tokens.filter(t => t.state === 'deal').reduce((t, x) => t + x.mrr, 0)),
      unpriced: tokens.filter(t => t.state === 'gap' && !t.mrr).length
    };
  }).filter(r => r.tokens.some(t => t.state !== 'off')).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { rows, total: round2(rows.reduce((t, r) => t + r.total, 0)), pipeline: round2(rows.reduce((t, r) => t + r.pipeline, 0)) };
}
