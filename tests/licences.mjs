import assert from 'node:assert/strict';
import { xeroProduct, xeroSeats, tdProduct, isLicenceLine, licenceMonths, xeroLicences, licenceCheck, suggestRate } from '../src/core/licences.js';

// Xero line text → product (real descriptions from Oct 2026)
const p = s => xeroProduct(s);
assert.equal(p('M365 Subscription - Business Standard'), 'bstd');
assert.equal(p('Microsoft 365 Business Standard'), 'bstd');
assert.equal(p('M365 Subscription - Business Basic'), 'bbasic');
assert.equal(p('M365 Subscription - Basic'), 'bbasic');
assert.equal(p('M365 Subscription - Business Premium (monthly), 13–31 Oct 2026'), 'bprem');
assert.equal(p('M365 Subscription - Exchange Online Plan 1'), 'exo1');
assert.equal(p('Microsoft 365 - Exchange Plan 1 (50gb)'), 'exo1');
assert.equal(p('M365 Subscription - Hosted Microsoft Exchange 50Gb + archiving'), 'exo1', 'hosted Exchange with archiving is Plan 1');
assert.equal(p('Microsoft Hosted Exchange Email'), 'exo1');
assert.equal(p('M365 Subscription - Exchange Plan 2 (100gb)'), 'exo2');
assert.equal(p('Exchange Online Plan 2 - Increased Mailbox for SD'), 'exo2');
assert.equal(p('M365 Exchange Archiving'), 'archive');
assert.equal(p('1TB Business & Share account'), 'onedrive');
assert.equal(p('One Drive 1TB Business & Sharepoint'), 'onedrive');
assert.equal(p('M365 Subscription'), '', 'names no product');
assert.equal(p('M365 Subscription - msasafety.co.uk'), '');

assert.equal(tdProduct({ mfpn: 'CFQ7TTC0LDPB:0001' }), 'bstd');
assert.equal(tdProduct({ mfpn: 'CFQ7TTC0LH18:000P', product: 'S/Microsoft 365 Business Basic no Teams' }), 'bbasic');
assert.equal(tdProduct({ mfpn: 'ZZZ', product: 'S/Exchange Online Plan 1' }), 'exo1', 'falls back to the name');
assert.equal(isLicenceLine({ item_code: 'M365' }), true);
assert.equal(isLicenceLine({ item_code: 'Atera - Cloud Backup' }), false, 'Acronis/M365 backup is not a licence');

// Lump lines are opened up when the text says how many
assert.deepEqual(xeroSeats({ description: 'M365 - Business Standard x 3', quantity: 1, unit_amount: 33.72, line_amount: 33.72 }),
  [{ product: 'bstd', seats: 3, unit: 11.24, total: 33.72, lump: false }]);
const technix = xeroSeats({ description: 'Microsoft 365 Licences — (13 seats: 8x Business Standard, 4x Exchange Online Plan 2, 1x Exchange Online Plan 1)', quantity: 1, unit_amount: 155.68, line_amount: 155.68 });
assert.deepEqual(technix.map(x => [x.product, x.seats, x.lump]), [['bstd', 8, true], ['exo2', 4, true], ['exo1', 1, true]]);
assert.deepEqual(xeroSeats({ description: 'M365 Subscription - Exchange Plan 1', quantity: 2, unit_amount: 9.52, line_amount: 19.04 }),
  [{ product: 'exo1', seats: 2, unit: 9.52, total: 19.04, lump: false }]);

const inv = (contact, number, lines, date = '2026-09-01', status = 'AUTHORISED') => ({
  contact_name: contact, invoice_number: number, invoice_date: date, status,
  line_items: lines.map(([description, quantity, unit_amount, item_code = 'M365']) => ({ description, quantity, unit_amount, line_amount: Math.round(quantity * unit_amount * 100) / 100, item_code }))
});
const invoices = [
  inv('ALS Locksmiths', 'INV-1', [['M365 Subscription - Business Standard', 4, 17.92], ['M365 Subscription - Exchange Online Plan 1', 5, 10.02], ['IT support', 1, 100, 'SUPPORT']]),
  inv('Freeston Water Treatment', 'INV-2', [['M365 Subscription - Business Standard', 14, 17.92], ['M365 Subscription - Business Basic', 8, 7.84]]),
  inv('CDA Ltd', 'INV-3', [['M365 Subscription', 7, 17.55]]),
  inv('Technix Rubber & Plastics Ltd', 'INV-4', [['Microsoft 365 Licences — (13 seats: 8x Business Standard, 4x Exchange Online Plan 2, 1x Exchange Online Plan 1)', 1, 155.68]]),
  inv('H2O Homes Ltd', 'INV-5', [['M365 Subscription - Exchange Plan 2', 2, 8.5]]),
  inv('MSA Safety', 'INV-6', [['Acronis/M365 - Cloud Backup', 6, 8.95, 'Atera - Cloud Backup']]),
  inv('Wired Services', 'INV-7', [['M365 Subscription - Business Standard', 2, 17.5]], '2026-09-01', 'DRAFT'),
  inv('ALS Locksmiths', 'INV-0', [['M365 Subscription - Business Standard', 4, 17.92]], '2026-08-01')
];
const xl = xeroLicences(invoices, '2026-09');
assert.deepEqual(xl.map(x => x.contact), ['ALS Locksmiths', 'Freeston Water Treatment', 'CDA Ltd', 'Technix Rubber & Plastics Ltd', 'H2O Homes Ltd'], 'M365 item code only; drafts and other months left out');

// Cost only (today's feed): per client TD cost vs Xero revenue
const costFeed = { cspInvoices: [
  { invoice: '8284668977', date: '2026-09-16', netTotal: 196.38, customers: [
    { customer: 'ALS Locksmiths', client: 'ALS Locksmiths', cost: 47.5 },
    { customer: 'Freeston Water Treatment', client: 'Freeston Water Treatment', cost: 134.86 },
    { customer: 'Solent Rewinds', client: 'Solent Rewinds', cost: 14.02 }
  ] },
  { invoice: 'old', date: '2026-08-20', netTotal: 1, customers: [{ customer: 'X', cost: 1 }] }
] };
assert.deepEqual(licenceMonths(costFeed), ['2026-09', '2026-08']);
const c1 = licenceCheck(costFeed, invoices, '2026-09');
assert.equal(c1.detail, false);
const als = c1.clients.find(c => c.client === 'ALS Locksmiths');
assert.equal(als.xeroRevenue, 121.78);
assert.equal(als.margin, 74.28);
assert.equal(als.marginPct, 61);
assert.equal(c1.clients[0].client, 'Solent Rewinds', 'biggest gap first');
assert.deepEqual(c1.clients[0].rows.map(r => [r.type, r.worth]), [['UNBILLED_CLIENT', 14.02]]);
assert.equal(c1.clients.find(c => c.client === 'H2O Homes Ltd').rows[0].type, 'NO_TD_LINE');
assert.equal(c1.totals.tdCost, 196.38);
assert.equal(c1.totals.worth, 14.02);
assert.equal(c1.clients.find(c => c.client === 'Technix Rubber & Plastics Ltd').xeroRevenue, 155.68, 'a lump line counts once');

// Seat detail
const sku = (mfpn, seats, unitCost, commitment = 'Annual') => ({ mfpn, seats, unitCost, total: Math.round(seats * unitCost * 100) / 100, commitment });
const seatFeed = { cspInvoices: [{ invoice: '8284668977', date: '2026-09-16', netTotal: 0, customers: [
  { customer: 'ALS Locksmiths', client: 'ALS Locksmiths', skus: [sku('CFQ7TTC0LDPB:0001', 5, 8.4638), sku('CFQ7TTC0LH16:0001', 5, 2.7303)] },
  { customer: 'Freeston Water Treatment', client: 'Freeston Water Treatment', skus: [sku('CFQ7TTC0LDPB:0001', 10, 8.4638), sku('CFQ7TTC0LDPB:0001', 4, 10.8895, 'Month'), sku('CFQ7TTC0LH18:0001', 8, 4.0534), sku('CFQ7TTC0LH16:0001', 6, 2.7303)] },
  { customer: 'CDA Ltd', client: 'CDA Ltd', skus: [sku('CFQ7TTC0LDPB:0001', 7, 8.4638)] },
  { customer: 'Technix Rubber & Plastics', client: 'Technix Rubber & Plastics Ltd', skus: [sku('CFQ7TTC0LDPB:0001', 8, 8.4638), sku('CFQ7TTC0LH1P:0001', 3, 5.471), sku('CFQ7TTC0LH16:0001', 1, 2.7303)] },
  { customer: 'Solent Rewinds', client: 'Solent Rewinds', skus: [sku('CFQ7TTC0LH16:0001', 1, 2.7303)] }
].map(c => ({ ...c, cost: Math.round(c.skus.reduce((s, x) => s + x.total, 0) * 100) / 100 })) }] };
const c2 = licenceCheck(seatFeed, invoices, '2026-09', c1);
assert.equal(c2.detail, true);
const rows = name => c2.clients.find(c => c.client === name).rows.map(r => [r.product, r.type, r.tdSeats ?? null, r.xeroSeats ?? null, r.worth]);
assert.deepEqual(rows('ALS Locksmiths'), [['bstd', 'SEAT_SHORT', 5, 4, 17.92], ['exo1', 'MATCH', 5, 5, 0]]);
const alsFix = c2.clients.find(c => c.client === 'ALS Locksmiths').rows[0].fix;
assert.deepEqual(alsFix, { invoice: 'INV-1', line: 'M365 Subscription - Business Standard', from: 4, to: 5, unit: 17.92 }, 'their own rate × TD seats');
assert.deepEqual(rows('Freeston Water Treatment'), [['bstd', 'MATCH', 14, 14, 0], ['bbasic', 'MATCH', 8, 8, 0], ['exo1', 'UNBILLED_SKU', 6, 0, 16.38]],
  'annual and monthly subscriptions of one product add up');
assert.deepEqual(c2.clients.find(c => c.client === 'Freeston Water Treatment').monthly, ['Business Standard'], 'monthly commitment is reported');
assert.deepEqual(rows('CDA Ltd'), [['bstd', 'MATCH', 7, 7, 0]], 'an unnamed “M365 Subscription” line covers what is left when the seats agree');
assert.deepEqual(rows('Technix Rubber & Plastics Ltd'), [['bstd', 'MATCH', 8, 8, 0], ['exo2', 'SEAT_OVER', 3, 4, 0], ['exo1', 'MATCH', 1, 1, 0]], 'lump line opened up');
assert.deepEqual(rows('Solent Rewinds'), [['exo1', 'UNBILLED_CLIENT', 1, null, 2.73]]);
assert.equal(c2.clients.find(c => c.client === 'Solent Rewinds').rows[0].cause, 'repeat', 'not billed last month either');
assert.equal(c2.clients.find(c => c.client === 'ALS Locksmiths').rows[0].cause, 'new this month');
assert.deepEqual(rows('H2O Homes Ltd'), [['exo2', 'NO_TD_LINE', null, 2, 0]]);
assert.equal(c2.clients[0].client, 'ALS Locksmiths', 'sorted by £ difference');

// Rate suggestions for a product the client isn't billed for
assert.deepEqual(suggestRate(c2, 'Freeston Water Treatment', 'exo1', 2.7303), { unit: 5.33, rule: 'their own mark-up on other licences (× 1.95)' });
assert.deepEqual(suggestRate(c2, 'Solent Rewinds', 'exo1', 2.7303), { unit: 10.02, rule: 'median across clients (1)' });
assert.deepEqual(suggestRate(c2, 'ALS Locksmiths', 'bstd', 8.46), { unit: 17.92, rule: 'their own rate for this product' });

console.log('licences: all tests passed');
