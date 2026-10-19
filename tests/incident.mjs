import assert from 'node:assert/strict';
import { machineFacts, relatedWork, incidentFacts } from '../src/core/incident.js';

// Kelly's PC at Daron Motors as Atera had it on 19 Oct 2026.
const fipc = { machine_name: 'FIPC', customer_name: 'Daron Motors', device_type: 'Work Station', os: 'Microsoft Windows 11 Pro  x64', online: false,
  last_seen: '2026-10-16T16:01:42Z', last_user: 'FIPC\\Office',
  raw: { HardwareDisks: [{ Drive: 'C:', Free: 260333, Total: 487108 }], BiosReleaseDate: '2021-12-01', LastRebootTime: '2026-10-14T05:46:51Z',
    Vendor: 'Lenovo', VendorBrandModel: '11QE003XUK', Processor: 'Intel Core i7-10700', Memory: '7929', OSBuild: '26200.9457' } };
assert.deepEqual(machineFacts(fipc), { name: 'FIPC', type: 'desktop', user: 'Office', os: 'Windows 11 Pro', osBuild: '26200.9457', model: 'Lenovo 11QE003XUK',
  processor: 'Intel Core i7-10700', memoryGb: 8, disks: [{ drive: 'C:', freeGb: 254, totalGb: 476 }], madeAbout: 2021, online: false,
  lastSeen: '2026-10-16T16:01:42Z', lastRestart: '2026-10-14T05:46:51Z' });
assert.equal(machineFacts({ machine_name: 'X', raw: { BatteryInfo: { BatteryHealth: 41 } } }).type, 'laptop');
assert.equal(machineFacts({ machine_name: 'X', raw: { BatteryInfo: { BatteryHealth: 41 } } }).batteryHealth, 41);
assert.equal(machineFacts(null), null);
assert.equal('memoryGb' in machineFacts({ machine_name: 'X', raw: {} }), false, 'unknowns left out, not guessed');

// Timesheet notes about the machine or its user.
const entries = [
  { entry_date: '2026-09-01', title: 'FIPC slow, cleared temp files', work_description: 'FIPC slow, cleared temp files' },
  { entry_date: '2026-10-02', title: 'Kelly printer', work_description: 'Kelly could not print from FIPC' },
  { entry_date: '2026-10-03', title: 'Bob email', work_description: 'Outlook profile' }];
assert.deepEqual(relatedWork(entries, { device: 'FIPC', user: 'Kelly Smith' }).map(e => e.date), ['2026-10-02', '2026-09-01'], 'newest first');
assert.equal(relatedWork(entries, { device: 'FIPC' })[1].note, 'FIPC slow, cleared temp files', 'title and description once when the same');
assert.deepEqual(relatedWork(entries, {}), []);

assert.deepEqual(Object.keys(incidentFacts({ client: 'Daron Motors', machine: machineFacts(fipc), problem: 'Not on this morning', today: '2026-10-19' })),
  ['client', 'today', 'problem', 'details', 'machine', 'recentWorkOnIt']);
console.log('incident: ok');
