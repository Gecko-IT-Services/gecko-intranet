/* Weekly summary: pure logic for Timesheets › Weekly Summary (no window). Tested in tests/weekly.mjs.
   Design: docs/superpowers/specs/2026-10-09-weekly-summary-design.md

   One week (Monday to Sunday) of logged work: totals against the week before, each engineer by day,
   clients and work types, weekdays nobody logged, the entries themselves, and an eight-week trend.
   Work only: System entries (renewal credits, adjustments) are not time anyone spent. */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const day = d => String(d || '').slice(0, 10);

export const ENGINEERS = ['Philip', 'Jack'];

export function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = key => new Date(key + 'T00:00:00Z').getUTCDay();
export const monday = key => addDays(key, -((dow(key) + 6) % 7));

const isWork = e => !/^system$/i.test(String(e.engineer || '').trim()) && Number(e.hours) > 0;
const described = e => String(e.workDescription || e.description || '').trim();
const inWeek = (e, start) => { const d = day(e.date); return d >= start && d <= addDays(start, 6); };

function weekTotal(entries, start) {
  return round2(entries.filter(e => isWork(e) && inWeek(e, start)).reduce((t, e) => t + Number(e.hours), 0));
}

/**
 * entries: [{ id, clientName, engineer, date, hours, workType, description, workDescription }]
 * weekStart: a Monday (YYYY-MM-DD); today: YYYY-MM-DD.
 */
export function weekSummary(entries, weekStart, today) {
  const start = monday(weekStart), end = addDays(start, 6);
  const work = (entries || []).filter(e => isWork(e) && inWeek(e, start));
  const engineers = [...new Set([...ENGINEERS, ...work.map(e => e.engineer || 'Unknown')])];
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const mine = work.filter(e => day(e.date) === date);
    const byEng = Object.fromEntries(engineers.map(p => [p, round2(mine.filter(e => (e.engineer || 'Unknown') === p).reduce((t, e) => t + Number(e.hours), 0))]));
    return { date, weekend: i >= 5, future: date > today, byEng, total: round2(mine.reduce((t, e) => t + Number(e.hours), 0)) };
  });
  const byEng = Object.fromEntries(engineers.map(p => [p, round2(days.reduce((t, d) => t + d.byEng[p], 0))]));
  const group = (key, none) => {
    const m = new Map();
    for (const e of work) {
      const k = key(e) || none;
      const g = m.get(k) || { name: k, hours: 0, entries: 0, byEng: {} };
      g.hours = round2(g.hours + Number(e.hours)); g.entries++;
      g.byEng[e.engineer || 'Unknown'] = round2((g.byEng[e.engineer || 'Unknown'] || 0) + Number(e.hours));
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  };
  const total = round2(work.reduce((t, e) => t + Number(e.hours), 0));
  const prevTotal = weekTotal(entries || [], addDays(start, -7));
  // Weekdays already past (or today) with nothing logged by an engineer who normally logs.
  const gaps = [];
  for (const p of ENGINEERS) for (const d of days) if (!d.weekend && d.date <= today && !d.byEng[p]) gaps.push({ engineer: p, date: d.date });
  const list = work.slice().sort((a, b) => day(a.date).localeCompare(day(b.date)) || String(a.engineer).localeCompare(String(b.engineer)))
    .map(e => ({ id: e.id, date: day(e.date), engineer: e.engineer, client: e.clientName, hours: Number(e.hours), workType: e.workType || '', description: described(e) }));
  return {
    start, end, isCurrent: start === monday(today), isFuture: start > today,
    total, prevTotal, change: round2(total - prevTotal),
    engineers, byEng, days, clients: group(e => e.clientName, 'Unknown client'), types: group(e => e.workType, 'No work type'),
    gaps, entries: list
  };
}

/** Total hours for the `weeks` weeks ending with the one starting `weekStart`, oldest first. */
export function trend(entries, weekStart, today, weeks = 8) {
  const start = monday(weekStart);
  return Array.from({ length: weeks }, (_, i) => {
    const s = addDays(start, -7 * (weeks - 1 - i));
    return { start: s, total: weekTotal(entries || [], s), current: s === monday(today) };
  });
}

/** "5 – 11 Oct 2026", "29 Sept – 5 Oct 2026", "29 Dec 2025 – 4 Jan 2026". */
export function weekLabel(start) {
  const end = addDays(start, 6);
  const f = (k, o) => new Date(k + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${f(start, { day: 'numeric', month: 'short', year: 'numeric' })} – ${f(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (start.slice(0, 7) !== end.slice(0, 7)) return `${f(start, { day: 'numeric', month: 'short' })} – ${f(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${f(start, { day: 'numeric' })} – ${f(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
