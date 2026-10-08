/* Jobs: pure logic (no window). Tested in tests/jobs.mjs.
   Design: docs/superpowers/specs/2026-10-08-jobs-design.md */

/** Stages in order. `lost` is a closed quote that didn't go ahead. */
export const STAGES = [
  ['quoted', 'Quoted'],
  ['agreed', 'Agreed'],
  ['in_progress', 'In progress'],
  ['to_invoice', 'To invoice'],
  ['invoiced', 'Invoiced'],
  ['lost', 'Lost']
];
export const OPEN_STAGES = new Set(['quoted', 'agreed', 'in_progress', 'to_invoice']);
export const stageLabel = k => (STAGES.find(([key]) => key === k) || [k, k])[1];

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
export const monthOf = d => String(d || '').slice(0, 7);

/** Count and £ value per stage: { quoted: { count, value }, … }. */
export function stageTotals(jobs) {
  const out = Object.fromEntries(STAGES.map(([k]) => [k, { count: 0, value: 0 }]));
  for (const j of jobs) {
    const s = out[j.status];
    if (!s) continue;
    s.count += 1;
    s.value = round2(s.value + num(j.value));
  }
  return out;
}

/**
 * This month's sales from the Xero feed, and what the month is on course for.
 * - invoiced: Xero invoices dated this month (recurring + one-off), per contact
 * - recurringToCome: contacts billed from a repeating invoice last month but
 *   not yet this month, at last month's amount (the repeating invoice not yet raised)
 * - toInvoice: jobs finished and waiting for an invoice
 * - dueThisMonth: jobs agreed / in progress with a target date this month
 * projected = invoiced + recurringToCome + toInvoice + dueThisMonth.
 * Contacts matching `exclude` (dealer commission) are kept out of client sales
 * but reported as `other`.
 */
export function monthSales(feed, jobs, { month, exclude = /voip\s*unlimited/i } = {}) {
  const months = feed?.xero?.months || {};
  const recurring = feed?.xero?.recurring || {};
  const prev = previousMonth(month);
  const thisMonth = months[month] || {};
  const recThis = recurring[month] || {};
  const recPrev = recurring[prev] || {};

  const rows = [];
  let invoiced = 0, rec = 0, other = 0;
  for (const [name, total] of Object.entries(thisMonth)) {
    if (exclude && exclude.test(name)) { other = round2(other + total); continue; }
    const r = Math.min(num(recThis[name]), num(total));
    rows.push({ name, total: round2(total), recurring: round2(r), oneOff: round2(num(total) - r) });
    invoiced = round2(invoiced + total);
    rec = round2(rec + r);
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const recurringToCome = Object.entries(recPrev)
    .filter(([name, v]) => !(exclude && exclude.test(name)) && num(v) > 0 && !(num(recThis[name]) > 0))
    .map(([name, v]) => ({ name, amount: round2(v) }))
    .sort((a, b) => b.amount - a.amount);
  const toCome = round2(recurringToCome.reduce((t, r) => t + r.amount, 0));

  const toInvoiceJobs = jobs.filter(j => j.status === 'to_invoice');
  const dueJobs = jobs.filter(j => (j.status === 'agreed' || j.status === 'in_progress') && monthOf(j.target_date) === month);
  const sum = list => round2(list.reduce((t, j) => t + num(j.value), 0));
  const toInvoice = sum(toInvoiceJobs), dueThisMonth = sum(dueJobs);

  return {
    month, hasXero: month in months, hasSplit: month in recurring,
    invoiced, recurring: rec, oneOff: round2(invoiced - rec), other,
    rows, recurringToCome, toCome, toInvoiceJobs, toInvoice, dueJobs, dueThisMonth,
    projected: round2(invoiced + toCome + toInvoice + dueThisMonth)
  };
}

/** Last `n` months of Xero sales, oldest first: [{ month, total, recurring, oneOff }]. */
export function salesHistory(feed, { month, n = 6, exclude = /voip\s*unlimited/i } = {}) {
  const out = [];
  let m = month;
  for (let i = 0; i < n; i++) {
    const per = feed?.xero?.months?.[m];
    const rec = feed?.xero?.recurring?.[m] || {};
    let total = 0, r = 0;
    for (const [name, v] of Object.entries(per || {})) {
      if (exclude && exclude.test(name)) continue;
      total += num(v);
      r += Math.min(num(rec[name]), num(v));
    }
    out.unshift({ month: m, total: round2(total), recurring: round2(r), oneOff: round2(total - r), has: !!per && total > 0 });
    m = previousMonth(m);
  }
  return out;
}

// ─── Xero, connected directly (public.xero_invoices / xero_repeating_invoices) ───
// Same rules as the feed, so the figures reconcile: net (sub_total) of AUTHORISED and PAID
// sales invoices by invoice date; "recurring" = raised from a repeating invoice.

const COUNTED = new Set(['AUTHORISED', 'PAID']);
const DRAFTS = new Set(['DRAFT', 'SUBMITTED']);
const isRepeat = inv => !!String(inv.repeating_invoice_id || '').trim();
export const refKey = r => String(r || '').trim().toUpperCase().replace(/\s+/g, '');

function lastDay(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function addPeriod(iso, unit, period) {
  const d = new Date(iso + 'T00:00:00Z');
  if (String(unit).toUpperCase() === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7 * period);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + period);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return d.toISOString().slice(0, 10);
}

/** Dates a repeating invoice will still raise in `month` (from its next date, within its end date). */
export function repeatDates(r, month) {
  const out = [];
  const end = lastDay(month);
  let d = String(r.next_date || '').slice(0, 10);
  const stop = r.end_date ? String(r.end_date).slice(0, 10) : null;
  const period = Math.max(1, Number(r.period) || 1);
  for (let i = 0; d && d <= end && i < 40; i++) {
    if (stop && d > stop) break;
    if (d >= `${month}-01`) out.push(d);
    d = addPeriod(d, r.unit, period);
  }
  return out;
}

/**
 * This month's sales straight from Xero, in the shape monthSales returns, plus:
 * - recurringToCome: each repeating invoice still to be raised this month, at its own amount and date
 * - drafts: draft / awaiting-approval invoices dated this month (shown, not counted: a draft
 *   is often the same work as a job "to invoice")
 */
export function xeroMonthSales(invoices, repeating, jobs, { month, exclude = /voip\s*unlimited/i } = {}) {
  const per = new Map();
  let invoiced = 0, rec = 0, other = 0, any = false;
  const drafts = [];
  for (const inv of invoices) {
    if (monthOf(inv.invoice_date) !== month) continue;
    if (DRAFTS.has(inv.status)) { drafts.push(inv); continue; }
    if (!COUNTED.has(inv.status)) continue;
    any = true;
    const net = num(inv.sub_total);
    const name = inv.contact_name || 'Unknown contact';
    if (exclude && exclude.test(name)) { other = round2(other + net); continue; }
    const row = per.get(name) || { name, total: 0, recurring: 0, oneOff: 0 };
    row.total = round2(row.total + net);
    if (isRepeat(inv)) row.recurring = round2(row.recurring + net); else row.oneOff = round2(row.oneOff + net);
    per.set(name, row);
    invoiced = round2(invoiced + net);
    if (isRepeat(inv)) rec = round2(rec + net);
  }
  const rows = [...per.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const recurringToCome = [];
  for (const r of repeating) {
    if (r.status === 'DELETED' || (exclude && exclude.test(r.contact_name || ''))) continue;
    for (const date of repeatDates(r, month)) recurringToCome.push({ name: r.contact_name, amount: round2(r.sub_total), date, reference: r.reference || '' });
  }
  recurringToCome.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const toCome = round2(recurringToCome.reduce((t, r) => t + r.amount, 0));

  // A job whose invoice is already raised in Xero is in "invoiced" already: don't count it twice.
  const raised = new Set(invoices.filter(i => COUNTED.has(i.status)).map(i => refKey(i.invoice_number)));
  const open = j => !(refKey(j.invoice_ref) && raised.has(refKey(j.invoice_ref)));
  const toInvoiceJobs = jobs.filter(j => j.status === 'to_invoice' && open(j));
  const dueJobs = jobs.filter(j => (j.status === 'agreed' || j.status === 'in_progress') && monthOf(j.target_date) === month && open(j));
  const sum = list => round2(list.reduce((t, j) => t + num(j.value), 0));
  const toInvoice = sum(toInvoiceJobs), dueThisMonth = sum(dueJobs);

  return {
    month, source: 'xero', hasXero: any || recurringToCome.length > 0, hasSplit: true,
    invoiced, recurring: rec, oneOff: round2(invoiced - rec), other,
    rows, recurringToCome, toCome, toInvoiceJobs, toInvoice, dueJobs, dueThisMonth,
    drafts, draftValue: round2(drafts.reduce((t, d) => t + num(d.sub_total), 0)),
    projected: round2(invoiced + toCome + toInvoice + dueThisMonth)
  };
}

/** Last `n` months from Xero invoices, oldest first, in salesHistory's shape. */
export function xeroHistory(invoices, { month, n = 6, exclude = /voip\s*unlimited/i } = {}) {
  const out = [];
  let m = month;
  for (let i = 0; i < n; i++) {
    let total = 0, r = 0;
    for (const inv of invoices) {
      if (monthOf(inv.invoice_date) !== m || !COUNTED.has(inv.status)) continue;
      if (exclude && exclude.test(inv.contact_name || '')) continue;
      total += num(inv.sub_total);
      if (isRepeat(inv)) r += num(inv.sub_total);
    }
    out.unshift({ month: m, total: round2(total), recurring: round2(r), oneOff: round2(total - r), has: total > 0 });
    m = previousMonth(m);
  }
  return out;
}

/**
 * A job's Xero invoice, by the number typed on the job: { state, invoice }.
 * state: 'paid' | 'due' | 'overdue' | 'draft' | 'void' | 'missing' | 'none' (no number typed).
 */
export function jobInvoice(job, byNumber, today) {
  const key = refKey(job.invoice_ref);
  if (!key) return { state: 'none', invoice: null };
  const inv = byNumber.get(key);
  if (!inv) return { state: 'missing', invoice: null };
  if (inv.status === 'PAID' || (COUNTED.has(inv.status) && num(inv.amount_due) <= 0)) return { state: 'paid', invoice: inv };
  if (DRAFTS.has(inv.status)) return { state: 'draft', invoice: inv };
  if (!COUNTED.has(inv.status)) return { state: 'void', invoice: inv };
  return { state: inv.due_date && String(inv.due_date) < today ? 'overdue' : 'due', invoice: inv };
}

export const invoiceIndex = invoices => new Map(invoices.filter(i => i.invoice_number).map(i => [refKey(i.invoice_number), i]));

/** Money owed to Gecko (gross, incl. VAT, as Xero's amount due): total, overdue, and per contact. */
export function owed(invoices, today) {
  const per = new Map();
  let total = 0, overdue = 0, count = 0;
  for (const inv of invoices) {
    if (inv.status !== 'AUTHORISED' || !(num(inv.amount_due) > 0)) continue;
    const due = num(inv.amount_due);
    const late = !!inv.due_date && String(inv.due_date) < today;
    const name = inv.contact_name || 'Unknown contact';
    const row = per.get(name) || { name, due: 0, overdue: 0, invoices: 0, oldest: null };
    row.due = round2(row.due + due);
    row.invoices += 1;
    if (late) {
      row.overdue = round2(row.overdue + due);
      if (!row.oldest || String(inv.due_date) < row.oldest) row.oldest = String(inv.due_date);
    }
    per.set(name, row);
    total = round2(total + due); count += 1;
    if (late) overdue = round2(overdue + due);
  }
  const rows = [...per.values()].sort((a, b) => b.overdue - a.overdue || b.due - a.due || a.name.localeCompare(b.name));
  return { total, overdue, count, rows };
}

export function previousMonth(month) {
  const [y, m] = String(month).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Old Projects board statuses → job stages. Finished projects aren't brought across. */
export const PROJECT_STATUS = { Quoted: 'quoted', Agreed: 'agreed', 'In progress': 'in_progress' };
