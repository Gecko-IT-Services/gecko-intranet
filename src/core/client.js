/* Client page: pure logic (no window). Tested in tests/client.mjs.
   Design: docs/superpowers/specs/2026-10-09-gecko-hq-structure-design.md

   One client, everything Gecko knows about them, from every section: Xero invoices, service
   lines, SSA hours and timesheets, jobs, opportunities, VoIP Unlimited dealer services. */

import { owed, previousMonth, monthOf } from './jobs.js';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
const COUNTED = new Set(['AUTHORISED', 'PAID']);

/**
 * The same client under the names each system uses ("Kingdom Products Ltd" in Xero,
 * "Kingdom Products" in Clients): lower case, no company suffix, letters and digits only.
 */
export function clientKey(name) {
  return String(name || '').toLowerCase().replace(/&/g, 'and')
    .replace(/\b(ltd|limited|plc|llp|uk|the)\b/g, '').replace(/[^a-z0-9]/g, '');
}

/** Same client? Exact key, or one name is the other plus more words ("ALS" never matches "ALS Locksmiths" below 5 letters). */
export function sameClient(a, b) {
  const x = clientKey(a), y = clientKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && long.startsWith(short);
}

/** Last `n` months ending with `month`, oldest first. */
export function monthsTo(month, n) {
  const out = [month];
  while (out.length < n) out.unshift(previousMonth(out[0]));
  return out;
}

/**
 * Everything for one client's page. Inputs are whatever loaded (a missing source is null and
 * its part of the page says so):
 *   name, gecko ({ status, contract_start, notes }), services ([{ title, category, cost_per_month, sell_per_month }]),
 *   invoices (Xero, any contacts: filtered here), ssa ({ purchased, used, remaining, archived, contact, email }),
 *   entries (timesheet entries for this SSA client), jobs, opps, dealer, domains (all for any client: filtered here)
 */
export function clientProfile(d, today) {
  const name = d.name;
  const mine = list => (list || []).filter(x => sameClient(x.client_name, name));
  const month = today.slice(0, 7);
  const months = monthsTo(month, 12);

  // Xero: everything billed to this client's contact(s)
  let xero = null;
  if (d.invoices) {
    const inv = d.invoices.filter(i => sameClient(i.contact_name, name));
    const history = months.map(m => {
      let recurring = 0, oneOff = 0;
      for (const i of inv) {
        if (monthOf(i.invoice_date) !== m || !COUNTED.has(i.status)) continue;
        if (String(i.repeating_invoice_id || '').trim()) recurring += num(i.sub_total); else oneOff += num(i.sub_total);
      }
      return { month: m, recurring: round2(recurring), oneOff: round2(oneOff), total: round2(recurring + oneOff) };
    });
    // This month once its repeating invoices are raised, else the last full month.
    const cur = history[history.length - 1];
    const last = cur.recurring > 0 ? cur : history[history.length - 2];
    const o = owed(inv, today);
    xero = {
      contacts: [...new Set(inv.map(i => i.contact_name))],
      history,
      lastMonth: last,
      recurringMonthly: last.recurring,   // lastMonth says which month it is
      year: round2(history.reduce((t, h) => t + h.total, 0)),
      owed: o.total, overdue: o.overdue, unpaid: inv.filter(i => i.status === 'AUTHORISED' && num(i.amount_due) > 0)
        .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))),
      recent: inv.filter(i => i.status !== 'DELETED' && i.status !== 'VOIDED')
        .sort((a, b) => String(b.invoice_date || '').localeCompare(String(a.invoice_date || ''))).slice(0, 12)
    };
  }

  // Service lines (typed on Profitability): what they buy and what it costs Gecko
  let services = null;
  if (d.services) {
    const lines = d.services.filter(s => sameClient(s.client_name ?? s.ClientName, name)).map(s => {
      const sell = num(s.sell_per_month), cost = num(s.cost_per_month);
      return { title: s.title || '', category: s.category || 'other', sell, cost, margin: round2(sell - cost) };
    }).sort((a, b) => b.sell - a.sell);
    const sell = round2(lines.reduce((t, l) => t + l.sell, 0)), cost = round2(lines.reduce((t, l) => t + l.cost, 0));
    services = { lines, sell, cost, margin: round2(sell - cost), pct: sell > 0 ? (sell - cost) / sell : null };
  }

  // SSA: prepaid hours and the work logged against them
  let support = null;
  if (d.ssa) {
    const entries = (d.entries || []).filter(e => !e.deleted_at)
      .sort((a, b) => String(b.entry_date || '').localeCompare(String(a.entry_date || '')));
    const work = entries.filter(e => e.engineer !== 'System');
    const since = new Date(today + 'T00:00:00Z'); since.setUTCDate(since.getUTCDate() - 90);
    const last90 = round2(work.filter(e => String(e.entry_date || '') >= since.toISOString().slice(0, 10)).reduce((t, e) => t + num(e.hours), 0));
    const perMonth = monthsTo(month, 6).map(m => ({ month: m, hours: round2(work.filter(e => monthOf(e.entry_date) === m).reduce((t, e) => t + num(e.hours), 0)) }));
    const rate = last90 / 3;   // hours a month, recently
    support = {
      ...d.ssa, last90, perMonth, recent: entries.slice(0, 15),
      monthsLeft: rate > 0 && d.ssa.remaining > 0 ? Math.round((d.ssa.remaining / rate) * 10) / 10 : null
    };
  }

  const jobs = d.jobs ? mine(d.jobs) : null;
  const opps = d.opps ? mine(d.opps) : null;
  const dealer = d.dealer ? mine(d.dealer) : null;
  const domains = d.domains ? [...new Set(mine(d.domains).map(x => x.domain))] : null;

  // What needs doing for this client, most urgent first (the Summary list)
  const flags = [];
  if (xero?.overdue > 0) flags.push({ level: 'red', text: `£${xero.overdue.toFixed(2)} overdue`, tab: 'invoices' });
  if (support && !support.archived && support.remaining != null && support.remaining < 2)
    flags.push({ level: support.remaining <= 0 ? 'red' : 'amber', text: `${support.remaining}h of prepaid support left`, tab: 'support' });
  const toInvoice = (jobs || []).filter(j => j.status === 'to_invoice');
  if (toInvoice.length) flags.push({ level: 'amber', text: `${toInvoice.length} job${toInvoice.length === 1 ? '' : 's'} ready to invoice`, tab: 'jobs' });
  const late = (jobs || []).filter(j => (j.status === 'agreed' || j.status === 'in_progress') && j.target_date && String(j.target_date) < today);
  if (late.length) flags.push({ level: 'amber', text: `${late.length} job${late.length === 1 ? '' : 's'} past target date`, tab: 'jobs' });
  const proposed = (opps || []).filter(o => o.status === 'proposed');
  if (proposed.length) flags.push({ level: 'info', text: `${proposed.length} proposal${proposed.length === 1 ? '' : 's'} out`, tab: 'opportunities' });

  return {
    name, gecko: d.gecko || null, xero, services, support, jobs, opps, dealer, domains, flags,
    openJobs: jobs ? jobs.filter(j => ['quoted', 'agreed', 'in_progress', 'to_invoice'].includes(j.status)) : null,
    openOpps: opps ? opps.filter(o => o.status === 'idea' || o.status === 'proposed') : null
  };
}
