/* Not on this morning (Philip, 19 Oct 2026): PCs that are normally on every working day but haven't checked in with Atera
   today, and servers that have gone offline, each with the likely reasons from what Atera last knew about it. A PC that can't
   start (Kelly's PC at Daron, blue screen INACCESSIBLE_BOOT_DEVICE) can't raise an alert itself, so its silence is the alert.
   Pure: no window. Tests: tests/offline.mjs. Design: docs/superpowers/specs/2026-10-19-not-on-this-morning-design.md */

import { isServer } from './devices.js';

// ponytail: England and Wales bank holidays typed in for 2026–27; add the next year's from gov.uk/bank-holidays.
export const BANK_HOLIDAYS = new Set([
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28'
]);
export const LEARN_DAYS = 5;          // working days of record before "usually on" is judged from the record
export const USUAL_SHARE = 0.8;       // on for at least 4 in 5 of the recent working days = usually on
export const DEFAULT_BY = 9 * 60 + 30; // 09:30: by when a PC is expected on, until its own usual time is known
export const SERVER_QUIET_MINS = 60;

const DAY = 86400000;
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** An instant in UK time: { day: 'YYYY-MM-DD', mins: minutes after midnight }. */
export function uk(iso) {
  const t = new Date(iso);
  if (!iso || Number.isNaN(t.getTime())) return null;
  const p = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute) };
}
const dow = day => new Date(day + 'T12:00:00Z').getUTCDay();
const addDays = (day, n) => new Date(new Date(day + 'T12:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10);
export const isWorkingDay = day => dow(day) >= 1 && dow(day) <= 5 && !BANK_HOLIDAYS.has(day);
export function prevWorkingDay(day) { let d = addDays(day, -1); while (!isWorkingDay(d)) d = addDays(d, -1); return d; }
/** Microsoft's Patch Tuesday (second Tuesday) of the month `YYYY-MM`. */
export function patchTuesday(month) {
  const first = month + '-01';
  return addDays(first, ((2 - dow(first) + 7) % 7) + 7);
}
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayName = day => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const person = u => String(u || '').split(',')[0].split(/[\\/]/).pop().replace(/\s*\(.*$/, '').trim().replace(/([a-z])([A-Z])/g, '$1 $2');
// Shared logins aren't a person to ask after.
const SHARED = /^(office|pc|admin|administrator|user|owner|workshop|reception|accounts|sales|despatch|warranty|staff|.*user)$/i;
const isLaptop = a => !!a.battery || /laptop|lptp|book/i.test(`${a.machine_name || ''} ${a.model || ''}`);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

// Most telling first: the whole site quiet, a full disk, updates left waiting, gone at an odd time; then the weaker ones.
const RANK = { site: 0, disk: 1, pending: 2, midday: 3, updates: 4, age: 5, laptop: 6, off: 7, agent: 8 };

/**
 * The likely reasons, most telling first, from what Atera last knew. a: an atera_agents row with disks, bios, reboot, battery
 * picked out of raw; last: uk(a.last_seen); siteQuiet: nothing else at that client has checked in today.
 */
export function reasons(a, { last, siteQuiet, others = 0 }) {
  const out = [];
  const user = SHARED.test(person(a.last_user)) ? '' : person(a.last_user);
  if (siteQuiet && others > 0) out.push({ key: 'site', text: `Nothing else at ${a.customer_name} has checked in today either: a power cut, the internet being down or the office being shut would explain it.` });
  if (last) {
    const months = [last.day.slice(0, 7), addDays(last.day.slice(0, 7) + '-01', -1).slice(0, 7)];
    const pt = months.map(patchTuesday).find(d => d <= last.day && (new Date(last.day) - new Date(d)) / DAY <= 10);
    if (pt) {
      const rb = uk(a.reboot);
      const pending = !rb || rb.day < pt;
      out.push({ key: pending ? 'pending' : 'updates', text: pending
        ? `Windows updates came out on ${dayName(pt)} and it hadn't restarted since, so they were waiting to install when it was shut down. An update that goes wrong at that point can stop Windows starting (a blue screen such as INACCESSIBLE_BOOT_DEVICE, or "Automatic Repair").`
        : `It restarted for this month's Windows updates on ${dayName(rb.day)} (they came out ${dayName(pt)}). The rest of an update often finishes at shut-down, and if that goes wrong Windows can't start (a blue screen such as INACCESSIBLE_BOOT_DEVICE, or "Automatic Repair").` });
    }
  }
  const c = (Array.isArray(a.disks) ? a.disks : []).find(d => /^c:?$/i.test(String(d.Drive || '').trim())) || (Array.isArray(a.disks) ? a.disks[0] : null);
  if (c && Number(c.Total) > 0) {
    const freeGb = Number(c.Free) / 1024, pct = Number(c.Free) / Number(c.Total);
    if (pct < 0.1 || freeGb < 15) out.push({ key: 'disk', text: `Its C: drive was nearly full (${freeGb.toFixed(0)} GB free). Updates fail and Windows can refuse to start without room to work.` });
  }
  if (last && isWorkingDay(last.day) && last.mins >= 9 * 60 && last.mins < 15 * 60)
    out.push({ key: 'midday', text: `It went quiet at ${hhmm(last.mins)} on ${dayName(last.day)}, not at going-home time: it may have crashed, lost power or been unplugged (or ${user || 'its user'} left early).` });
  const bios = Number(String(a.bios || '').slice(0, 4));
  if (bios && bios <= new Date().getFullYear() - 6) out.push({ key: 'age', text: `It dates from about ${bios}. At that age a failed drive or power supply is more likely.` });
  if (isLaptop(a)) {
    const h = Number(a.battery?.BatteryHealth);
    out.push({ key: 'laptop', text: `It's a laptop: it may be at home, closed in a bag or on another network.${h && h < 60 ? ` Its battery was down to ${h}% health, so it may also be flat.` : ''}` });
  }
  out.push({ key: 'off', text: `Or it's simply switched off${user ? `: is ${user} in today?` : '.'}` });
  out.push({ key: 'agent', text: 'If it is on and working, Atera’s agent has stopped: restart the AteraAgent service on it (or restart the PC).' });
  return out.sort((x, y) => RANK[x.key] - RANK[y.key]);
}

/**
 * Who should be on and isn't, as of the last sync.
 * agents: atera_agents rows (+ disks, bios, reboot, battery). seenDays: atera_seen_days rows. hidden: device_offline_ok rows.
 * → { state: 'unknown'|'closed'|'early'|'checked', asOf, learning, learnUntil, items: [{ level, agent, customer, machine, user,
 *     lastSeen, server, laptop, usual, expectedBy, reasons }], hidden: n }
 */
export function notOnYet({ agents = [], seenDays = [], hidden = [], syncedAt }) {
  const asOf = uk(syncedAt);
  if (!asOf) return { state: 'unknown', items: [], hidden: 0 };
  const now = new Date(syncedAt).getTime();
  const skip = new Map(hidden.filter(h => h.until >= asOf.day).map(h => [Number(h.agent_id), h]));
  const hist = new Map();
  for (const r of seenDays) {
    const m = hist.get(Number(r.agent_id)) || new Map();
    m.set(r.day, r);
    hist.set(Number(r.agent_id), m);
  }
  // Days the record covers fully: a day with far fewer devices than usual (the day recording began, a day the syncs failed)
  // would make everyone look absent, so it doesn't count.
  const perDay = new Map();
  for (const r of seenDays) perDay.set(r.day, (perDay.get(r.day) || 0) + 1);
  const busiest = Math.max(0, ...perDay.values());
  const recorded = [...perDay.keys()].filter(d => d < asOf.day && isWorkingDay(d) && perDay.get(d) >= busiest / 2).sort();
  const learning = recorded.length < LEARN_DAYS;
  let learnUntil = asOf.day;
  for (let need = LEARN_DAYS - recorded.length; need > 0;) { learnUntil = addDays(learnUntil, 1); if (isWorkingDay(learnUntil)) need--; }
  const seenToday = a => uk(a.last_seen)?.day === asOf.day;
  const byClient = new Map();
  for (const a of agents) byClient.set(a.customer_name, [...(byClient.get(a.customer_name) || []), a]);

  const items = [];
  let hiddenCount = 0;
  const working = isWorkingDay(asOf.day);
  for (const a of agents) {
    const last = uk(a.last_seen);
    const server = isServer(a);
    const mates = (byClient.get(a.customer_name) || []).filter(x => x !== a);
    const siteQuiet = !mates.some(seenToday);
    if (server) {
      if (a.online !== false || !a.last_seen || now - new Date(a.last_seen).getTime() < SERVER_QUIET_MINS * 60000) continue;
      if (skip.has(Number(a.agent_id))) { hiddenCount++; continue; }
      items.push(row(a, 'red', { server: true, last, reasons: [
        ...(siteQuiet && mates.length ? [{ key: 'site', text: `Nothing else at ${a.customer_name} is checking in either: power, the internet or the router.` }] : []),
        { key: 'server', text: 'A server going quiet is never normal: it may have crashed, be stuck restarting for updates, or lost power or network.' },
        { key: 'agent', text: 'If people can still reach it, Atera’s agent has stopped: restart the AteraAgent service on it.' }] }));
      continue;
    }
    if (!working || a.online === true || !last || last.day >= asOf.day) continue;
    const h = hist.get(Number(a.agent_id)) || new Map();
    const recent = recorded.slice(-10);
    const prev = prevWorkingDay(asOf.day);
    const usual = learning ? (last.day === prev || h.has(prev))
      : recent.filter(d => h.has(d) || last.day === d).length / recent.length >= USUAL_SHARE;
    const laptop = isLaptop(a);
    if (!usual || (learning && laptop)) continue;   // laptops come and go: only once the record shows one is on every day
    const firsts = recent.map(d => h.get(d)).filter(Boolean).map(r => uk(r.first_seen)?.mins).filter(m => m != null && m > 5 * 60);
    const own = firsts.length >= 3 ? median(firsts) + 45 : null;
    const expectedBy = own == null ? DEFAULT_BY : Math.max(9 * 60, Math.min(own, 12 * 60));
    if (asOf.mins < expectedBy) continue;
    if (skip.has(Number(a.agent_id))) { hiddenCount++; continue; }
    items.push(row(a, learning || laptop ? 'amber' : 'red', { last, laptop, usual: learning ? 'on last working day' : 'on most days', expectedBy: hhmm(expectedBy),
      reasons: reasons(a, { last, siteQuiet, others: mates.length }) }));
  }
  const rank = { red: 0, amber: 1 };
  items.sort((x, y) => rank[x.level] - rank[y.level] || Number(y.server) - Number(x.server) || Number(x.laptop) - Number(y.laptop)
    || x.customer.localeCompare(y.customer) || x.machine.localeCompare(y.machine));
  const early = working && asOf.mins < DEFAULT_BY && !items.some(i => !i.server);
  return { state: !working ? 'closed' : early ? 'early' : 'checked', asOf, learning, learnUntil, items, hidden: hiddenCount };
}

function row(a, level, extra) {
  return {
    level, agent: Number(a.agent_id), customer: a.customer_name || '', machine: a.machine_name || '', user: person(a.last_user),
    lastSeen: a.last_seen, url: a.url || '', server: false, laptop: false, usual: '', expectedBy: '', ...extra
  };
}
