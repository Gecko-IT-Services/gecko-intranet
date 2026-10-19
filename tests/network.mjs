import assert from 'node:assert/strict';
import { publicKey, lanOf, sites, lensOf, drawing, machine } from '../src/core/network.js';

assert.equal(publicKey('31.10.43.54'), '31.10.43.54');
assert.equal(publicKey('2a00:8b40:b765:0:2cbc:be23:93d1:b12c'), '2a00:8b40:b765::');
assert.equal(publicKey(''), '');
assert.equal(lanOf('["10.0.0.85"]'), '10.0.0.x');
assert.equal(lanOf('["10.0.0.39", "172.20.176.1"]'), '10.0.0.x');
assert.equal(lanOf(['172.20.176.1']), '', 'a Hyper-V/WSL gateway is not an office network');
assert.equal(lanOf('["10.99.0.2", "192.168.0.39"]'), '10.99.0.x');

// Cowans as Atera had it on 19 Oct 2026 (trimmed).
const today = '2026-10-19';
const A = (name, pub, lan, extra = {}) => ({ machine_name: name, customer_name: 'Cowan Consultancy', device_type: 'Work Station', os: 'Microsoft Windows 11 Pro  x64', online: false,
  last_seen: '2026-10-18T10:00:00Z', last_user: `AzureAD\\${name}`, raw: { ReportedFromIP: pub, IpAddresses: JSON.stringify([lan]) }, ...extra });
const agents = [
  A('CHRIS-PC', '31.10.43.54', '10.0.0.21', { online: true }), A('CCL-FILE-SERVER', '31.10.43.54', '10.0.0.85'), A('SAGEPC', '31.10.43.54', '10.0.0.16'),
  A('TEKLA', '31.10.43.54', '10.0.0.27', { os: 'Microsoft Windows 10 Pro  x64' }), A('ELVINPC', '31.10.43.54', '10.0.0.39', { last_seen: '2026-07-23T10:00:00Z' }),
  A('WIN-UV3OU45O95Q', '2a00:8b40:b765:0:2cbc:be23:93d1:b12c', '192.168.40.236'), A('DESKTOP-U2CUV24', '2a00:8b40:b765:0:c121:9012:322e:bff1', '192.168.40.27'),
  A('ADAMSLAPTOP', '213.134.184.149', '192.168.0.39', { raw: { ReportedFromIP: '213.134.184.149', IpAddresses: '["192.168.0.39"]', BatteryInfo: { BatteryHealth: 90 } } }),
  A('JACQUIPC', '2a00:8b40:775c:0:109c:a730:1cbe:af7a', '192.168.40.146')];
const l = sites(agents, { today, names: { '31.10.43.54': 'Whiteley office' } });
assert.deepEqual(l.sites.map(s => [s.name, s.named, s.lan, s.machines.map(m => m.name)]), [
  ['Whiteley office', true, '10.0.0.x', ['CCL-FILE-SERVER', 'SAGEPC', 'CHRIS-PC', 'TEKLA', 'ELVINPC']],
  ['Site 2', false, '192.168.40.x', ['DESKTOP-U2CUV24', 'WIN-UV3OU45O95Q']]
], 'biggest first; key PCs first, quiet last; a home with two PCs is a site');
assert.deepEqual(l.remote.map(m => m.name), ['ADAMSLAPTOP', 'JACQUIPC'], 'one machine on a connection: home or remote');
assert.equal(l.remote[0].laptop, true);
assert.equal(l.sites[0].machines.find(m => m.name === 'ELVINPC').quiet, true);

// Lenses.
const tekla = machine(agents[3], today), sage = machine(agents[2], today), adam = l.remote[0];
const ctx = { findings: new Map([['TEKLA', [{ level: 'asap', what: 'Windows' }]], ['SAGEPC', [{ level: 'soon', what: 'Office' }]]]),
  backups: new Map([['sagepc', { protected: true, stale: false, state: 'ok' }], ['cclfileserver', { protected: true, stale: true }]]), av: new Set(['tekla', 'sagepc']) };
assert.deepEqual([lensOf(tekla, 'health', ctx), lensOf(sage, 'health', ctx), lensOf(adam, 'health', ctx)], ['bad', 'warn', 'good']);
const server = { ...machine(agents[1], today), server: true };
assert.deepEqual([lensOf(sage, 'backup', ctx), lensOf(server, 'backup', ctx), lensOf(tekla, 'backup', ctx), lensOf({ ...tekla, server: true }, 'backup', ctx)], ['good', 'bad', 'none', 'bad']);
assert.deepEqual([lensOf(tekla, 'antivirus', ctx), lensOf(adam, 'antivirus', ctx), lensOf({ ...adam, quiet: true }, 'antivirus', ctx)], ['good', 'bad', 'none']);

// The drawing.
const svg = drawing({ client: 'Cowan Consultancy', layout: l, lens: 'health', ctx, cloud: ['Microsoft 365: 15 accounts'], connection: '1Gb ethernet', selected: 'TEKLA' });
assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="nw-svg" viewBox="0 0 960 \d+"/);
assert.match(svg, />Whiteley office<tspan class="nw-s" dx="10">5 machines<\/tspan>/);
assert.match(svg, /1Gb ethernet · Internet 31\.10\.43\.54 · 10\.0\.0\.x/);
assert.match(svg, /class="nw-m nw-bad nw-sel" data-nw-m="TEKLA"/);
assert.match(svg, />Home and remote</);
assert.match(svg, />Cloud services</);
assert.match(svg, /No Windows security updates/);
assert.equal((svg.match(/data-nw-m=/g) || []).length, agents.length, 'every machine drawn once');
assert.doesNotMatch(svg, /<script|undefined|NaN/);
console.log('network: ok');
