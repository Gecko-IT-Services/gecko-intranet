import assert from 'node:assert/strict';
import {
  saleFeatures, costFeature, parseCsv, money, detectColumns, usageLines, reconcile,
  billMonths, billsFromFeed, ateraSales, salesByMonth, ateraMonth, usageChanges, SEAT_OFFER_USD
} from '../src/core/atera-costs.js';

// — Features from Xero descriptions (real lines, Sep 2026). —
assert.deepEqual(saleFeatures('Atera - Internet Security'), ['security']);
assert.deepEqual(saleFeatures('Atera - Internet Security & Backup & Work from Home (x5)'), ['backup', 'security', 'remote']);
assert.deepEqual(saleFeatures('Acronis/M365 - Cloud Backup'), ['backup']);
assert.deepEqual(saleFeatures('Keeper Password Manager - per user'), ['passwords']);
assert.deepEqual(saleFeatures('OpenText PC Security (Andrew, Spencer & Richard) PC\'s.'), ['security']);
assert.deepEqual(saleFeatures('Atera - Cloud Management'), ['management']);
assert.deepEqual(saleFeatures('Atera - Internet Security & Cloud Management'), ['security', 'management']);
assert.deepEqual(saleFeatures('Remote IT Support, Defender AV, Windows Backup, Remote Management, Monthly Maintenance Schedules'), ['management'],
  'Technix’s retainer: Windows Backup and Defender are not Atera add-ons');
assert.deepEqual(saleFeatures('Atera - Work From Home (Beckie)'), ['remote']);

// — Features of Atera usage products (names as Atera's App Center shows them). —
assert.equal(costFeature('Acronis Cyber Protect - Workstation'), 'backup');
assert.equal(costFeature('Acronis Hosted Storage (GB)'), 'backup');
assert.equal(costFeature('Webroot DNS Protection'), 'security');
assert.equal(costFeature('OpenText Endpoint Protection'), 'security');
assert.equal(costFeature('Keeper BreachWatch'), 'passwords');
assert.equal(costFeature('Splashtop EndUser Remote'), 'remote');
assert.equal(costFeature('Network Discovery'), 'other');

// — Reading a usage report. —
assert.equal(money('$1,234.50'), 1234.5);
assert.equal(money('(12.00)'), -12);
assert.ok(Number.isNaN(money('n/a')));
const csv = 'Atera usage report,,,,\nPeriod,Sep 2026,,,\n'
  + 'Customer Name,Product,Quantity,Unit Price,Total (USD)\n'
  + 'Cowan Consultancy,Webroot Endpoint Protection,17,$1.20,$20.40\n'
  + ',Acronis Cyber Protect - Workstation,1,$3.90,$3.90\n'
  + '"Daron Motors","Acronis Hosted Storage (GB)","308","0.04","12.32"\n'
  + 'Gecko IT Services,Keeper Business,2,2.62,5.24\n'
  + 'Subtotal,,,,41.86\n'
  + 'Total,,,,41.86\n';
const rows = parseCsv(csv);
const cols = detectColumns(rows);
assert.deepEqual([cols.header, cols.customer, cols.product, cols.quantity, cols.amount], [2, 0, 1, 2, 4], 'finds the heading row; “Total (USD)” beats the unit price');
const u = usageLines(rows, cols);
assert.equal(u.lines.length, 4);
assert.equal(u.lines[1].customer, 'Cowan Consultancy', 'a grouped report names the customer once');
assert.deepEqual(u.lines.map(l => l.feature), ['security', 'backup', 'backup', 'passwords']);
assert.equal(u.total, 41.86, 'subtotal and total rows are not counted');
assert.equal(u.skipped.length, 2);
assert.deepEqual(reconcile(41.86, 42.5), { ok: true, diff: -0.64 });
assert.deepEqual(reconcile(41.86, 721.43), { ok: false, diff: -679.57 });
assert.equal(detectColumns([['a', 'b'], ['1', '2']]).header, -1, 'no customer and amount headings: not recognised');

// — The bill. —
const bills = [
  { month: '2026-09', charged_on: '2026-09-10', kind: 'addons', product: 'AppCenter AppCenter-UsageBased-M', usd: 711.29, gbp: 547.73, gbp_source: 'paid' },
  { month: '2026-09', charged_on: '2026-09-26', kind: 'seats', product: 'Atera SD-Enterprise_0225-M (2)', usd: 378, gbp: 298.18, gbp_source: 'paid' },
  { month: '2026-10', charged_on: '2026-10-10', kind: 'addons', product: 'AppCenter AppCenter-UsageBased-M', usd: 721.43, gbp: 569.22, gbp_source: 'paid' }
];
const bm = billMonths(bills);
assert.deepEqual(bm.map(b => b.month), ['2026-10', '2026-09'], 'newest first');
assert.deepEqual([bm[1].usd, bm[1].gbp, bm[1].techs, bm[1].estimated], [1089.29, 845.91, 2, false]);
const fromFeed = billsFromFeed({ month: '2026-09', usdToGbp: 0.7561, charges: [
  { usd: 378, date: '2026-09-26', product: 'Atera SD-Enterprise_0225-M (2)' },
  { usd: 735.1, date: '2026-11-10', product: 'AppCenter AppCenter-UsageBased-M' }] }, bills);
assert.equal(fromFeed.length, 1, 'a charge already held is not added again');
assert.deepEqual([fromFeed[0].month, fromFeed[0].kind, fromFeed[0].gbp, fromFeed[0].gbp_source], ['2026-11', 'addons', 555.81, 'rate']);

// — What clients are charged. —
const inv = (contact_name, invoice_date, lines, status = 'AUTHORISED') => ({ contact_name, invoice_date, status, line_items: lines });
const line = (description, line_amount, item_code = 'Atera - Internet Security') => ({ item_code, description, line_amount });
const invoices = [
  inv('Cowan Consultancy', '2026-09-01', [line('Atera - Internet Security & Backup & Work from Home (x5)', 323.05), line('M365', 243.04, 'M365')]),
  inv('Daron Motors', '2026-09-01', [line('Atera - Cloud Backup', 10, 'Atera - Cloud Backup')]),
  inv('Haus Coast Ltd', '2026-09-01', [line('Keeper Password Manager - per user', 5)], 'DRAFT'),
  inv('Cowan Consultancy', '2026-08-01', [line('Atera - Internet Security', 300)])
];
const s = ateraSales(invoices, '2026-09');
assert.deepEqual([...s.keys()], ['Cowan Consultancy', 'Daron Motors'], 'drafts and other months are left out');
assert.equal(s.get('Cowan Consultancy').total, 323.05, 'M365 is not Atera');
assert.deepEqual(salesByMonth(invoices, ['2026-08', '2026-09']), { '2026-08': 300, '2026-09': 333.05 });

// — The month, without a usage report: bill, sales, the seat offer and what devices show. —
const a = (customer_name, machine_name, last_seen) => ({ customer_name, machine_name, device_type: 'Work Station', os: 'Microsoft Windows 11 Pro', last_seen });
const agents = [
  a('Cowan Consultancy', 'C1', '2026-09-28T08:00:00Z'), a('Cowan Consultancy', 'C2', '2026-06-01T08:00:00Z'),
  a('Wired Services', 'W1', '2026-09-29T08:00:00Z'),
  a('Gecko IT Services', 'G1', '2026-05-01T08:00:00Z')
];
const noUsage = ateraMonth({ month: '2026-09', bill: bm[1], usage: null, invoices, agents, today: '2026-09-30' });
assert.equal(noUsage.hasUsage, false);
assert.deepEqual([noUsage.cost, noUsage.sale, noUsage.margin], [845.91, 333.05, -512.86]);
assert.equal(noUsage.clients.find(c => c.name === 'Cowan Consultancy').cost, null, 'no report, no cost per client');
const seat = noUsage.leaks.find(l => l.kind === 'seat_offer');
assert.equal(seat.usd, 91.8, `2 × ($189 − $${SEAT_OFFER_USD})`);
assert.ok(seat.text.includes('$189.00 a month') && seat.text.includes('$143.10') && seat.text.includes('$1,101.60 a year less'));
assert.ok(noUsage.leaks.some(l => l.kind === 'devices_unbilled' && l.client === 'Wired Services'));
assert.ok(noUsage.leaks.some(l => l.kind === 'stale' && l.client === 'Cowan Consultancy'));
assert.ok(noUsage.leaks.some(l => l.kind === 'stale' && l.client === 'Gecko IT Services'), 'Gecko’s own stale devices are listed');
assert.ok(!noUsage.clients.some(c => c.internal), 'Gecko’s own machines are not a client');
assert.equal(noUsage.leakTotal, 71.29, 'only certain leaks add up: the seat offer at September’s paid rate');
const cowanNo = noUsage.clients.find(c => c.name === 'Cowan Consultancy');
assert.deepEqual([cowanNo.saleByFeature.backup, cowanNo.saleByFeature.security, cowanNo.saleByFeature.remote], [107.68, 107.68, 107.68], 'a bundle splits evenly while costs are unknown');

// — With a usage report: cost by feature, bundles split by cost, leaks with figures. —
const usage = [
  { customer: 'Cowan Consultancy Ltd', product: 'Webroot Endpoint Protection', feature: 'security', quantity: 17, usd: 20.4 },
  { customer: 'Cowan Consultancy Ltd', product: 'Acronis Cyber Protect - Workstation', feature: 'backup', quantity: 1, usd: 60 },
  { customer: 'Cowan Consultancy Ltd', product: 'Keeper Business', feature: 'passwords', quantity: 2, usd: 5.24 },
  { customer: 'Daron Motors', product: 'Acronis Hosted Storage (GB)', feature: 'backup', quantity: 308, usd: 12.32 },
  { customer: 'Wired Services', product: 'Webroot Endpoint Protection', feature: 'security', quantity: 3, usd: 3.6 },
  { customer: 'Gecko IT Services', product: 'Webroot Endpoint Protection', feature: 'security', quantity: 5, usd: 6 }
];
const withUsage = ateraMonth({ month: '2026-09', bill: bm[1], usage, invoices, agents, today: '2026-09-30' });
const rate = 845.91 / 1089.29;
const cowan = withUsage.clients.find(c => c.name === 'Cowan Consultancy');
assert.deepEqual(cowan.ateraNames, ['Cowan Consultancy Ltd', 'Cowan Consultancy'], 'Atera’s “Ltd” spelling joins the Xero contact');
assert.equal(cowan.costUsdTotal, 85.64);
assert.equal(cowan.cost, Math.round(85.64 * rate * 100) / 100);
assert.equal(cowan.saleByFeature.remote, 0, 'remote costs nothing here, so the bundle gives it nothing');
assert.equal(Math.round((cowan.saleByFeature.backup + cowan.saleByFeature.security) * 100) / 100, 323.05, 'the bundle splits by cost between backup and security');
assert.ok(cowan.saleByFeature.backup > cowan.saleByFeature.security);
const daron = withUsage.clients.find(c => c.name === 'Daron Motors');
assert.ok(withUsage.leaks.some(l => l.kind === 'unbilled' && l.client === 'Wired Services' && l.perMonth === Math.round(3.6 * rate * 100) / 100));
assert.ok(withUsage.leaks.some(l => l.kind === 'unbilled_feature' && l.client === 'Cowan Consultancy' && l.text.startsWith('Passwords')), 'Keeper is in Atera but on no Cowan line');
assert.ok(!withUsage.leaks.some(l => l.kind === 'below_cost' && l.client === 'Daron Motors'), `Daron is charged £10 for £${daron.cost} of backup`);
assert.ok(withUsage.leaks.some(l => l.kind === 'own' && l.client === 'Gecko IT Services'));
assert.ok(!withUsage.leaks.some(l => l.kind === 'devices_unbilled'), 'with a report the real cost replaces the device guess');
const sec = withUsage.features.find(f => f.key === 'security');
assert.equal(sec.cost, Math.round(30 * rate * 100) / 100, 'feature cost includes Gecko’s own seats');
assert.equal(withUsage.features.find(f => f.key === 'management').cost, 298.18, 'management is paid for by the technician seats');

// — A month whose seats charge hasn't come yet still shows the seat offer, from the last seats charge. —
const oct = ateraMonth({ month: '2026-10', bill: bm[0], usage: null, invoices, agents, today: '2026-10-11', lastSeats: { usd: 378, techs: 2 } });
assert.equal(oct.leaks.find(l => l.kind === 'seat_offer').usd, 91.8);
assert.equal(oct.cost, 569.22, 'October’s bill so far is the add-ons only');

// — Why it went up. —
const prev = [
  { customer: 'Cowan Consultancy Ltd', product: 'Webroot Endpoint Protection', feature: 'security', quantity: 15, usd: 18 },
  { customer: 'Cowan Consultancy Ltd', product: 'Acronis Cyber Protect - Workstation', feature: 'backup', quantity: 1, usd: 60 },
  { customer: 'Old Client', product: 'Webroot Endpoint Protection', feature: 'security', quantity: 4, usd: 4.8 }
];
const ch = usageChanges(usage, prev, v => v);
assert.equal(ch.lines[0].customer, 'Daron Motors', 'biggest change first');
const cw = ch.lines.find(l => l.customer.startsWith('Cowan') && l.feature === 'security');
assert.deepEqual([cw.qtyBefore, cw.qtyAfter, cw.diff, cw.state], [15, 17, 2.4, 'up']);
assert.equal(ch.lines.find(l => l.customer === 'Old Client').state, 'gone');
assert.equal(ch.total.usd, Math.round((107.56 - 82.8) * 100) / 100);
assert.equal(usageChanges(usage, null), null);

console.log('atera-costs: all tests passed');
