import assert from 'node:assert/strict';
import {
  validateFeed, xeroMonths, totalsByClient, cspAggregated,
  isStale, feedAgeHours, describeWhen, FEED_PATH, hasSplit, splitByClient
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

// — cspAggregated: same shape as CspCosts.aggregateByCustomer —
assert.deepEqual(cspAggregated(good()), [{ customer: 'ALS Locksmiths', cost: 47.51 }, { customer: 'CDA Ltd', cost: 12.84 }]);
assert.deepEqual(cspAggregated({}), []);

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
