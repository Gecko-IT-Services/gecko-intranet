import assert from 'node:assert/strict';
import { coverage, coverageFor, machineKey, workingHoursSince, gb, STALE_WORKING_HOURS } from '../src/core/coverage.js';

// — Names: one machine, three spellings. —
assert.equal(machineKey('FPServer.wcf.local'), 'fpserver');
assert.equal(machineKey('FPSERVER'), 'fpserver');
assert.equal(machineKey('FP Server'), 'fpserver');

// — Working hours: a weekend doesn't count against a Mon–Fri plan. —
assert.equal(workingHoursSince('2026-10-16T22:00:00Z', '2026-10-19T09:00:00Z'), 11, 'Fri 22:00 → Mon 09:00');
assert.equal(workingHoursSince('2026-10-14T22:00:00Z', '2026-10-16T22:00:00Z'), 48);
assert.equal(workingHoursSince(null, '2026-10-19T09:00:00Z'), Infinity);
assert.equal(gb(21e6), '21 MB');
assert.equal(gb(1.3e9), '1.3 GB');

// — The live picture on 18 Oct 2026, cut down. —
const now = '2026-10-18T16:00:00Z';
const tenants = [
  { tenant_id: 'wcf', name: 'West Country Fires', kind: 'customer' },
  { tenant_id: 'reg', name: 'Regals', kind: 'customer' },
  { tenant_id: 'dar', name: 'Daron Ford Motors', kind: 'customer' },
  { tenant_id: 'cow', name: 'Cowans', kind: 'customer' },
  { tenant_id: 'sg', name: 'Southern Glass', kind: 'customer' },
  { tenant_id: 'gecko', name: 'Gecko IT', kind: 'customer' },
  { tenant_id: 'folder', name: 'Some folder', kind: 'folder' }
];
const status = (tenant_id, name, opts = {}) => ({ kind: 'resource_status', tenant_id, raw: {
  context: { name, type: opts.vm ? 'resource.virtual_machine.vmwesx' : 'resource.machine', agent_id: opts.agent || null },
  aggregate: opts.plan ? { names: opts.plan, status: opts.state || 'idle' } : { status: 'no_policies_applied' },
  policies: opts.plan ? [{ last_success_run: opts.ok || null, last_run: opts.ok || null, next_run: '2026-10-19T21:00:00Z' }] : []
} });
const agent = (tenant_id, id, online, version) => ({ kind: 'agent', tenant_id, raw: { id, online, core_version: { current: { release_id: version } } } });
const usage = (tenant_id, name, value) => ({ kind: 'usage', tenant_id, raw: { name, value } });
const items = [
  status('wcf', 'FPServer.wcf.local', { plan: 'Sage PC', ok: '2026-10-18T15:26:18Z', agent: 'a1' }),
  status('wcf', 'Tserver.wcf.local', { plan: 'Sage PC', ok: '2026-04-18T19:40:39Z', state: 'running', agent: 'a2' }),
  status('wcf', 'SagePC', { plan: 'Sage PC', ok: '2026-10-16T21:32:06Z', agent: 'a3' }),
  status('wcf', 'Tserver', { vm: true }),                // the same VM through ESXi: same name
  status('wcf', 'File Server', { vm: true }),            // FPServer through ESXi: SAME_MACHINE
  agent('wcf', 'a1', true, '25.1.0'), agent('wcf', 'a2', false, '25.1.0'), agent('wcf', 'a3', true, '26.9.0'),
  status('reg', 'DESKTOP-PDS8SB8', { plan: 'Office PC', ok: '2026-06-02T17:18:25Z', state: 'critical', agent: 'r1' }),
  agent('reg', 'r1', false, '26.2.0'),
  usage('dar', 'pw_base_m365_seats', 12), usage('dar', 'pw_base_m365_sharepoint_sites', 6), usage('dar', 'unprotected_site_collection_storage', 21e6),
  usage('cow', 'pw_base_m365_seats', 15), usage('cow', 'pw_base_m365_sharepoint_sites', 0),
  usage('sg', 'pw_base_m365_seats', 10), usage('sg', 'pw_base_m365_sharepoint_sites', 5), usage('sg', 'unprotected_group_site_storage', 1.3e9),
  usage('gecko', 'pw_base_m365_seats', 0),
  { kind: 'alert', tenant_id: 'reg', raw: {} },
  { kind: 'resource_status', tenant_id: 'wcf', raw: { context: { name: 'Microsoft SQL', type: 'resource.group.mssql_server' } } }
];
const atera = [
  { customer_name: 'West Country Fires', machine_name: 'FPSERVER', device_type: 'Domain Controller', online: true },
  { customer_name: 'West Country Fires', machine_name: 'TSERVER', device_type: 'Server', online: true },
  { customer_name: 'Daron Motors', machine_name: 'DCSERVER', device_type: 'Domain Controller', online: true },
  { customer_name: 'Daron Motors', machine_name: 'RECEPTION', device_type: 'Work Station', online: true },
  { customer_name: 'Haus Builders', machine_name: 'HB-SRV', device_type: 'Server', online: true },
  { customer_name: 'Gecko IT', machine_name: 'GECKO-SRV', device_type: 'Server', online: true }
];
const r = coverage(tenants, items, atera, now);
const c = name => r.clients.find(x => x.name === name);
const texts = name => c(name).issues.map(i => `${i.level} ${i.what}: ${i.text}`);

const wcf = c('West Country Fires');
assert.deepEqual(wcf.machines.map(m => m.name), ['FPServer.wcf.local', 'Tserver.wcf.local', 'SagePC'], 'host VMs shown once, as their machines; groups ignored');
assert.equal(wcf.level, 'red');
assert.ok(texts('West Country Fires').includes('red Tserver.wcf.local: No good backup since 2026-04-18 (backing up now)'));
assert.ok(texts('West Country Fires').some(t => /^red Tserver\.wcf\.local: Acronis agent offline while the machine is on/.test(t)), 'agent offline + Atera online = the stopped-service case');
assert.ok(texts('West Country Fires').includes('amber FPServer.wcf.local: Acronis agent out of date (25.1.0)'));
assert.ok(!texts('West Country Fires').some(t => /FPSERVER|TSERVER/.test(t)), 'servers backed up under another spelling are not flagged');
assert.ok(texts('West Country Fires').includes('info Microsoft 365: No Microsoft 365 backup in Acronis'));

assert.ok(texts('Regals').includes('red DESKTOP-PDS8SB8: No good backup since 2026-06-02'));
assert.ok(texts('Regals').includes('amber DESKTOP-PDS8SB8: Machine offline in Acronis and Atera'));
assert.equal(c('Regals').alerts, 1);

assert.ok(texts('Daron Ford Motors').includes('red DCSERVER: Domain Controller in Atera with no Acronis backup'), 'Atera name "Daron Motors" matched');
assert.ok(!texts('Daron Ford Motors').some(t => /RECEPTION/.test(t)), 'workstations without backup are not flagged');
assert.ok(texts('Daron Ford Motors').includes('info SharePoint: 21 MB not backed up (usually system sites)'));

assert.ok(texts('Cowans').includes('red SharePoint: Microsoft 365 is in Acronis but no SharePoint sites are backed up'), 'Philip’s rule: SharePoint always');
assert.ok(texts('Southern Glass').some(t => /^amber SharePoint: 1\.3 GB of SharePoint isn’t backed up/.test(t)));
assert.equal(c('Gecko IT').level, 'ok', 'Gecko’s own: no "no M365 backup" line');

assert.ok(texts('Haus Builders').includes('red HB-SRV: Server in Atera; this client has no Acronis backup at all'));
assert.equal(r.clients.find(x => x.name === 'Gecko IT').issues.some(i => /GECKO-SRV/.test(i.what)), false, 'Gecko’s own servers are not chased');
assert.equal(r.clients.some(x => x.name === 'Some folder'), false, 'only customers');

assert.deepEqual(r.clients.slice(0, 1).map(x => x.level), ['red'], 'worst first');
assert.ok(r.clients.findIndex(x => x.level === 'ok') > r.clients.findIndex(x => x.level === 'amber'));
assert.equal(r.totals.machines, 4);
assert.equal(r.totals.protected, 2, 'stale backups don’t count as protected');
assert.equal(coverageFor(r, 'Daron Motors')?.name, 'Daron Ford Motors');
assert.equal(coverageFor(r, 'Cowan Consultancy')?.name, 'Cowans');

// Good on Friday night, checked on Monday morning: not stale.
const mon = coverage(tenants, [status('wcf', 'SagePC', { plan: 'Sage PC', ok: '2026-10-16T21:32:06Z' })], [], '2026-10-19T09:00:00Z');
assert.equal(mon.clients.find(x => x.name === 'West Country Fires').machines[0].stale, false);
assert.ok(STALE_WORKING_HOURS >= 48);

console.log('coverage: ok');
