import assert from 'node:assert/strict';
import { win11Cpu, deviceFindings, upgrades, taskFor } from '../src/core/upgrades.js';

// — Windows 11 processors: Intel 8th gen+, Core Ultra, Ryzen 2000+. —
assert.equal(win11Cpu('Intel(R) Core(TM) i5-7200U CPU @ 2.50GHz'), false);
assert.equal(win11Cpu('Intel(R) Core(TM) i5-4440 CPU @ 3.10GHz'), false);
assert.equal(win11Cpu('Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz'), true);
assert.equal(win11Cpu('Intel(R) Core(TM) i7-14700T'), true, 'five-digit model: 14th gen');
assert.equal(win11Cpu('Intel(R) Core(TM) Ultra 5 235T'), true);
assert.equal(win11Cpu('AMD Ryzen 5 3500U with Radeon Vega Mobile Gfx'), true);
assert.equal(win11Cpu('AMD Ryzen 7 1700 Eight-Core Processor'), false);
assert.equal(win11Cpu('Intel(R) Pentium(R) CPU G4560'), false);
assert.equal(win11Cpu('Intel(R) Xeon(R) CPU E5-2620'), null, 'can’t tell');

// — Findings, on real machines from 18 Oct 2026. —
const today = '2026-10-18';
const dev = (os, raw = {}, extra = {}) => ({ os, raw, machine_name: 'PC', ...extra });
const texts = d => deviceFindings(d, today).map(f => `${f.level} ${f.what}: ${f.fix}`);
// WCF's PAULAPCNEW: Windows 10 on a 2013 i5-4440 with Office 2013 → replace.
assert.deepEqual(texts(dev('Microsoft Windows 10 Pro  x64', { Processor: 'Intel(R) Core(TM) i5-4440 CPU @ 3.10GHz', Office: 'Microsoft Office Standard 2013', OfficeFullVersion: '15.0.4569.1506', Memory: '8125', BiosReleaseDate: '2013-11-08T00:00:00Z' })),
  ['asap Windows: Replace: the processor can’t run Windows 11', 'asap Office: Move to Microsoft 365 apps (or Office LTSC 2024)']);
// Windows 10 on an 8th-gen PC → free upgrade.
assert.match(texts(dev('Microsoft Windows 10 Pro  x64', { Processor: 'Intel(R) Core(TM) i5-8500' }))[0], /asap Windows: Upgrade to Windows 11 \(free/);
// Windows 11 24H2 Pro: no updates since 13 Oct 2026 → the latest update. 25H2 is fine. Enterprise has longer.
assert.match(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26100.6899' }))[0], /asap Windows: Install the latest Windows 11 update/);
assert.deepEqual(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26200.8973' })), []);
assert.deepEqual(texts(dev('Microsoft Windows 11 Enterprise  x64', { OSBuild: '26100.1' })), []);
// Servers.
assert.match(texts(dev('Microsoft Windows Server 2012 R2 Standard  x64'))[0], /asap Windows: Plan a new server/);
assert.match(deviceFindings(dev('Microsoft Windows Server 2016 Standard  x64'), today)[0].text, /support ends 12 Jan 2027/);
assert.equal(deviceFindings(dev('Microsoft Windows Server 2016 Standard  x64'), today)[0].level, 'soon', 'within six months');
assert.match(texts(dev('Microsoft Windows 10 Pro  x64', {}, { machine_name: 'KINGDOMSERVER' }))[0], /Plan a new server/, 'named as a server');
// Office: Atera's name can be stale.
assert.deepEqual(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26200.1', Office: 'Microsoft Office Professional 2013', OfficeFullVersion: '16.0.19127.20800' })), [], 'says 2013, runs 16');
assert.match(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26200.1', Office: 'Microsoft Office Professional Plus 2019' }))[0], /asap Office/);
assert.deepEqual(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26200.1', Office: 'Microsoft Office 365 Business' })), []);
// Hardware.
assert.match(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26200.1', Memory: '4096' }))[0], /soon Memory/);
assert.match(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26200.1', HardwareDisks: '[{"Free": 2000, "Drive": "C:", "Total": 120000}]' }))[0], /soon Disk/);
assert.deepEqual(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26200.1', HardwareDisks: [{ Free: 200000, Drive: 'C:', Total: 2000000 }] })), [], '200 GB free is fine');
assert.match(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '26200.1', BiosReleaseDate: '2018-03-01T00:00:00Z' }))[0], /soon Age/);
assert.match(texts(dev('macOS 15 Catalina x64'))[0], /asap macOS/);
assert.deepEqual(texts(dev('Microsoft Windows 10 IoT Enterprise LTSC  x64')), [], 'LTSC is supported to 2032');

// — Per client. —
const a = (customer_name, machine_name, os, raw, last_seen = '2026-10-17T10:00:00Z') => ({ customer_name, machine_name, os, raw, last_seen, last_user: 'Paula' });
const r = upgrades([
  a('West Country Fires', 'PAULAPCNEW', 'Microsoft Windows 10 Pro  x64', { Processor: 'Intel(R) Core(TM) i5-4440' }),
  a('West Country Fires', 'SAGEPC', 'Microsoft Windows 10 Pro  x64', { Processor: 'Intel(R) Core(TM) i5-10400' }),
  a('West Country Fires', 'DI-PC', 'Microsoft Windows 11 Pro  x64', { OSBuild: '26100.1' }),
  a('West Country Fires', 'NEWPC', 'Microsoft Windows 11 Pro  x64', { OSBuild: '26200.1' }),
  a('West Country Fires', 'OLDLAPTOP', 'Microsoft Windows 10 Pro  x64', {}, '2026-06-01T10:00:00Z'),
  a('MSA Safety', 'D-MSA-05', 'Microsoft Windows 11 Pro  x64', { OSBuild: '22631.1' }),
  a('Gecko IT Services', 'PC', 'Microsoft Windows 10 Pro  x64', {})
], today);
const w = r.clients.find(c => c.name === 'West Country Fires');
assert.deepEqual(w.devices.map(d => [d.name, d.plan]), [['DI-PC', 'update'], ['PAULAPCNEW', 'replace'], ['SAGEPC', 'upgrade']], 'up-to-date PCs left out');
assert.deepEqual([w.asap, w.replace, w.upgrade, w.update], [3, 1, 1, 1]);
assert.deepEqual(r.gone.map(g => g.name), ['OLDLAPTOP'], 'not seen for 30+ days: listed apart');
assert.equal(r.clients.at(-1).name, 'Gecko IT Services', 'Gecko’s own last');
assert.equal(r.totals.asap, 4, 'Gecko’s own not in the totals');
assert.equal(r.totals.clients, 2);
const t = taskFor(w);
assert.equal(t.title, 'Upgrades for West Country Fires: replace 1 PC, upgrade 1 to Windows 11, update 1 Windows 11');
assert.match(t.note, /PAULAPCNEW \(Paula\): Replace/);

// Cowans' Sage PC: Windows 11 21H2 on a 4th-gen i7 → replace, not "update".
assert.match(texts(dev('Microsoft Windows 11 Pro  x64', { OSBuild: '22000.2538', Processor: 'Intel(R) Core(TM) i7-4771 CPU @ 3.50GHz' }))[0], /asap Windows: Replace: Windows 11 on a processor/);
assert.equal(upgrades([{ customer_name: 'C', machine_name: 'SAGEPC', os: 'Microsoft Windows 11 Pro  x64', last_seen: '2026-10-18T10:00:00Z', last_user: 'AzureAD\\ChrisWyeth', raw: { OSBuild: '22000.1', Processor: 'Intel(R) Core(TM) i7-4771' } }], today).clients[0].devices[0].user, 'Chris Wyeth');
assert.equal(upgrades([{ customer_name: 'C', machine_name: 'SAGEPC', os: 'Microsoft Windows 11 Pro  x64', last_seen: '2026-10-18T10:00:00Z', raw: { OSBuild: '22000.1', Processor: 'Intel(R) Core(TM) i7-4771' } }], today).clients[0].devices[0].plan, 'replace');

console.log('upgrades: ok');
