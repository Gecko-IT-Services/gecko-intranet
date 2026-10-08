/* Month-end close and weekly review: pure logic (no window). Tested in tests/review.mjs.
   Design: docs/superpowers/specs/2026-10-09-gecko-hq-structure-design.md (stage 5)

   Philip, 9 Oct: month-end is done in the last working days of the month; a weekly review too.
   Each check ticks itself off from the data where it can; the two supplier checks Gecko does by
   hand (TD SYNNEX licences, Atera costs) are ticked by a person and saved (month_end_checks). */

import { xeroMonthSales, owed } from './jobs.js';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
const day = d => String(d || '').slice(0, 10);
const DRAFTS = new Set(['DRAFT', 'SUBMITTED']);
const gbp = n => '£' + round2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isWeekday = key => { const w = new Date(key + 'T00:00:00Z').getUTCDay(); return w !== 0 && w !== 6; };
const lastDay = month => { const [y, m] = month.split('-').map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

/** Weekdays from `today` to the end of its month, today included (bank holidays not known). */
export function workingDaysLeft(today) {
  let n = 0;
  for (let d = today; d <= lastDay(today.slice(0, 7)); d = addDays(d, 1)) if (isWeekday(d)) n++;
  return n;
}

/** Month-end shows up on Today in the last five working days. */
export const monthEndSoon = today => workingDaysLeft(today) <= 5;

/** The checks a person ticks (saved per month in month_end_checks). */
export const MANUAL = [
  { key: 'tdsynnex', label: 'TD SYNNEX licence check', detail: 'Licence invoice against what each client is billed in Xero (seats and SKUs).', go: 'profitability' },
  { key: 'atera', label: 'Atera cost check', detail: 'Atera bill (seats, Acronis, Webroot, Keeper) against what each client is billed.', go: 'profitability' }
];

/**
 * The month-end checklist for `today`'s month: [{ key, label, state: 'done' | 'todo' | 'check', detail, go, manual? }].
 * d: { inv, rep, jobs, journeys, ssa ([{ name, remaining, archived }]), leave ([{ person, start, end, status }]),
 *      entries ([{ engineer, date, hours }]), nudges ([{ contact_name, created_at }]), ticks ([{ item, done_by, done_at }]) }
 * A source that didn't load (null) gives a 'check' item saying so, never a tick.
 */
export function monthEnd(d, today) {
  const month = today.slice(0, 7);
  const items = [];
  const add = (key, label, state, detail, go) => items.push({ key, label, state, detail, go });
  const missing = (key, label, what, go) => add(key, label, 'check', `${what} didn’t load, so this can’t be checked.`, go);

  if (d.inv && d.rep) {
    const s = xeroMonthSales(d.inv, d.rep, d.jobs || [], { month });
    const left = s.recurringToCome;
    add('repeating', 'Repeating invoices raised', left.length ? 'todo' : 'done',
      left.length ? `${plural(left.length, 'repeating invoice')} still to go out this month (${gbp(s.toCome)}): ${left.slice(0, 3).map(r => r.name).join(', ')}${left.length > 3 ? '…' : ''}` : 'Every repeating invoice for this month has gone out.', 'jobs:tocome');
    const drafts = d.inv.filter(i => DRAFTS.has(i.status) && String(i.invoice_date || '').slice(0, 7) <= month);
    add('drafts', 'Draft invoices approved in Xero', drafts.length ? 'todo' : 'done',
      drafts.length ? `${plural(drafts.length, 'draft')} waiting: ${drafts.slice(0, 3).map(i => i.invoice_number || i.contact_name).join(', ')}` : 'No drafts waiting.', 'jobs:overview');
    const o = owed(d.inv, today);
    const late = o.rows.filter(r => r.overdue > 0);
    if (!d.nudges) missing('chased', 'Overdue invoices chased', 'The nudge log', 'jobs:owed');
    else {
      const since = addDays(today, -14);
      const recent = new Set(d.nudges.filter(n => day(n.created_at) >= since).map(n => n.contact_name));
      const notChased = late.filter(r => !recent.has(r.name));
      add('chased', 'Overdue invoices chased', notChased.length ? 'todo' : 'done',
        !late.length ? 'Nothing overdue.' : notChased.length ? `${plural(notChased.length, 'client')} overdue and not nudged in the last two weeks: ${notChased.slice(0, 3).map(r => `${r.name} ${gbp(r.overdue)}`).join(', ')}`
          : late.length === 1 ? 'The overdue client was nudged in the last two weeks.' : `All ${late.length} overdue clients nudged in the last two weeks.`, 'jobs:owed');
    }
  } else {
    missing('repeating', 'Repeating invoices raised', 'Xero', 'jobs:xero');
    missing('drafts', 'Draft invoices approved in Xero', 'Xero', 'jobs:xero');
    missing('chased', 'Overdue invoices chased', 'Xero', 'jobs:xero');
  }

  if (d.jobs) {
    const done = d.jobs.filter(j => j.status === 'to_invoice');
    add('invoice_jobs', 'Finished jobs invoiced', done.length ? 'todo' : 'done',
      done.length ? `${plural(done.length, 'job')} ready to invoice: ${done.slice(0, 3).map(j => `${j.client_name}: ${j.title}`).join(', ')}` : 'No finished job is waiting for an invoice.', 'jobs:jobs');
    const due = d.jobs.filter(j => (j.status === 'agreed' || j.status === 'in_progress') && j.target_date && day(j.target_date) <= lastDay(month));
    add('job_dates', 'Job dates still right', due.length ? 'todo' : 'done',
      due.length ? `${plural(due.length, 'job')} due by month end and not finished: move it on or change its date.` : 'No open job is due by month end.', 'jobs:jobs');
  } else missing('invoice_jobs', 'Finished jobs invoiced', 'Jobs', 'jobs:jobs');

  if (d.journeys) {
    const open = d.journeys.filter(j => !j.claimedDate && j.date && j.date.slice(0, 7) <= month);
    add('mileage', 'Mileage claimed', open.length ? 'todo' : 'done',
      open.length ? `${plural(open.length, 'journey')} not claimed (${gbp(open.reduce((t, j) => t + num(j.amount), 0))}). Send it from Mileage › Email my claim.` : 'All mileage claimed.', 'mileage');
  } else missing('mileage', 'Mileage claimed', 'Mileage', 'mileage');

  if (d.ssa) {
    const low = d.ssa.filter(c => !c.archived && c.remaining != null && c.remaining < 2);
    add('ssa', 'SSA renewals sent', low.length ? 'todo' : 'done',
      low.length ? `${plural(low.length, 'client')} under 2 hours: ${low.slice(0, 3).map(c => `${c.name} ${round2(c.remaining)}h`).join(', ')}` : 'Every SSA client has 2 hours or more.', 'timesheets:ssa');
  } else missing('ssa', 'SSA renewals sent', 'SSA balances', 'timesheets:ssa');

  if (d.entries && d.leave) {
    const gaps = timesheetGaps(d.entries, d.leave, today);
    const n = Object.values(gaps).reduce((t, g) => t + g.length, 0);
    add('timesheets', 'Timesheets complete', n ? 'check' : 'done',
      n ? Object.entries(gaps).filter(([, g]) => g.length).map(([p, g]) => `${p}: nothing logged on ${plural(g.length, 'working day')}`).join(' · ') + ' (fine if there was no client work).' : 'Time logged on every working day this month.', 'timesheets:week');
  }

  if (d.leave) {
    const pending = d.leave.filter(l => l.status === 'Pending' && day(l.end || l.start) >= today);
    add('leave', 'Leave requests answered', pending.length ? 'todo' : 'done',
      pending.length ? `${plural(pending.length, 'request')} waiting for approval.` : 'No requests waiting.', 'leave');
  }

  const ticks = new Map((d.ticks || []).map(t => [t.item, t]));
  for (const m of MANUAL) {
    const t = ticks.get(m.key);
    items.push({ ...m, manual: true, state: t ? 'done' : 'todo', detail: t ? `Ticked by ${t.done_by || 'someone'} on ${day(t.done_at)}.` : m.detail });
  }

  const done = items.filter(i => i.state === 'done').length;
  return { month, daysLeft: workingDaysLeft(today), soon: monthEndSoon(today), items, done, total: items.length };
}

/** Weekdays this month up to today on which an engineer logged nothing and wasn't on leave. */
export function timesheetGaps(entries, leave, today, people = ['Philip', 'Jack']) {
  const month = today.slice(0, 7);
  const out = {};
  for (const p of people) {
    const logged = new Set(entries.filter(e => e.engineer === p).map(e => day(e.date ?? e.entry_date)));
    const off = d => leave.some(l => l.person === p && l.status === 'Approved' && day(l.start) <= d && day(l.end || l.start) >= d);
    const gaps = [];
    for (let d = `${month}-01`; d < today; d = addDays(d, 1)) if (isWeekday(d) && !logged.has(d) && !off(d)) gaps.push(d);
    out[p] = gaps;
  }
  return out;
}

/**
 * The weekly review for the week `today` is in (Monday–Sunday), compared with the week before.
 * d: { inv, jobs (with modified_at, invoiced_at), opps (created_at, closed_at), entries, nudges, leave }
 */
export function weekReview(d, today) {
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const start = addDays(today, -dow), end = addDays(start, 6);
  const prevStart = addDays(start, -7), prevEnd = addDays(start, -1);
  const inWeek = (x, a = start, b = end) => { const k = day(x); return k >= a && k <= b; };

  const hours = {};
  for (const p of ['Philip', 'Jack']) {
    const mine = (d.entries || []).filter(e => e.engineer === p);
    hours[p] = {
      week: round2(mine.filter(e => inWeek(e.date ?? e.entry_date)).reduce((t, e) => t + num(e.hours), 0)),
      last: round2(mine.filter(e => inWeek(e.date ?? e.entry_date, prevStart, prevEnd)).reduce((t, e) => t + num(e.hours), 0))
    };
  }
  let invoiced = null;
  if (d.inv) {
    const counted = d.inv.filter(i => ['AUTHORISED', 'PAID'].includes(i.status) && !/voip\s*unlimited/i.test(i.contact_name || ''));
    const wk = counted.filter(i => inWeek(i.invoice_date)), prev = counted.filter(i => inWeek(i.invoice_date, prevStart, prevEnd));
    invoiced = { week: round2(wk.reduce((t, i) => t + num(i.sub_total), 0)), last: round2(prev.reduce((t, i) => t + num(i.sub_total), 0)), count: wk.length,
      list: wk.sort((a, b) => num(b.sub_total) - num(a.sub_total)).slice(0, 6) };
  }
  const jobs = d.jobs ? {
    invoiced: d.jobs.filter(j => j.status === 'invoiced' && j.invoiced_at && inWeek(j.invoiced_at)),
    moved: d.jobs.filter(j => j.modified_at && inWeek(j.modified_at) && j.status !== 'invoiced'),
    added: d.jobs.filter(j => j.created_at && inWeek(j.created_at))
  } : null;
  const pipeline = d.opps ? {
    added: d.opps.filter(o => o.created_at && inWeek(o.created_at)),
    won: d.opps.filter(o => o.status === 'won' && o.closed_at && inWeek(o.closed_at)),
    lost: d.opps.filter(o => o.status === 'lost' && o.closed_at && inWeek(o.closed_at))
  } : null;
  if (pipeline) pipeline.wonMrr = round2(pipeline.won.reduce((t, o) => t + num(o.mrr), 0));
  const nudges = d.nudges ? d.nudges.filter(n => inWeek(n.created_at)) : null;
  const nextStart = addDays(end, 1), nextEnd = addDays(end, 7);
  const nextOff = d.leave ? d.leave.filter(l => (l.status === 'Approved' || l.status === 'Pending') && day(l.start) <= nextEnd && day(l.end || l.start) >= nextStart) : null;
  return { start, end, hours, invoiced, jobs, pipeline, nudges, nextOff };
}
