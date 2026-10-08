/* Team overview: pure logic (no window). Tested in tests/team.mjs.
   Design: docs/superpowers/specs/2026-10-09-gecko-hq-structure-design.md (stage 3)

   Philip and Jack at a glance: who's in, holiday left, the next four weeks, hours logged and
   mileage still to claim. Same rules as the Leave and Mileage sections. */

export const PEOPLE = ['Philip', 'Jack'];
export const DAY_HOURS = 7;                 // Leave's standard day
export const DEFAULT_ENTITLEMENT = 140;     // Leave's default when no entitlement row exists

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const day = d => String(d || '').slice(0, 10);

export function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = key => new Date(key + 'T00:00:00Z').getUTCDay();   // 0 Sunday … 6 Saturday
export const monday = key => addDays(key, -((dow(key) + 6) % 7));

/** UK tax year a date falls in ("2026/27" from 6 April 2026), as the Leave section uses. */
export function taxYear(key) {
  const y = Number(key.slice(0, 4));
  const start = y + (key >= `${y}-04-06` ? 0 : -1);
  return `${start}/${String(start + 1).slice(-2)}`;
}
export function taxYearBounds(ty) {
  const y = Number(String(ty).slice(0, 4));
  return { start: `${y}-04-06`, end: `${y + 1}-04-05` };
}

/** The first name a record means: "Jack Morris" → "Jack". */
export const person = name => {
  const n = String(name || '').trim().toLowerCase();
  return PEOPLE.find(p => n.startsWith(p.toLowerCase())) || String(name || '').trim().split(/\s+/)[0] || '';
};

/**
 * Holiday for one person this tax year, as Leave counts it: entitlement (+ carry over + adjustment)
 * minus approved Annual Leave overlapping the year; pending shown separately.
 * requests: [{ person, start, end, hours, status, type }], entitlements: [{ person, tax_year, entitlement_hours, carry_over_hours, adjustment_hours }]
 */
export function holiday(requests, entitlements, who, ty) {
  const e = (entitlements || []).find(x => person(x.person) === who && x.tax_year === ty);
  const entitlement = e ? round2(Number(e.entitlement_hours || 0) + Number(e.carry_over_hours || 0) + Number(e.adjustment_hours || 0)) : DEFAULT_ENTITLEMENT;
  const b = taxYearBounds(ty);
  const mine = (requests || []).filter(r => person(r.person) === who && (r.type || 'Annual Leave') === 'Annual Leave'
    && day(r.start) <= b.end && day(r.end || r.start) >= b.start);
  const booked = round2(mine.filter(r => r.status === 'Approved').reduce((t, r) => t + Number(r.hours || 0), 0));
  const pending = round2(mine.filter(r => r.status === 'Pending').reduce((t, r) => t + Number(r.hours || 0), 0));
  return { entitlement, booked, pending, remaining: round2(entitlement - booked), days: round2((entitlement - booked) / DAY_HOURS) };
}

/**
 * The next `weeks` weeks from this Monday: per person, a cell per day:
 * { date, weekend, today, state: 'off' | 'pending' | '', type }.
 */
export function calendar(requests, today, { weeks = 4 } = {}) {
  const start = monday(today);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const live = (requests || []).filter(r => r.status === 'Approved' || r.status === 'Pending');
  return {
    days,
    rows: PEOPLE.map(p => ({
      person: p,
      cells: days.map(d => {
        const r = live.find(x => person(x.person) === p && day(x.start) <= d && day(x.end || x.start) >= d);
        return { date: d, weekend: dow(d) === 0 || dow(d) === 6, today: d === today,
          state: r ? (r.status === 'Approved' ? 'off' : 'pending') : '', type: r?.type || '' };
      })
    }))
  };
}

/** Today and next: is each person off today, and their next leave from today. */
export function presence(requests, today) {
  const live = (requests || []).filter(r => r.status === 'Approved' || r.status === 'Pending')
    .sort((a, b) => day(a.start).localeCompare(day(b.start)));
  return Object.fromEntries(PEOPLE.map(p => {
    const mine = live.filter(r => person(r.person) === p && day(r.end || r.start) >= today);
    const now = mine.find(r => r.status === 'Approved' && day(r.start) <= today);
    const next = mine.find(r => day(r.start) > today);
    return [p, { off: !!now, back: now ? addDays(day(now.end || now.start), 1) : null, next: next || null, pendingCount: mine.filter(r => r.status === 'Pending').length }];
  }));
}

/** Hours logged this week and last, per person and per weekday this week (System credits are not work). */
export function hours(entries, today) {
  const thisMon = monday(today), lastMon = addDays(thisMon, -7);
  const out = Object.fromEntries(PEOPLE.map(p => [p, { week: 0, last: 0, byDay: [0, 0, 0, 0, 0, 0, 0] }]));
  for (const e of entries || []) {
    if (e.deleted_at) continue;
    const p = person(e.engineer);
    if (!out[p]) continue;
    const d = day(e.entry_date ?? e.date);
    const h = Number(e.hours) || 0;
    if (d >= thisMon && d <= addDays(thisMon, 6)) {
      out[p].week = round2(out[p].week + h);
      out[p].byDay[(dow(d) + 6) % 7] = round2(out[p].byDay[(dow(d) + 6) % 7] + h);
    } else if (d >= lastMon && d < thisMon) out[p].last = round2(out[p].last + h);
  }
  return out;
}

/** Mileage per driver: this month, and what is still to claim (oldest first). */
export function mileage(journeys, today) {
  const month = today.slice(0, 7);
  const out = Object.fromEntries(PEOPLE.map(p => [p, { miles: 0, amount: 0, trips: 0, unclaimed: 0, unclaimedTrips: 0, oldest: null }]));
  for (const j of journeys || []) {
    const p = person(j.driver);
    if (!out[p]) continue;
    const d = day(j.journey_date ?? j.date);
    if (d.slice(0, 7) === month) { out[p].miles = round2(out[p].miles + Number(j.miles || 0)); out[p].amount = round2(out[p].amount + Number(j.amount || 0)); out[p].trips++; }
    if (!(j.claimed_date ?? j.claimedDate)) {
      out[p].unclaimed = round2(out[p].unclaimed + Number(j.amount || 0)); out[p].unclaimedTrips++;
      if (!out[p].oldest || d < out[p].oldest) out[p].oldest = d;
    }
  }
  return out;
}
