import assert from 'node:assert/strict';
import { lineProducts, billing, webrootUse, acronisUse, reconcileAll, PRICE_USD } from '../src/core/reconcile.js';

// — What a repeating-invoice line sells (real descriptions, 18 Oct 2026). —
const p = d => lineProducts({ description: d, item_code: 'Atera - Internet Security' }).sort().join(',');
assert.equal(p('Atera - Internet Security'), 'av');
assert.equal(p('OpenText PC Security (Andrew, Spencer & Richard) PC\'s.'), 'av');
assert.equal(p('Acronis/M365 - Cloud Backup'), 'm365');
assert.equal(p('Atera - Cloud Backup - Office365 & Sharepoint'), 'm365');
assert.equal(p('Atera - Cloud Backup'), 'backup,m365');
assert.equal(p('Atera - Internet Security & Backup & Work from Home (x5)'), 'av,backup,m365,wfh');
assert.equal(p('Atera - Internet Security & Cloud Management'), 'av,backup,m365');
assert.equal(p('Remote IT Support, Defender AV, Windows Backup, Remote Management, Monthly Maintenance Schedules'), 'backup,m365', 'Defender is not Webroot');
assert.equal(p('Password Keeper'), 'keeper');
assert.equal(p('Atera - Work From Home (Rory)'), 'wfh');
assert.equal(p('Atera - Internet Security with DNS Management (1 year)'), 'av,dns');
assert.equal(lineProducts({ description: 'Website Hosting & WordPress Maintenance — security monitoring, backup management', item_code: '' }).length, 0, 'hosting is not Atera');

// — Billing: per-device vs flat, yearly templates. —
const tpl = (id, contact, lines, period = 1) => ({ repeating_invoice_id: id, contact_name: contact, status: 'AUTHORISED', unit: 'MONTHLY', period, next_date: '2026-11-01',
  line_items: lines.map(([description, quantity, unit_amount]) => ({ description, quantity, unit_amount, line_amount: quantity * unit_amount, item_code: 'Atera - Internet Security' })) });
const repeating = [
  tpl('msa', 'MSA Safety', [['Atera - Internet Security Suite', 8, 5.5], ['Password Keeper', 6, 5], ['Acronis/M365 - Cloud Backup', 6, 8.95]]),
  tpl('ons', 'Onsite Commercial Services', [['Atera - Internet Security', 15, 4], ['Atera - Cloud Backup - Office365 & Sharepoint', 1, 65], ['Atera - Work from Home (pam)', 1, 5]]),
  tpl('cow', 'Cowan Consultancy', [['Atera - Internet Security & Backup & Work from Home (x5)', 1, 323.05]]),
  tpl('qm', 'Quality Mouldings', [['Atera - Internet Security', 12, 4.5]], 12),
  tpl('can', 'CanCan Services', [['Atera - Internet Security (Adam and AJ)', 2, 4.5]]),
  tpl('kp', 'Kingdom Products Ltd', [['OpenText PC Security (Andrew, Spencer & Richard) PC\'s.', 3, 4.5]]),
  { ...tpl('old', 'Gone Ltd', [['Atera - Internet Security', 5, 4]]), status: 'DELETED' }
];
const b = billing(repeating);
assert.equal(b.get('MSA Safety').products.av.count, 8);
assert.equal(b.get('Quality Mouldings').products.av.count, 1, 'a yearly template bills 12 × the month');
assert.equal(b.get('Quality Mouldings').monthly, 4.5);
assert.equal(b.get('Cowan Consultancy').products.av.flat.length, 1);
assert.equal(b.has('Gone Ltd'), false, 'only live templates');

// — Live use. —
const now = '2026-10-18T17:00:00Z';
const site = (site_id, name, total, deactivated = false) => ({ site_id, name, raw: { TotalEndpoints: total, Deactivated: deactivated } });
const ep = (site_id, hostname, lastSeen, deactivated = false, mods = '') => ({ site_id, hostname, raw: { LastSeen: lastSeen, Deactivated: deactivated, ActiveModules: mods } });
const webrootSites = [site('s1', 'MSA Safety', 7), site('s2', 'Onsite Commercials', 2), site('s3', 'Cowan Consultancy Limited', 17), site('s4', 'Quality Mouldings', 1),
  site('s5', 'Kingdom Products', 3), site('s6', 'Technix Rubber', 0, true), site('s7', 'Gecko IT', 1)];
const webrootEndpoints = [ep('s1', 'MSA-1', '2026-10-18T09:00:00Z', false, 'DNS'), ep('s1', 'OLD-PC', '2026-08-01T09:00:00Z'), ep('s1', 'GONE', '2026-01-01T09:00:00Z', true)];
const w = webrootUse(webrootSites, webrootEndpoints, now);
assert.deepEqual(w.find(x => x.name === 'MSA Safety').dead.map(d => d.host), ['OLD-PC'], 'deactivated devices are not dead weight');
assert.equal(w.find(x => x.name === 'MSA Safety').dns, 1);
assert.equal(w.some(x => x.name === 'Technix Rubber'), false, 'switched-off sites left out');
const acronisTenants = [{ tenant_id: 'a1', name: 'MSA Safety', kind: 'customer' }, { tenant_id: 'a2', name: 'Cowans', kind: 'customer' }, { tenant_id: 'a3', name: 'Onsite Commercial', kind: 'customer' }];
const u = (tenant_id, name, value) => ({ tenant_id, raw: { name, value } });
const acronisUsage = [u('a1', 'pw_base_m365_seats', 9), u('a2', 'pw_base_m365_seats', 15), u('a2', 'pw_base_workstations', 1), u('a2', 'pw_base_storage', 54e9), u('a3', 'pw_base_m365_seats', 18)];
assert.deepEqual(acronisUse(acronisTenants, acronisUsage).find(x => x.name === 'Cowans'), { name: 'Cowans', workstations: 1, vms: 0, servers: 0, m365: 15, gb: 54 });

// — The reconcile. —
const inputs = [
  { client_name: 'MSA Safety', product: 'keeper', kind: 'in_use', quantity: 4, unit_usd: 5.6 },
  { client_name: 'Cowan Consultancy', product: 'av', kind: 'covered', quantity: 15 },
  { client_name: 'Cowan Consultancy', product: 'm365', kind: 'covered', quantity: 15 }
];
const r = reconcileAll({ repeating, webrootSites, webrootEndpoints, acronisTenants, acronisUsage, inputs, rate: 0.79, now });
const c = name => r.clients.find(x => x.name === name);
const row = (name, product) => c(name).rows.find(x => x.product === product);

assert.equal(row('MSA Safety', 'm365').state, 'leak');
assert.equal(row('MSA Safety', 'm365').gapGbp, 26.85, '3 more seats × £8.95');
assert.deepEqual([row('MSA Safety', 'm365').action.kind, row('MSA Safety', 'm365').action.from, row('MSA Safety', 'm365').action.to], ['repeating', 6, 9]);
assert.match(row('MSA Safety', 'm365').action.url, /invoiceID=msa/);
assert.equal(row('MSA Safety', 'av').state, 'over');
assert.equal(row('MSA Safety', 'keeper').state, 'over');
assert.equal(row('MSA Safety', 'keeper').gapGbp, 10);
assert.equal(c('MSA Safety').dead.length, 1);

assert.equal(row('Onsite Commercial Services', 'av').state, 'over', 'Atera name “Onsite Commercials” matched');
assert.equal(row('Onsite Commercial Services', 'av').gapGbp, 52);
assert.equal(row('Onsite Commercial Services', 'm365').state, 'record');
assert.equal(row('Onsite Commercial Services', 'wfh').state, 'enter', 'billed for Work from home, nothing ticked yet');

assert.equal(row('Cowan Consultancy', 'av').state, 'grown', '17 in use, priced on 15');
assert.equal(row('Cowan Consultancy', 'av').gapUnits, 2);
assert.equal(row('Cowan Consultancy', 'm365').state, 'ok');
assert.equal(row('Cowan Consultancy', 'backup').state, 'record');

assert.equal(row('CanCan Services', 'av').state, 'check');
assert.equal(row('Quality Mouldings', 'av').state, 'ok');
assert.equal(row('Kingdom Products Ltd', 'av').state, 'ok', '“Kingdom Products” in Webroot');
assert.equal(c('Gecko IT').rows.every(x => x.state === 'ok'), true, 'Gecko’s own is never a leak');

assert.equal(row('MSA Safety', 'dns').state, 'unbilled', 'DNS protection in use, not on the invoice');
assert.equal(r.totals.leakGbp, 26.85 + 0.95);
assert.equal(r.totals.overGbp, 5.5 + 10 + 52 + 9);
assert.equal(r.clients[0].issues > 0, true, 'clients with something to do first');
assert.equal(r.clients.at(-1).issues, 0);
assert.ok(PRICE_USD.av === 1.2 && PRICE_USD.wfh === 5);

console.log('reconcile: ok');
