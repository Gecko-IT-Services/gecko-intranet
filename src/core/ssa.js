/* SSA dashboard: pure logic for Timesheets › SSA Dashboard (no window). Tested in tests/ssa.mjs.
   Design: docs/superpowers/specs/2026-10-09-ssa-dashboard-design.md

   Per SSA client: the balance as Timesheets holds it (never recalculated here: Philip's rule),
   how fast hours are being used (the last 90 days of work, System credits/adjustments excluded),
   roughly when they run out, the last six months of use, and the last time work was logged.
   The status says what needs doing: over → renew → low → ok, or quiet when nothing is being used. */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const day = d => String(d || '').slice(0, 10);

function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthKey(key, back) {
  const d = new Date(key.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 7);
}

export const RENEW_HOURS = 2;      // under this many hours left: time to renew (as the client page and Overview flag it)
export const RUNWAY_RENEW = 1;     // or under a month of hours at the current pace
export const RUNWAY_LOW = 2;       // under two months: running low
export const STATUS_ORDER = ['over', 'renew', 'low', 'ok', 'quiet'];
const isWork = e => !/^system$/i.test(String(e.engineer || '').trim()) && Number(e.hours) > 0;

/**
 * clients: [{ id, name, hoursPurchased, hoursUsed, hoursRemaining, archived }]
 * entries: [{ clientName, engineer, date, hours }] (deleted ones already left out)
 * Returns { rows, totals } with rows sorted most urgent first.
 */
export function ssaBoard(clients, entries, today) {
  const since90 = addDays(today, -90);
  const months = Array.from({ length: 6 }, (_, i) => monthKey(today, 5 - i));
  const by = new Map();
  for (const e of entries || []) {
    if (!isWork(e)) continue;
    const list = by.get(e.clientName) || [];
    list.push(e);
    by.set(e.clientName, list);
  }
  const rows = (clients || []).filter(c => !c.archived && Number(c.hoursPurchased) > 0).map(c => {
    const mine = by.get(c.name) || [];
    const purchased = round2(c.hoursPurchased);
    const remaining = round2(c.hoursRemaining ?? (purchased - (Number(c.hoursUsed) || 0)));
    const used = round2(c.hoursUsed ?? purchased - remaining);
    const last90 = round2(mine.filter(e => day(e.date) >= since90 && day(e.date) <= today).reduce((t, e) => t + Number(e.hours), 0));
    const perMonth = round2(last90 / 3);
    const runway = perMonth > 0 ? Math.round(Math.max(0, remaining) / perMonth * 10) / 10 : null;   // months
    const runsOut = perMonth > 0 && remaining > 0 ? addDays(today, Math.round(remaining / perMonth * 30.44)) : null;
    const byMonth = months.map(m => ({ month: m, hours: round2(mine.filter(e => day(e.date).slice(0, 7) === m).reduce((t, e) => t + Number(e.hours), 0)) }));
    const last = mine.filter(e => day(e.date) <= today).sort((a, b) => day(b.date).localeCompare(day(a.date)))[0] || null;
    const status = remaining < 0 ? 'over'
      : remaining < RENEW_HOURS || (runway != null && runway < RUNWAY_RENEW) ? 'renew'
      : remaining < purchased * 0.2 || (runway != null && runway < RUNWAY_LOW) ? 'low'
      : perMonth === 0 ? 'quiet' : 'ok';
    return {
      id: c.id, name: c.name, purchased, used, remaining,
      pctLeft: purchased > 0 ? Math.max(0, Math.min(1, remaining / purchased)) : 0,
      last90, perMonth, runway, runsOut, byMonth,
      lastDate: last ? day(last.date) : null, lastBy: last?.engineer || '', status
    };
  }).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    || (a.runway ?? 999) - (b.runway ?? 999) || a.remaining - b.remaining || a.name.localeCompare(b.name));
  const totals = {
    clients: rows.length,
    remaining: round2(rows.reduce((t, r) => t + Math.max(0, r.remaining), 0)),
    overBy: round2(rows.reduce((t, r) => t + Math.max(0, -r.remaining), 0)),
    attention: rows.filter(r => r.status === 'over' || r.status === 'renew').length,
    low: rows.filter(r => r.status === 'low').length,
    last90: round2(rows.reduce((t, r) => t + r.last90, 0)),
    perMonth: round2(rows.reduce((t, r) => t + r.perMonth, 0))
  };
  return { rows, totals, months };
}

/** "about 3 months", "about 2 weeks", "under a week". */
export function runwayText(runway) {
  if (runway == null) return '';
  if (runway >= 1.5) return `about ${Math.round(runway)} months`;
  if (runway >= 0.9) return 'about a month';
  const weeks = Math.round(runway * 4.35);
  return weeks >= 2 ? `about ${weeks} weeks` : weeks === 1 ? 'about a week' : 'under a week';
}

/** Rows a view shows: 'attention' = over / renew / low; 'all'; with an optional name search. */
export function filterRows(rows, { view = 'all', q = '' } = {}) {
  const s = String(q).trim().toLowerCase();
  return rows.filter(r => (view !== 'attention' || ['over', 'renew', 'low'].includes(r.status))
    && (!s || r.name.toLowerCase().includes(s)));
}
