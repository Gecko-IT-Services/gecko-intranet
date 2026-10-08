/* Overview: pure logic (no window). Tested in tests/overview.mjs.
   Design: docs/superpowers/specs/2026-10-08-overview-design.md

   The landing page answers three questions (Philip, 8 Oct): how is the money doing, what needs
   me, and what is happening this week. Everything here is read from data other sections already
   keep; nothing is written. */

import { OPEN_STAGES, xeroMonthSales, xeroHistory, owed, refKey } from './jobs.js';

export { xeroHistory };

export const LOW_SSA_HOURS = 2;       // the Timesheets "at risk" line
export const STALE_SYNC_HOURS = 3;    // the sync runs hourly; three missed runs is worth saying
export const QUIET_PROPOSAL_DAYS = 14;
const DRAFTS = new Set(['DRAFT', 'SUBMITTED']);

import { dueFollowUps, dueText } from './activity.js';
import { dealState } from './opportunities.js';
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
const sum = (list, f) => round2(list.reduce((t, x) => t + f(x), 0));
const day = d => String(d || '').slice(0, 10);

/** 'YYYY-MM-DD' plus n days (UTC arithmetic on a date key, so no clock or zone surprises). */
export function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday and Sunday of the week `today` is in. */
export function weekOf(today) {
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();   // 0 = Sunday
  const start = addDays(today, -(dow === 0 ? 6 : dow - 1));
  return { start, end: addDays(start, 6) };
}

/**
 * The money tiles. Needs Xero (`inv`, `rep` as the Jobs section loads them); without it the
 * caller shows why, never zeros.
 * - sales: this month as Jobs › Month overview has it (invoiced, still to come, projected)
 * - recurring: billed from repeating invoices this month (raised + still to come) against
 *   what was raised from them last month
 * - owed: amount due incl. VAT, and how much of it is overdue
 * - pipeline: open jobs (quoted → to invoice) and proposals out (opportunities)
 */
export function money({ inv = [], rep = [], jobs = [], opps = [] }, today) {
  const month = today.slice(0, 7);
  const sales = xeroMonthSales(inv, rep, jobs, { month });
  const [, last] = xeroHistory(inv, { month, n: 3 });
  const thisRecurring = round2(sales.recurring + sales.toCome);
  const open = jobs.filter(j => OPEN_STAGES.has(j.status));
  const proposed = opps.filter(o => o.status === 'proposed');
  return {
    sales,
    recurring: {
      value: thisRecurring, raised: sales.recurring, toCome: sales.toCome,
      last: last.recurring, lastMonth: last.month, change: last.has ? round2(thisRecurring - last.recurring) : null
    },
    owed: owed(inv, today),
    pipeline: {
      value: sum(open, j => num(j.value)), count: open.length,
      quoted: sum(open.filter(j => j.status === 'quoted'), j => num(j.value)),
      proposals: proposed.length, proposalMrr: sum(proposed, o => num(o.mrr)), proposalOneOff: sum(proposed, o => num(o.one_off))
    }
  };
}

/**
 * What needs a person, most urgent first: [{ key, level: 'red'|'amber'|'info', title, detail, go }].
 * `go` is { section, tab? } for the button. Inputs are optional: a source that didn't load is
 * left out here and reported by the caller.
 *   xero      public.xero_status row (null = Xero not set up yet)
 *   inv, rep  as money()
 *   jobs, opps, leave ([{ person, start, end, status, type }]),
 *   ssa ([{ name, remaining, archived }]), journeys ([{ date, amount, claimedDate }])
 */
export function attention(d, today, now = new Date()) {
  const out = [];
  const add = (key, level, title, detail, go) => out.push({ key, level, title, detail, go });
  const names = (list, n = 3) => list.slice(0, n).join(', ') + (list.length > n ? ` + ${list.length - n} more` : '');
  const money2 = v => '£' + round2(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

  const x = d.xero;
  if (x && !x.connected) add('xero', 'red', 'Xero isn’t connected', 'Sales, invoices owed and job matching need it. Connect it on Jobs › Xero.', { section: 'jobs', tab: 'xero' });
  else if (x && x.last_sync_ok === false) add('xero', 'red', 'The last Xero sync failed', x.last_error || 'Open Jobs › Xero and press Sync now.', { section: 'jobs', tab: 'xero' });
  else if (x && x.last_sync_at && (now - new Date(x.last_sync_at)) > STALE_SYNC_HOURS * 3600e3) {
    const h = Math.floor((now - new Date(x.last_sync_at)) / 3600e3);
    add('xero', 'amber', `Xero last synced ${h} hours ago`, 'It normally syncs every hour. Figures may be out of date.', { section: 'jobs', tab: 'xero' });
  }

  if (d.inv) {
    const o = owed(d.inv, today);
    if (o.overdue > 0) {
      const late = d.inv.filter(i => i.status === 'AUTHORISED' && num(i.amount_due) > 0 && i.due_date && String(i.due_date) < today);
      const who = o.rows.filter(r => r.overdue > 0).map(r => `${r.name} ${money2(r.overdue)}`);
      add('overdue', 'red', `${money2(o.overdue)} overdue`, `${plural(late.length, 'invoice')} · ${names(who)}`, { section: 'jobs', tab: 'owed' });
    }
    const jobRefs = new Set((d.jobs || []).flatMap(j => String(j.invoice_ref || '').split(/[,;]+/).map(refKey).filter(Boolean)));
    const drafts = d.inv.filter(i => DRAFTS.has(i.status));
    if (drafts.length) {
      const fromJobs = drafts.filter(i => jobRefs.has(refKey(i.invoice_number))).length;
      add('drafts', 'amber', `${plural(drafts.length, 'draft invoice')} waiting in Xero`,
        `${names(drafts.map(i => `${i.invoice_number || 'no number'} ${i.contact_name || ''}`.trim()))}${fromJobs ? ` · ${fromJobs} from jobs` : ''}. Approve and send in Xero.`,
        { section: 'jobs', tab: 'overview' });
    }
  }

  if (d.jobs) {
    // With Xero, a job whose approved invoices already cover it isn't "to invoice" any more.
    const toInvoice = d.inv ? xeroMonthSales(d.inv, d.rep || [], d.jobs, { month: today.slice(0, 7) }).toInvoiceJobs
      : d.jobs.filter(j => j.status === 'to_invoice').map(j => ({ ...j, left: num(j.value) }));
    if (toInvoice.length) add('to_invoice', 'amber', `${plural(toInvoice.length, 'job')} ready to invoice · ${money2(sum(toInvoice, j => j.left))}`,
      names(toInvoice.map(j => `${j.client_name}: ${j.title}`)), { section: 'jobs', tab: 'jobs' });
    const late = d.jobs.filter(j => (j.status === 'agreed' || j.status === 'in_progress') && j.target_date && day(j.target_date) < today);
    if (late.length) add('late_jobs', 'amber', `${plural(late.length, 'job')} past its target date`,
      names(late.map(j => `${j.client_name}: ${j.title}`)), { section: 'jobs', tab: 'jobs' });
  }

  if (d.followUps) {
    // Client follow-ups due (client page › Activity): one line each, oldest first; overdue by a week is red.
    const due = dueFollowUps(d.followUps, today);
    for (const f of due.slice(0, 5)) {
      add('follow_up', f.late > 7 ? 'red' : 'amber', `Follow up ${f.client_name}${f.late ? ` (${dueText(f.follow_up_on, today)})` : ' today'}`,
        `${f.body}${f.contact_name ? ` · with ${f.contact_name}` : ''}`, { section: 'client', tab: 'activity', client: f.client_name });
    }
    if (due.length > 5) add('follow_up_more', 'amber', `${plural(due.length - 5, 'more follow-up')} due`,
      names(due.slice(5).map(f => f.client_name)), { section: 'client', tab: 'activity', client: due[5].client_name });
  }

  if (d.opps) {
    // Sharper pipeline: deal follow-ups due, won deals still to set up (job / monthly billing), quiet deals.
    const st = d.opps.map(o => ({ o, s: dealState(o, today) }));
    const due = st.filter(x => x.s.followUpDue).sort((a, b) => b.s.followUpLate - a.s.followUpLate);
    for (const { o, s } of due.slice(0, 5)) add('deal_follow_up', s.followUpLate > 7 ? 'red' : 'amber',
      `Chase ${o.client_name}: ${o.title}${s.followUpLate ? ` (${dueText(o.follow_up_on, today)})` : ' today'}`, o.next_step || 'Follow-up date reached on the pipeline.', { section: 'opportunities', tab: 'pipeline' });
    if (due.length > 5) add('deal_follow_up_more', 'amber', `${plural(due.length - 5, 'more deal follow-up')} due`, names(due.slice(5).map(x => x.o.client_name)), { section: 'opportunities', tab: 'pipeline' });
    const since = new Date(Date.parse(today + 'T00:00:00Z') - 60 * 86400000).toISOString().slice(0, 10);
    const setup = st.filter(x => (x.s.needsJob || x.s.needsBilling) && day(x.o.closed_at || x.o.modified_at) >= since);
    if (setup.length) add('deal_setup', 'amber', `${plural(setup.length, 'won deal')} to set up`,
      names(setup.map(x => `${x.o.client_name}: ${[x.s.needsJob && 'job', x.s.needsBilling && 'monthly billing'].filter(Boolean).join(' + ')}`)), { section: 'opportunities', tab: 'pipeline' });
    const quiet = st.filter(x => x.s.stale);
    if (quiet.length) add('deal_quiet', 'info', `${plural(quiet.length, 'deal')} quiet for 2+ weeks`, names(quiet.map(x => `${x.o.client_name}: ${x.o.title}`)), { section: 'opportunities', tab: 'pipeline' });
  }

  if (d.ssa) {
    const low = d.ssa.filter(c => !c.archived && c.remaining != null && c.remaining < LOW_SSA_HOURS).sort((a, b) => a.remaining - b.remaining);
    if (low.length) add('ssa', low.some(c => c.remaining <= 0) ? 'red' : 'amber', `${plural(low.length, 'SSA client')} low on hours`,
      names(low.map(c => `${c.name} ${round2(c.remaining)}h`)) + '. Renew from Timesheets › SSA.', { section: 'timesheets', tab: 'ssa' });
  }

  if (d.leave) {
    const pending = d.leave.filter(l => l.status === 'Pending' && day(l.end || l.start) >= today);
    if (pending.length) add('leave', 'amber', `${plural(pending.length, 'leave request')} to approve`,
      names(pending.map(l => `${l.person} ${shortRange(l.start, l.end)}`)), { section: 'leave' });
  }

  if (d.journeys) {
    const month = today.slice(0, 7);
    const old = d.journeys.filter(j => j.date && !j.claimedDate && j.date.slice(0, 7) < month);
    if (old.length) add('mileage', 'info', `${money2(sum(old, j => num(j.amount)))} mileage not yet claimed`,
      `${plural(old.length, 'journey')} from before this month. Send it from Mileage › Email my claim.`, { section: 'mileage' });
  }

  if (d.opps) {
    const since = addDays(today, -QUIET_PROPOSAL_DAYS);
    const quiet = d.opps.filter(o => o.status === 'proposed' && day(o.modified_at || o.created_at) < since);
    if (quiet.length) add('proposals', 'info', `${plural(quiet.length, 'proposal')} with no update for ${QUIET_PROPOSAL_DAYS} days`,
      names(quiet.map(o => `${o.client_name}: ${o.title}`)), { section: 'opportunities' });
  }

  const rank = { red: 0, amber: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/**
 * This week and the fortnight ahead.
 * - away: leave (approved or pending) overlapping today → +13 days, soonest first
 * - jobsDue: agreed / in-progress jobs with a target date this week (Mon–Sun), or late
 * - goingOut: repeating invoices Xero raises in the next 7 days
 * - hours: time logged this week per engineer (Philip, Jack) and in total
 */
export function thisWeek({ leave = [], jobs = [], inv = null, rep = null, entries = [] }, today) {
  const { start, end } = weekOf(today);
  const horizon = addDays(today, 13);
  const away = leave
    .filter(l => l.status !== 'Rejected' && l.status !== 'Cancelled' && l.start && day(l.start) <= horizon && day(l.end || l.start) >= today)
    .map(l => ({ ...l, now: day(l.start) <= today }))
    .sort((a, b) => day(a.start).localeCompare(day(b.start)));
  const jobsDue = jobs.filter(j => (j.status === 'agreed' || j.status === 'in_progress') && j.target_date && day(j.target_date) <= end)
    .sort((a, b) => day(a.target_date).localeCompare(day(b.target_date)));
  let goingOut = null;
  if (inv && rep) {
    const week = addDays(today, 6);
    const months = [...new Set([today.slice(0, 7), week.slice(0, 7)])];
    const list = months.flatMap(m => xeroMonthSales([], rep, [], { month: m }).recurringToCome)
      .filter(r => r.date >= today && r.date <= week);
    goingOut = { count: list.length, value: sum(list, r => r.amount), list };
  }
  const byEng = {};
  let total = 0;
  for (const e of entries) {
    if (!e.date || e.date < start || e.date > end) continue;
    if (e.engineer !== 'Philip' && e.engineer !== 'Jack') continue;
    byEng[e.engineer] = round2((byEng[e.engineer] || 0) + num(e.hours));
    total = round2(total + num(e.hours));
  }
  return { start, end, away, jobsDue, goingOut, hours: { total, byEng } };
}

/** "12 Oct" or "12–14 Oct" or "30 Oct – 2 Nov". */
export function shortRange(a, b) {
  const f = (k, month = true) => {
    const d = new Date(day(k) + 'T00:00:00Z');
    return month ? `${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}` : String(d.getUTCDate());
  };
  if (!a) return '';
  if (!b || day(b) === day(a)) return f(a);
  return day(a).slice(0, 7) === day(b).slice(0, 7) ? `${f(a, false)}–${f(b)}` : `${f(a)} – ${f(b)}`;
}
