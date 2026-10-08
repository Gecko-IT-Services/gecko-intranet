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

export function previousMonth(month) {
  const [y, m] = String(month).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Old Projects board statuses → job stages. Finished projects aren't brought across. */
export const PROJECT_STATUS = { Quoted: 'quoted', Agreed: 'agreed', 'In progress': 'in_progress' };
