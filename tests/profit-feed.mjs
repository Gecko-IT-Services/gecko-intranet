import assert from 'node:assert/strict';
import {
  validateFeed, xeroMonths, totalsByClient,
  isStale, feedAgeHours, describeWhen, FEED_PATH, hasSplit, splitByClient, invoicedCosts
} from '../src/core/profit-feed.js';

const good = () => ({
  version: 1,
  generatedAt: '2026-10-06T05:52:00Z',
  xero: { months: {
    '2026-09': { 'Cowan Consultancy': 3074.55, 'CDA Ltd': 277.53, 'Voip Unlimited': 638.36 },
    '2026-10': { 'Cowan Consultancy': 776.55 },
    '2026-08': {}
  } },
  csp: {
    invoice: '8284668977', date: '2026-09-16', month: '2026-08', netTotal: 60.35,
    customers: [{ customer: 'ALS Locksmiths', cost: 47.51 }, { customer: 'CDA Ltd', cost: 12.84 }]
  }
});

assert.equal(FEED_PATH, 'Gecko Dashboard Data/profitability-feed.json');

// — validateFeed —
assert.deepEqual(validateFeed(good()), { ok: true, errors: [] });
assert.equal(validateFeed(null).ok, false);
assert.equal(validateFeed({ ...good(), version: 2 }).ok, false, 'unknown version is refused');
assert.equal(validateFeed({ ...good(), generatedAt: 'soon' }).ok, false);
{ const f = good(); f.xero.months['2026-9'] = {}; assert.equal(validateFeed(f).ok, false, 'month must be YYYY-MM'); }
{ const f = good(); f.xero.months['2026-09']['CDA Ltd'] = '277.53'; assert.equal(validateFeed(f).ok, false, 'a string amount is refused, not coerced'); }
{ const f = good(); f.csp.customers[0].cost = NaN; assert.equal(validateFeed(f).ok, false); }
{ const f = good(); f.csp.netTotal = 1142.72;
  const r = validateFeed(f);
  assert.equal(r.ok, false, 'invoice lines must add up to the invoice total');
  assert.match(r.errors.join(), /add up to 60.35/); }
{ const f = good(); f.csp.netTotal = 60.37; assert.equal(validateFeed(f).ok, true, 'pennies of rounding are tolerated'); }
{ const f = good(); f.csp = null; f.cspError = 'No invoice this month'; assert.equal(validateFeed(f).ok, true, 'a feed with no CSP section is valid'); }
{ const f = good(); delete f.xero; assert.equal(validateFeed(f).ok, true, 'a feed with no Xero section is valid'); }

// — xeroMonths —
assert.deepEqual(xeroMonths(good()).map(([m]) => m), ['2026-10', '2026-09'], 'newest first, empty months skipped');

// — totalsByClient —
const cowan = { id: 1, name: 'Cowan Consultancy' };
const cda   = { id: 2, name: 'CDA' };
const match = n => (n === 'Cowan Consultancy' ? cowan : n === 'CDA Ltd' || n === 'CD Aluminium' ? cda : null);
const t = totalsByClient({ 'Cowan Consultancy': 100.1, 'CDA Ltd': 10.105, 'CD Aluminium': 5, 'Voip Unlimited': 638.36 }, match);
assert.deepEqual(t.matched.map(m => [m.client.name, m.total]), [['Cowan Consultancy', 100.1], ['CDA', 15.11]],
  'two contacts for one client are summed, not overwritten');
assert.deepEqual(t.unmatched, [{ xeroName: 'Voip Unlimited', total: 638.36, assignedTo: null }]);


// — staleness —
const f = good();
assert.equal(Math.round(feedAgeHours(f, new Date('2026-10-06T17:52:00Z'))), 12);
assert.equal(isStale(f, new Date('2026-10-07T12:00:00Z')), false, 'a day old is fine');
assert.equal(isStale(f, new Date('2026-10-08T12:00:00Z')), true, 'two days old means the job stopped');

// — describeWhen (UK time) —
assert.equal(describeWhen('2026-10-06T05:52:00Z', new Date('2026-10-06T12:00:00Z')), 'today 06:52');
assert.equal(describeWhen('2026-10-05T05:52:00Z', new Date('2026-10-06T12:00:00Z')), 'yesterday 06:52');
assert.equal(describeWhen('2026-10-01T05:52:00Z', new Date('2026-10-06T12:00:00Z')), '1 Oct');

console.log('profit-feed: all assertions passed');

// — recurring / one-off split —
{
  const f = good();
  f.xero.recurring = { '2026-09': { 'Cowan Consultancy': 776.55, 'CDA Ltd': 277.53 } };
  assert.equal(validateFeed(f).ok, true, 'a valid recurring section is accepted');
  assert.equal(hasSplit(f, '2026-09'), true);
  assert.equal(hasSplit(f, '2026-10'), false, 'no split for a month the feed did not split');
  assert.equal(hasSplit(good(), '2026-09'), false, 'older feeds have no split');

  const clients = { 'Cowan Consultancy': { id: 'c1' }, 'CDA Ltd': { id: 'c2' }, 'Voip Unlimited': { id: 'c3' } };
  const s = splitByClient(f, '2026-09', n => clients[n] || null);
  assert.deepEqual([s.get('c1').total, s.get('c1').recurring, s.get('c1').oneOff], [3074.55, 776.55, 2298]);
  assert.equal(s.get('c2').oneOff, 0, 'all-recurring client has no one-off');
  assert.deepEqual([s.get('c3').recurring, s.get('c3').oneOff], [0, 638.36], 'a contact missing from recurring is all one-off');
  assert.equal(splitByClient(good(), '2026-09', n => clients[n]).size, 0);

  const one = { id: 'x' };
  const g = good();
  g.xero.months['2026-09'] = { 'Acme': 100, 'Acme Ltd': 50 };
  g.xero.recurring = { '2026-09': { 'Acme': 100 } };
  const merged = splitByClient(g, '2026-09', () => one).get('x');
  assert.deepEqual([merged.total, merged.recurring, merged.oneOff], [150, 100, 50], 'two contacts for one client are summed');
}
{ const f = good(); f.xero.recurring = { '2026-09': { 'CDA Ltd': 300 } };
  assert.match(validateFeed(f).errors.join(), /more than its total/); }
{ const f = good(); f.xero.recurring = { '2026-09': { 'Nobody': 1 } };
  assert.match(validateFeed(f).errors.join(), /not in that month's totals/); }
{ const f = good(); f.xero.recurring = { '2026-07': {} };
  assert.match(validateFeed(f).errors.join(), /no matching month/); }
{ const f = good(); f.xero.recurring = { '2026-09': { 'CDA Ltd': '1' } };
  assert.equal(validateFeed(f).ok, false, 'string recurring refused'); }

console.log('profit-feed split: ok');

// — invoiced supplier costs —
{
  const f = good();
  f.exclaimer = { subscriptions: [
    { invoice: '2434295', date: '2026-08-14', product: 'Exclaimer Starter Edition for Office 365', users: 12, endUser: 'Technix Rubber and Plastics Ltd', months: 12, net: 93.6, periodStart: '2026-08-13', periodEnd: '2027-08-12' },
    { invoice: '2472823', date: '2026-09-30', product: 'Exclaimer Starter Edition for Office 365', users: 10, endUser: 'MSA Safety', months: 1, net: 6.5, periodStart: '2026-09-26', periodEnd: '2026-10-25' },
    { invoice: '2455613', date: '2026-09-10', product: 'Exclaimer Standard Edition for Office 365', users: 15, endUser: 'Gecko IT Services', months: 12, net: 185.4, periodStart: '2026-09-02', periodEnd: '2027-09-01' }
  ] };
  f.clook = { invoices: [
    { invoice: '523904', date: '2026-09-19', lines: [{ item: 'Domain Renewal - hampshire-glass.co.uk - 1 Year/s', domain: 'hampshire-glass.co.uk', client: 'Hampshire Glass and Window Solutions Ltd', net: 7.99 }] },
    { invoice: '522796', date: '2026-09-15', lines: [{ item: 'Reseller-Enterprise - gecko-it.com', domain: 'gecko-it.com', client: null, shared: true, net: 29.99 }] },
    { invoice: '516780', date: '2026-07-14', lines: [{ item: 'Domain Renewal - slaterfamily.me.uk - 1 Year/s', domain: 'slaterfamily.me.uk', client: null, net: 7.99 }] }
  ] };
  assert.equal(validateFeed(f).ok, true, 'exclaimer and clook sections are accepted');

  const clients = { 'MSA Safety': { id: 'msa' }, 'Hampshire Glass and Window Solutions Ltd': { id: 'hg' }, 'Technix Rubber and Plastics Ltd': { id: 'tx' } };
  const sep = invoicedCosts(f, '2026-09', n => clients[n] || null);
  assert.equal(sep.byClient.get('msa').total, 6.5);
  assert.equal(sep.byClient.get('hg').total, 7.99);
  assert.equal(sep.byClient.has('tx'), false, 'August invoice does not land in September');
  assert.deepEqual(sep.shared.map(l => l.net), [29.99], 'reseller plan is shared, not a client cost');
  assert.deepEqual(sep.unassigned.map(l => l.name), ['Gecko IT Services'], 'unknown end user is listed, never dropped');
  assert.equal(sep.total, 229.88, 'total includes shared and unassigned so nothing is lost');

  // Gecko's own Exclaimer subscription (account A9356-F39) is shared, like the Clook reseller plan.
  const own = good();
  own.exclaimer = { subscriptions: [
    { invoice: '2403082', date: '2026-07-10', product: 'Exclaimer Starter Edition for Office 365', users: 10, endUser: 'Gecko IT Services', shared: true, months: 12, net: 78, periodStart: '2026-07-01', periodEnd: '2027-06-30' },
    { invoice: '2455613', date: '2026-09-10', product: 'Exclaimer Standard Edition for Office 365', users: 15, endUser: 'Onsite Commercial Services', months: 12, net: 185.4, periodStart: '2026-09-02', periodEnd: '2027-09-01' }
  ] };
  assert.equal(validateFeed(own).ok, true, 'shared flag on an Exclaimer line is accepted');
  const ownJul = invoicedCosts(own, '2026-07', () => null);
  assert.deepEqual([ownJul.shared.map(l => l.net), ownJul.unassigned.length, ownJul.total], [[78], 0, 78], 'own subscription is shared, not unassigned');
  const onsite = invoicedCosts(own, '2026-09', n => (n === 'Onsite Commercial Services' ? { id: 'osc' } : null));
  assert.equal(onsite.byClient.get('osc').total, 185.4, '15-user Standard lands on Onsite');
  own.exclaimer.subscriptions[0].shared = 'yes';
  assert.match(validateFeed(own).errors.join(), /shared is not true\/false/);

  const jul = invoicedCosts(f, '2026-07', n => clients[n] || null);
  assert.deepEqual(jul.unassigned.map(l => l.name), ['slaterfamily.me.uk'], 'a Clook line with no client falls back to its domain');
  assert.equal(invoicedCosts(good(), '2026-09', () => null).total, 0, 'older feeds have no invoiced costs');
}
{ const f = good(); f.clook = { invoices: [{ invoice: '1', date: '19/09/2026', lines: [{ item: 'x', net: 1 }] }] };
  assert.match(validateFeed(f).errors.join(), /not YYYY-MM-DD/); }
{ const f = good(); f.clook = { invoices: [{ invoice: '1', date: '2026-09-19', lines: [{ item: 'x', net: '7.99' }] }] };
  assert.equal(validateFeed(f).ok, false, 'string net refused'); }
{ const f = good(); f.exclaimer = { subscriptions: [{ invoice: '1', date: '2026-09-19', endUser: '', net: 1 }] };
  assert.match(validateFeed(f).errors.join(), /no end user/); }
{ const f = good(); f.exclaimer = null; f.clook = null; assert.equal(validateFeed(f).ok, true); }

console.log('profit-feed invoiced: ok');

// — TD SYNNEX invoices in the month dated —
{
  const f = good();
  f.cspInvoices = [
    { invoice: '8284668977', date: '2026-09-16', netTotal: 100.71, customers: [
      { customer: 'ALS Locksmiths', cost: 47.51 },
      { customer: 'Onsite Services Southern Ltd', client: 'Onsite Commercial Services', cost: 53.2 } ] },
    { invoice: '8284050000', date: '2026-08-16', netTotal: 12.84, customers: [{ customer: 'CDA Ltd', cost: 12.84 }] }
  ];
  assert.equal(validateFeed(f).ok, true, 'cspInvoices accepted');
  const clients = { 'ALS Locksmiths': { id: 'als' }, 'Onsite Commercial Services': { id: 'onsite' }, 'CDA Ltd': { id: 'cda' } };
  const sep = invoicedCosts(f, '2026-09', n => clients[n] || null);
  assert.equal(sep.byClient.get('als').total, 47.51);
  assert.equal(sep.byClient.get('onsite').total, 53.2, 'job-assigned client name wins over the printed end user');
  assert.equal(sep.byClient.has('cda'), false, 'August invoice stays in August');
  assert.equal(sep.byClient.get('als').lines[0].supplier, 'TD SYNNEX');
  const aug = invoicedCosts(f, '2026-08', n => clients[n] || null);
  assert.equal(aug.byClient.get('cda').total, 12.84);
}
{ const f = good(); f.cspInvoices = [{ invoice: '1', date: '2026-09-16', netTotal: 10, customers: [{ customer: 'X', cost: 5 }] }];
  assert.match(validateFeed(f).errors.join(), /add up to 5.00/, 'a CSP invoice whose lines do not add up is refused'); }
{ const f = good(); f.cspInvoices = [{ invoice: '1', date: '16/09/2026', netTotal: 5, customers: [{ customer: 'X', cost: 5 }] }];
  assert.match(validateFeed(f).errors.join(), /not YYYY-MM-DD/); }
console.log('profit-feed csp invoices: ok');
