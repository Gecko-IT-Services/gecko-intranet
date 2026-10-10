import assert from 'node:assert/strict';
import { isServer, isWin10, daysSince, ateraBilling, deviceSummary, devicesFor } from '../src/core/devices.js';

const today = '2026-10-11';
assert.equal(isServer({ device_type: 'Server', os: 'Microsoft Windows Server 2019 Standard' }), true);
assert.equal(isServer({ device_type: 'Domain Controller' }), true);
assert.equal(isServer({ device_type: 'Work Station', os: 'Microsoft Windows 11 Pro' }), false);
assert.equal(isWin10({ os: 'Microsoft Windows 10 Pro' }), true);
assert.equal(isWin10({ os: 'Microsoft Windows 11 Pro' }), false);
assert.equal(isWin10({ os: 'Microsoft Windows 10.0 Server' }), false, '"10.0" is not Windows 10');
assert.equal(daysSince('2026-09-01T10:00:00Z', today), 40);
assert.equal(daysSince('2026-10-11T08:00:00Z', today), 0);
assert.equal(daysSince(null, today), null);

const invoices = [
  { contact_name: 'Cowan Consultancy', invoice_date: '2026-10-01', status: 'AUTHORISED', line_items: [
    { item_code: 'Atera - Internet Security', description: 'Atera - Internet Security & Backup & Work from Home (x5)', quantity: 1, unit_amount: 323.05, line_amount: 323.05 },
    { item_code: 'M365', description: 'M365', quantity: 14, unit_amount: 17.36, line_amount: 243.04 }] },
  { contact_name: 'MSA Safety', invoice_date: '2026-10-01', status: 'PAID', line_items: [
    { item_code: 'Atera - Cloud Backup', description: 'Acronis/M365 - Cloud Backup', quantity: 6, unit_amount: 8.95, line_amount: 53.7 },
    { item_code: 'Atera - Internet Security', description: 'Atera - Internet Security Suite', quantity: 7, unit_amount: 5.5, line_amount: 38.5 }] },
  { contact_name: 'Daron Motors', invoice_date: '2026-10-01', status: 'DRAFT', line_items: [{ item_code: 'Atera - Cloud Backup', line_amount: 381.45 }] },
  { contact_name: 'Cowan Consultancy', invoice_date: '2026-09-01', status: 'PAID', line_items: [{ item_code: 'Atera - Internet Security', line_amount: 300 }] }
];
const bill = ateraBilling(invoices, '2026-10');
assert.deepEqual([...bill.keys()], ['Cowan Consultancy', 'MSA Safety'], 'drafts and other months left out');
assert.equal(bill.get('MSA Safety').billed, 92.2);
assert.equal(bill.get('Cowan Consultancy').billed, 323.05, 'M365 lines are not Atera');

const a = (id, customer_name, machine_name, device_type, os, last_seen, online = true) => ({ agent_id: id, customer_name, machine_name, device_type, os, last_seen, online });
const agents = [
  a(1, 'Cowan Consultancy Ltd', 'SRV-DC01', 'Server', 'Microsoft Windows Server 2019 Standard', '2026-10-11T07:00:00Z'),
  a(2, 'Cowan Consultancy Ltd', 'CCL-LAP1', 'Work Station', 'Microsoft Windows 10 Pro', '2026-10-10T07:00:00Z'),
  a(3, 'Cowan Consultancy Ltd', 'CCL-OLD', 'Work Station', 'Microsoft Windows 10 Pro', '2026-08-01T07:00:00Z', false),
  a(4, 'MSA Safety', 'MSA-1', 'Work Station', 'Microsoft Windows 11 Pro', '2026-10-11T07:00:00Z'),
  a(5, 'Gecko IT Services', 'GECKO-1', 'Work Station', 'Microsoft Windows 11 Pro', '2026-10-11T07:00:00Z'),
  a(6, 'Gecko IT Services', 'GECKO-2', 'Work Station', 'Microsoft Windows 11 Pro', null)
];
const s = deviceSummary(agents, bill, today);
assert.deepEqual(s.clients.map(c => [c.name, c.devices, c.flags.join('+')]), [
  ['Cowan Consultancy Ltd', 3, 'win10+stale'], ['Gecko IT Services', 2, ''], ['MSA Safety', 1, '']
], 'most flags first; Atera’s “Ltd” still matches the Xero contact; Gecko’s own machines are never “not billed”');
assert.equal(s.clients[1].internal, true);
const cowan = s.clients[0];
assert.deepEqual([cowan.servers, cowan.workstations, cowan.win10, cowan.stale, cowan.offline, cowan.billed], [1, 2, 2, 1, 1, 323.05]);
assert.equal(cowan.agents[0].machine_name, 'SRV-DC01', 'servers first');
assert.deepEqual(s.totals, { devices: 6, servers: 1, workstations: 5, win10: 2, stale: 1, clients: 3, notBilled: 0, billed: 415.25 });
assert.equal(devicesFor(s, 'Cowan Consultancy').devices, 3);
assert.equal(devicesFor(s, 'Kingdom Products'), null);

const noBill = deviceSummary([a(9, 'Haus Coast Ltd', 'HC-1', 'Work Station', 'Microsoft Windows 11 Pro', '2026-10-11T07:00:00Z')], bill, today);
assert.deepEqual(noBill.clients[0].flags, ['not_billed'], 'a client with devices and no Atera billing is flagged');

// Atera spells some customers differently from Xero (live data, 11 Oct).
const pm = deviceSummary([a(10, 'P&M Packing', 'PM-1', 'Work Station', 'Microsoft Windows 11 Pro', '2026-10-11T07:00:00Z')],
  ateraBilling([{ contact_name: 'PM Packing', invoice_date: '2026-10-01', status: 'PAID', line_items: [{ item_code: 'Atera - Internet Security', line_amount: 111.33 }] }], '2026-10'), today);
assert.deepEqual([pm.clients[0].billed, pm.clients[0].flags], [111.33, []], 'P&M Packing in Atera is PM Packing in Xero');
assert.equal(devicesFor(pm, 'PM Packing').devices, 1, 'and its client page finds the devices');

console.log('devices: all tests passed');
