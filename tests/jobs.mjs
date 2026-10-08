import assert from 'node:assert/strict';
import { stageTotals, monthSales, salesHistory, previousMonth, STAGES, xeroMonthSales, xeroHistory, repeatDates, jobInvoices, jobRaised, invoiceIndex, owed, invoicedGroups, nudgeInvoices, nudgeEmail } from '../src/core/jobs.js';

assert.equal(previousMonth('2026-01'), '2025-12');
assert.equal(previousMonth('2026-10'), '2026-09');

const jobs = [
  { status: 'quoted', value: 1200 },
  { status: 'in_progress', value: 800, target_date: '2026-10-20' },
  { status: 'in_progress', value: 500, target_date: '2026-11-05' },
  { status: 'agreed', value: null, target_date: '2026-10-30' },
  { status: 'to_invoice', value: 350.5 },
  { status: 'invoiced', value: 99 },
  { status: 'bogus', value: 1 }
];
const t = stageTotals(jobs);
assert.equal(Object.keys(t).length, STAGES.length);
assert.deepEqual(t.in_progress, { count: 2, value: 1300 });
assert.deepEqual(t.agreed, { count: 1, value: 0 }, 'no value yet counts as £0');

const feed = { xero: {
  months: {
    '2026-09': { 'A Ltd': 100, 'B Ltd': 200, 'C Ltd': 50, 'Voip Unlimited': 638.36 },
    '2026-10': { 'A Ltd': 150, 'D Ltd': 1000, 'Voip Unlimited': 600 }
  },
  recurring: {
    '2026-09': { 'A Ltd': 100, 'B Ltd': 200, 'Voip Unlimited': 638.36 },
    '2026-10': { 'A Ltd': 100 }
  }
} };
const s = monthSales(feed, jobs, { month: '2026-10' });
assert.equal(s.invoiced, 1150, 'dealer commission is not client sales');
assert.equal(s.other, 600);
assert.equal(s.recurring, 100);
assert.equal(s.oneOff, 1050);
assert.deepEqual(s.rows[0], { name: 'D Ltd', total: 1000, recurring: 0, oneOff: 1000 });
assert.deepEqual(s.recurringToCome, [{ name: 'B Ltd', amount: 200 }], 'B billed by repeating invoice last month, not yet this month');
assert.equal(s.toInvoice, 350.5);
assert.equal(s.dueThisMonth, 800, 'only agreed/in-progress jobs targeted this month');
assert.equal(s.projected, 1150 + 200 + 350.5 + 800);

const empty = monthSales({}, [], { month: '2026-10' });
assert.equal(empty.hasXero, false);
assert.equal(empty.projected, 0);

const h = salesHistory(feed, { month: '2026-10', n: 3 });
assert.deepEqual(h.map(x => x.month), ['2026-08', '2026-09', '2026-10']);
assert.equal(h[0].has, false);
assert.deepEqual(h[1], { month: '2026-09', total: 350, recurring: 300, oneOff: 50, has: true });

// ─── Xero, direct ───
const inv = (n, contact, date, status, net, extra = {}) => ({ invoice_number: n, contact_name: contact, invoice_date: date, status, sub_total: net, amount_due: 0, repeating_invoice_id: '', ...extra });
const invoices = [
  inv('INV-1', 'A Ltd', '2026-10-01', 'PAID', 100, { repeating_invoice_id: 'r-a' }),
  inv('INV-2', 'D Ltd', '2026-10-03', 'AUTHORISED', 1000, { amount_due: 1200, due_date: '2026-10-31' }),
  inv('INV-3', 'Voip Unlimited', '2026-10-01', 'AUTHORISED', 600, { amount_due: 720, due_date: '2026-10-05' }),
  inv('INV-4', 'A Ltd', '2026-10-02', 'VOIDED', 999),
  inv('INV-5', 'E Ltd', '2026-10-06', 'DRAFT', 250),
  inv('INV-6', 'B Ltd', '2026-09-01', 'PAID', 200, { repeating_invoice_id: 'r-b' }),
  inv('INV-7', 'C Ltd', '2026-09-10', 'AUTHORISED', 50, { amount_due: 60, due_date: '2026-09-30' }),
  inv('INV-8', 'C Ltd', '2026-09-12', 'DELETED', 75)
];
const repeating = [
  { contact_name: 'B Ltd', status: 'AUTHORISED', unit: 'MONTHLY', period: 1, next_date: '2026-10-16', sub_total: 200 },
  { contact_name: 'F Ltd', status: 'DRAFT', unit: 'MONTHLY', period: 1, next_date: '2026-10-28', sub_total: 40 },
  { contact_name: 'A Ltd', status: 'AUTHORISED', unit: 'MONTHLY', period: 1, next_date: '2026-11-01', sub_total: 100 },
  { contact_name: 'G Ltd', status: 'AUTHORISED', unit: 'MONTHLY', period: 12, next_date: '2027-03-01', sub_total: 500 },
  { contact_name: 'H Ltd', status: 'DELETED', unit: 'MONTHLY', period: 1, next_date: '2026-10-20', sub_total: 70 },
  { contact_name: 'Voip Unlimited', status: 'AUTHORISED', unit: 'MONTHLY', period: 1, next_date: '2026-10-20', sub_total: 600 },
  { contact_name: 'W Ltd', status: 'AUTHORISED', unit: 'WEEKLY', period: 1, next_date: '2026-10-20', sub_total: 10, end_date: '2026-10-30' }
];
const x = xeroMonthSales(invoices, repeating, jobs, { month: '2026-10' });
assert.equal(x.invoiced, 1100, 'net of authorised + paid; voided, deleted, drafts and dealer commission left out');
assert.equal(x.recurring, 100);
assert.equal(x.oneOff, 1000);
assert.equal(x.other, 600);
assert.deepEqual(x.recurringToCome.map(r => [r.name, r.date, r.amount]), [
  ['B Ltd', '2026-10-16', 200], ['W Ltd', '2026-10-20', 10], ['W Ltd', '2026-10-27', 10], ['F Ltd', '2026-10-28', 40]
], 'each repeating invoice still to raise this month, at its own date; weekly twice before its end date');
assert.equal(x.toCome, 260);
assert.equal(x.draftValue, 250);
assert.equal(x.projected, 1100 + 260 + 350.5 + 800);

const raisedJob = xeroMonthSales(invoices, [], [{ status: 'to_invoice', value: 1000, invoice_ref: 'inv-2' }, { status: 'to_invoice', value: 5 }], { month: '2026-10' });
assert.equal(raisedJob.toInvoice, 5, 'a job whose invoice is already in Xero is not counted again');

assert.deepEqual(repeatDates({ next_date: '2026-01-31', unit: 'MONTHLY', period: 1 }, '2026-02'), ['2026-02-28'], 'month end clamps');
assert.deepEqual(repeatDates({ next_date: '2026-09-30', unit: 'MONTHLY', period: 1 }, '2026-10'), ['2026-10-30'], 'an overdue template still lands this month');

const xh = xeroHistory(invoices, { month: '2026-10', n: 2 });
assert.deepEqual(xh, [
  { month: '2026-09', total: 250, recurring: 200, oneOff: 50, has: true },
  { month: '2026-10', total: 1100, recurring: 100, oneOff: 1000, has: true }
]);

const idx = invoiceIndex(invoices);
const today = '2026-10-08';
assert.equal(jobInvoices({ invoice_ref: ' inv-1 ' }, idx, today)[0]?.state ?? 'none', 'paid', 'number matched case- and space-insensitively');
assert.equal(jobInvoices({ invoice_ref: 'INV-2' }, idx, today)[0]?.state ?? 'none', 'due');
assert.equal(jobInvoices({ invoice_ref: 'INV-7' }, idx, today)[0]?.state ?? 'none', 'overdue');
assert.equal(jobInvoices({ invoice_ref: 'INV-5' }, idx, today)[0]?.state ?? 'none', 'draft');
assert.equal(jobInvoices({ invoice_ref: 'INV-4' }, idx, today)[0]?.state ?? 'none', 'void');
assert.equal(jobInvoices({ invoice_ref: 'INV-999' }, idx, today)[0]?.state ?? 'none', 'missing');
assert.equal(jobInvoices({ invoice_ref: '' }, idx, today)[0]?.state ?? 'none', 'none');

const two = jobInvoices({ invoice_ref: 'INV-1, INV-5' }, idx, today);
assert.deepEqual(two.map(r => [r.ref, r.state]), [['INV-1', 'paid'], ['INV-5', 'draft']], 'a deposit and the balance');
assert.equal(jobRaised({ invoice_ref: 'INV-1, INV-5, INV-4' }, idx), 350, 'drafts count as raised, voided do not');

// Deposit approved, balance still to invoice: only the balance is still to come; a job's draft isn't listed again.
const dep = xeroMonthSales(invoices, [], [{ status: 'to_invoice', value: 1100, invoice_ref: 'INV-1, INV-5' }], { month: '2026-10' });
assert.equal(dep.toInvoice, 1000);
assert.equal(dep.drafts.length, 0);

const g = invoicedGroups([
  { id: 1, status: 'invoiced', invoice_ref: 'INV-1', invoiced_at: '2026-10-01' },
  { id: 2, status: 'invoiced', invoice_ref: 'INV-2', invoiced_at: '2026-10-03' },
  { id: 3, status: 'invoiced', invoice_ref: 'INV-7', invoiced_at: '2026-09-10' },
  { id: 4, status: 'invoiced', invoice_ref: '', invoiced_at: '2026-09-01' },
  { id: 5, status: 'invoiced', invoice_ref: 'INV-1', invoiced_at: '2026-05-01' },
  { id: 6, status: 'to_invoice', invoice_ref: 'INV-1' }
], idx, today);
assert.deepEqual(g.awaiting.map(j => j.id), [3, 2], 'overdue first');
assert.deepEqual(g.unmatched.map(j => j.id), [4]);
assert.deepEqual(g.paid.map(j => j.id), [1, 5]);
assert.deepEqual(g.recent.map(j => j.id), [1], 'paid in the last 90 days');

const o = owed(invoices, today);
assert.equal(o.total, 1980);
assert.equal(o.overdue, 780);
assert.equal(o.count, 3);
assert.deepEqual(o.rows[0], { name: 'Voip Unlimited', due: 720, overdue: 720, invoices: 1, oldest: '2026-10-05' });


// — Nudge: friendly payment reminder —
{
  const inv = [
    { invoice_id: 'a', invoice_number: 'INV-0201', contact_name: 'Regal Autosport', invoice_date: '2026-08-01', due_date: '2026-08-31', status: 'AUTHORISED', amount_due: 125.30 },
    { invoice_id: 'b', invoice_number: 'INV-0190', contact_name: 'Regal Autosport', invoice_date: '2026-07-20', due_date: '2026-08-10', status: 'AUTHORISED', amount_due: 125.30 },
    { invoice_id: 'c', invoice_number: 'INV-0300', contact_name: 'Regal Autosport', invoice_date: '2026-10-01', due_date: '2026-10-31', status: 'AUTHORISED', amount_due: 125.30 },
    { invoice_id: 'd', invoice_number: 'INV-0150', contact_name: 'Regal Autosport', invoice_date: '2026-06-01', due_date: '2026-06-30', status: 'PAID', amount_due: 0 },
    { invoice_id: 'e', invoice_number: 'INV-0310', contact_name: 'Daron Motors', invoice_date: '2026-10-01', due_date: '2026-10-31', status: 'AUTHORISED', amount_due: 864 }
  ];
  const today = '2026-10-08';
  assert.deepEqual(nudgeInvoices(inv, 'Regal Autosport', today).map(i => i.invoice_number), ['INV-0190', 'INV-0201'], 'overdue only, oldest first');
  assert.deepEqual(nudgeInvoices(inv, 'Daron Motors', today).map(i => i.invoice_number), ['INV-0310'], 'nothing overdue → the unpaid ones');
  const m = nudgeEmail({ contactName: 'Regal Autosport', firstName: 'Sam Smith', invoices: nudgeInvoices(inv, 'Regal Autosport', today), links: { b: 'https://in.xero.com/abc' }, today, sender: 'Kind regards,\nPhilip Morris\nGecko IT Services' });
  assert.equal(m.subject, 'A friendly nudge: 2 invoices from Gecko IT Services (£250.60)');
  assert.equal(m.total, 250.6);
  assert.match(m.text, /^Hi Sam,/);
  assert.match(m.text, /now past their due date/);
  assert.match(m.text, /• INV-0190 \(20 July 2026\): £125\.30, was due 10 August 2026\n  Pay online: https:\/\/in\.xero\.com\/abc/);
  assert.match(m.text, /Total: £250\.60 \(incl\. VAT\)/);
  assert.match(m.text, /It may well already be on its way/);
  assert.ok(m.html.includes('<a href="https://in.xero.com/abc">View and pay online</a>'));
  assert.match(m.text, /Where there’s a link above you can view and pay online/, 'only one of two has a link');
  const both = nudgeEmail({ contactName: 'R', invoices: nudgeInvoices(inv, 'Regal Autosport', today), links: { a: 'x', b: 'y' }, today });
  assert.match(both.text, /view and pay each one online using the links above/);
  assert.ok(m.html.includes('Philip Morris<br>Gecko IT Services'));
  const one = nudgeEmail({ contactName: 'Daron <Motors>', invoices: nudgeInvoices(inv, 'Daron Motors', today), today });
  assert.equal(one.subject, 'A friendly nudge: invoice INV-0310 (£864.00)');
  assert.match(one.text, /^Hi there,/);
  assert.match(one.text, /coming up for payment/);
  assert.match(one.text, /by bank transfer using the details on the invoice/);
  assert.ok(!one.text.includes('Total:'), 'no total line for a single invoice');
  assert.ok(one.html.includes('Daron &lt;Motors&gt;') && !one.html.includes('<Motors>'), 'escaped');
}

console.log('jobs: ok');
