import assert from 'node:assert/strict';
import { flags, THIN_MARGIN } from '../src/core/profitability.js';

const keys = row => flags(row).map(f => f.key);
// A feed month that has finished, a healthy client billed as its lines say.
const base = { sell: 100, cost: 20, lines: 100, fromXero: true, xeroTotal: 100, xeroRecurring: 100, month: '2026-09', current: '2026-10' };

assert.deepEqual(keys(base), [], 'healthy: no flag');

// — losing money —
assert.deepEqual(keys({ ...base, cost: 120 }), ['losing']);
assert.equal(flags({ ...base, cost: 120 })[0].level, 'red');
assert.deepEqual(keys({ ...base, cost: 100 }), ['thin'], 'profit exactly £0 is not losing, but 0% is thin');
assert.deepEqual(keys({ ...base, cost: 100.004 }), ['thin'], 'under half a penny is not a loss');

// — thin margin —
assert.equal(THIN_MARGIN, 0.4);
assert.deepEqual(keys({ ...base, cost: 60 }), [], 'exactly 40% is not thin');
assert.deepEqual(keys({ ...base, cost: 60.5 }), ['thin']);
assert.deepEqual(keys({ ...base, sell: 0, lines: 0, xeroTotal: 0, xeroRecurring: 0, cost: 0 }), [], 'nothing at all: no flag');

// — Xero under the lines (feed months only) —
assert.deepEqual(keys({ ...base, lines: 101 }), [], '£1 under is not flagged');
const under = flags({ ...base, lines: 130 });
assert.deepEqual(under.map(f => f.key), ['under']);
assert.equal(under[0].text, 'Xero £30.00 under lines');
assert.deepEqual(keys({ ...base, lines: 70 }), [], 'billing more than the lines (annual renewal) is never flagged');
assert.deepEqual(keys({ ...base, fromXero: false, lines: 130 }), [], 'no Xero comparison on months the feed does not cover');

// — not billed in Xero —
const unbilled = { ...base, sell: 0, xeroTotal: 0, xeroRecurring: 0 };
assert.deepEqual(keys(unbilled), ['losing', 'unbilled'], 'finished month: costs with no billing, and not billed');
assert.deepEqual(keys({ ...unbilled, cost: 0 }), ['unbilled']);
assert.deepEqual(keys({ ...unbilled, month: '2026-10' }), [], 'current month: not judged until it is billed');
assert.deepEqual(keys({ ...unbilled, lines: 0, cost: 0 }), [], 'no lines, no billing: no flag');

// — months the feed doesn't cover: typed lines only —
assert.deepEqual(keys({ sell: 50, cost: 80, lines: 50, fromXero: false, month: '2026-03', current: '2026-10' }), ['losing']);

// — several at once, most serious first —
assert.deepEqual(keys({ ...base, sell: 50, xeroRecurring: 50, xeroTotal: 50, cost: 40, lines: 100 }), ['thin', 'under']);

console.log('profitability: ok');
