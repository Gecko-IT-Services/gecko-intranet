/* Logging time: pure logic for the Timesheets › Log Time form (no window). Tested in tests/timelog.mjs.
   Design: docs/superpowers/specs/2026-10-09-timesheets-entry-design.md

   Philip, 9 Oct: "super intuitive + robust". Hours can be typed the way people say them (1:30, 1h30,
   90m), the form says what an entry will do to the client's SSA balance before it is saved, and
   anything that looks like a mistake (a duplicate, a future date, a very long day) is shown and needs
   a second click. Nothing here changes how balances are counted (that rule lives in timesheets.js). */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const day = d => String(d || '').slice(0, 10);

export const MAX_ENTRY_HOURS = 12;   // one entry longer than this is almost certainly a typo
export const LONG_DAY_HOURS = 10;    // a day total above this asks for a second look
export const OLD_DAYS = 31;          // logging further back than this asks for a second look

function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const dow = key => new Date(key + 'T00:00:00Z').getUTCDay();

/** "1.5h", "45m", "1h 30m" for display. */
export function fmtHours(h) {
  const n = round2(h);
  const whole = Math.trunc(n), mins = Math.round((n - whole) * 60);
  if (!whole) return `${mins}m`;
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
}

/**
 * Read hours typed any common way: "1.5", "1,5", "1:30", "1h30", "1h 30m", "1 hr 30 mins", "90m",
 * "90 mins", "2h", ".75". Returns { ok, hours, typed, rounded } where hours is to the nearest quarter
 * hour (time is logged in quarters) and rounded says it moved. ok:false with a reason otherwise.
 */
export function parseHours(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(',', '.');
  if (!s) return { ok: false, reason: 'empty' };
  let typed = null, m;
  if ((m = s.match(/^(\d+):([0-5]?\d)$/))) typed = Number(m[1]) + Number(m[2]) / 60;
  else if ((m = s.match(/^(\d*\.?\d+)\s*(h|hr|hrs|hour|hours)?$/))) typed = Number(m[1]);
  else if ((m = s.match(/^(\d+)\s*(m|min|mins|minute|minutes)$/))) typed = Number(m[1]) / 60;
  else if ((m = s.match(/^(\d*\.?\d+)\s*(?:h|hr|hrs|hour|hours)\s*(\d+)\s*(?:m|min|mins|minute|minutes)?$/))) typed = Number(m[1]) + Number(m[2]) / 60;
  if (typed == null || !Number.isFinite(typed)) return { ok: false, reason: 'format' };
  const hours = Math.round(typed * 4) / 4;
  if (hours <= 0) return { ok: false, reason: 'zero', typed };
  return { ok: true, hours, typed: round2(typed), rounded: Math.abs(hours - typed) > 1e-9 };
}

/** What logging `hours` does to an SSA client: null when the client has no SSA hours. */
export function balancePreview(client, hours) {
  if (!client || !(Number(client.hoursPurchased) > 0)) return null;
  const before = round2(client.hoursRemaining ?? (client.hoursPurchased - client.hoursUsed));
  const after = round2(before - (Number(hours) || 0));
  return { before, after, state: after < 0 ? 'over' : after < 1 ? 'crit' : after < 2 ? 'low' : 'ok' };
}

// What the log shows as the description (Work Description; the Title for older rows).
const described = e => String(e.workDescription || e.description || '').trim();
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Check an entry before it is saved.
 * entry: { clientId, clientName, engineer, date, hours (parseHours result), description }
 * ctx:   { today, entries: [{ id, clientName, engineer, date, hours, description }], client (SSA record) }
 * errors stop the save; warnings need a second click ("Log anyway"). Each is { field, text }.
 */
export function checkEntry(entry, { today, entries = [], client = null } = {}) {
  const errors = [], warnings = [];
  const h = entry.hours;
  if (!entry.clientId) errors.push({ field: 'client', text: 'Choose the client.' });
  if (!entry.engineer) errors.push({ field: 'engineer', text: 'Choose who did the work.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day(entry.date))) errors.push({ field: 'date', text: 'Choose the date of the work.' });
  if (!h || !h.ok) {
    errors.push({ field: 'hours', text: h?.reason === 'zero' ? 'Time must be at least 15 minutes.'
      : h?.reason === 'empty' || !h ? 'Enter the time spent, e.g. 1.5, 1:30 or 45m.' : 'Time not recognised. Try 1.5, 1:30, 1h30 or 45m.' });
  } else if (h.hours > MAX_ENTRY_HOURS) {
    errors.push({ field: 'hours', text: `${fmtHours(h.hours)} in one entry is more than ${MAX_ENTRY_HOURS}h. Split it by day.` });
  }
  if (!String(entry.description || '').trim()) errors.push({ field: 'desc', text: 'Add a short description of the work.' });
  if (errors.length) return { errors, warnings };

  const date = day(entry.date);
  if (date > today) warnings.push({ field: 'date', text: `The date is in the future (${date}).` });
  else if (daysBetween(date, today) > OLD_DAYS) warnings.push({ field: 'date', text: `The date is ${daysBetween(date, today)} days ago.` });
  if (dow(date) === 0 || dow(date) === 6) warnings.push({ field: 'date', text: 'The date is a weekend.' });

  const same = entries.filter(e => day(e.date) === date && e.engineer === entry.engineer);
  const dupe = same.find(e => e.clientName === entry.clientName && Math.abs(Number(e.hours) - h.hours) < 1e-9
    && (norm(described(e)) === norm(entry.description) || !norm(described(e))));
  if (dupe) warnings.push({ field: 'desc', text: `${entry.engineer} already logged ${fmtHours(h.hours)} for ${entry.clientName} on this day${described(dupe) ? ` (“${described(dupe)}”)` : ''}. Is this a duplicate?` });

  const dayTotal = round2(same.reduce((t, e) => t + (Number(e.hours) || 0), 0) + h.hours);
  if (dayTotal > LONG_DAY_HOURS) warnings.push({ field: 'hours', text: `This makes ${fmtHours(dayTotal)} for ${entry.engineer} on this day.` });

  const bal = balancePreview(client, h.hours);
  if (bal && bal.after < 0) warnings.push({ field: 'hours', text: `${entry.clientName} goes ${fmtHours(-bal.after)} over their SSA hours. Consider a renewal.` });
  return { errors, warnings };
}

/** The engineer's clients from the last 45 days, most used first. */
export function recentClients(entries, engineer, today, { days = 45, limit = 6 } = {}) {
  const since = addDays(today, -days);
  const counts = new Map();
  for (const e of entries) {
    if (e.engineer !== engineer || day(e.date) < since || !e.clientName) continue;
    counts.set(e.clientName, (counts.get(e.clientName) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([n]) => n);
}

/**
 * What was logged for this client before, newest first: descriptions to suggest (distinct) and the
 * work type last used, so a repeat job takes one tap.
 */
export function clientHistory(entries, clientName, { limit = 8 } = {}) {
  const mine = entries.filter(e => e.clientName === clientName)
    .sort((a, b) => day(b.date).localeCompare(day(a.date)) || String(b.id).localeCompare(String(a.id)));
  const seen = new Set(), descriptions = [];
  for (const e of mine) {
    const d = described(e);
    if (!d || seen.has(norm(d))) continue;
    seen.add(norm(d)); descriptions.push(d);
    if (descriptions.length >= limit) break;
  }
  return { descriptions, workType: mine.find(e => e.workType)?.workType || '' };
}

/** Total hours an engineer has logged on a date. */
export function dayTotal(entries, engineer, date) {
  return round2(entries.filter(e => e.engineer === engineer && day(e.date) === day(date)).reduce((t, e) => t + (Number(e.hours) || 0), 0));
}
