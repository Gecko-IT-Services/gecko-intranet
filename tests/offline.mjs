import assert from 'node:assert/strict';
import { uk, isWorkingDay, prevWorkingDay, patchTuesday, notOnYet, reasons, person } from '../src/core/offline.js';

// — Calendar. —
assert.deepEqual(uk('2026-10-19T08:33:00Z'), { day: '2026-10-19', mins: 9 * 60 + 33 }, 'BST');
assert.deepEqual(uk('2026-11-02T09:00:00Z'), { day: '2026-11-02', mins: 9 * 60 }, 'GMT');
assert.equal(isWorkingDay('2026-10-17'), false);
assert.equal(isWorkingDay('2026-12-28'), false, 'bank holiday');
assert.equal(prevWorkingDay('2026-10-19'), '2026-10-16', 'Monday → Friday');
assert.equal(patchTuesday('2026-10'), '2026-10-13');
assert.equal(patchTuesday('2026-12'), '2026-12-08');
assert.equal(person('AzureAD\\ChrisWyeth'), 'Chris Wyeth');
assert.equal(person('DESKTOP-UQFU3FP\\Neil Work (Since: Oct 15, 2026 10:40:27 PM),DESKTOP-UQFU3FP\\Debbie'), 'Neil Work');

// — Kelly's PC at Daron Motors, Monday 19 Oct 2026 (real Atera data). —
const fipc = { agent_id: 1, customer_name: 'Daron Motors', machine_name: 'FIPC', device_type: 'Work Station', os: 'Microsoft Windows 11 Pro', online: false,
  last_seen: '2026-10-16T16:01:42Z', last_user: 'FIPC\\Office', disks: [{ Drive: 'C:', Free: 260333, Total: 487108 }], bios: '2021-12-01', reboot: '2026-10-14T05:46:51Z' };
const mate = { agent_id: 2, customer_name: 'Daron Motors', machine_name: 'RECEPTION', device_type: 'Work Station', online: true, last_seen: '2026-10-19T08:30:00Z' };
const laptop = { agent_id: 3, customer_name: 'Daron Motors', machine_name: 'DIAGNOSTICLPTP', device_type: 'Work Station', online: false, last_seen: '2026-10-16T15:23:03Z', battery: { BatteryHealth: 41 } };
const weekOff = { agent_id: 4, customer_name: 'Daron Motors', machine_name: 'SPARE', device_type: 'Work Station', online: false, last_seen: '2026-10-12T15:00:00Z' };
const server = { agent_id: 5, customer_name: 'Daron Motors', machine_name: 'DCSERVER', device_type: 'Domain Controller', os: 'Windows Server 2012 R2', online: false, last_seen: '2026-10-19T06:00:00Z' };
const agents = [fipc, mate, laptop, weekOff, server];

// No record yet (the first week): judged from "on last working day", amber, and it says it's learning.
let r = notOnYet({ agents, syncedAt: '2026-10-19T08:33:47Z' });
assert.equal(r.state, 'checked');
assert.equal(r.learning, true);
assert.equal(r.learnUntil, '2026-10-26');
assert.deepEqual(r.items.map(i => [i.machine, i.level]), [['DCSERVER', 'red'], ['FIPC', 'amber']],
  'the server first; the PC off since last Monday is not expected; the one on now is fine; laptops wait for the record');
const k = r.items.find(i => i.machine === 'FIPC');
assert.equal(k.user, 'Office');
assert.match(k.reasons.find(x => x.key === 'off').text, /switched off\.$/, 'a shared login is not a person to ask after');
assert.deepEqual(k.reasons.map(x => x.key), ['updates', 'off', 'agent']);
assert.match(k.reasons[0].text, /restarted for this month's Windows updates on Wed 14 Oct \(they came out Tue 13 Oct\)/);
assert.match(k.reasons[0].text, /INACCESSIBLE_BOOT_DEVICE/);
assert.match(reasons(laptop, { last: uk(laptop.last_seen) }).find(x => x.key === 'laptop').text, /41% health/);

// Too early to say before 09:30; servers still count.
r = notOnYet({ agents, syncedAt: '2026-10-19T07:43:00Z' });
assert.equal(r.state, 'early');
assert.deepEqual(r.items.map(i => i.machine), ['DCSERVER']);
// Weekends: servers only.
assert.equal(notOnYet({ agents: [fipc], syncedAt: '2026-10-17T10:00:00Z' }).state, 'closed');

// With a record: on at least 4 of the last 5 working days → red; on now and then → not flagged; its own usual start time.
const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const seen = (id, ds, at = '07:05') => ds.map(d => ({ agent_id: id, day: d, first_seen: `${d}T${at}:00Z`, last_seen: `${d}T16:00:00Z` }));
const filler = Array.from({ length: 10 }, (_, i) => seen(100 + i, days)).flat();   // the rest of the estate, so the days count as recorded
const seenDays = [...seen(1, days), ...seen(4, ['2026-10-12']), ...seen(3, days.slice(0, 2)), ...filler];
r = notOnYet({ agents, seenDays, syncedAt: '2026-10-19T08:33:47Z' });
assert.equal(r.learning, false);
assert.deepEqual(r.items.map(i => [i.machine, i.level, i.expectedBy]), [['DCSERVER', 'red', ''], ['FIPC', 'red', '09:00']],
  'usually on by 08:05 BST, expected by 08:50 but never before 09:00; the laptop on 3 of 5 days is not "usually on"');
// Before its usual time it isn't flagged.
assert.deepEqual(notOnYet({ agents, seenDays, syncedAt: '2026-10-19T07:40:00Z' }).items.map(i => i.machine), ['DCSERVER']);
// Someone who starts at 10:00 isn't flagged at 09:33; is at 10:50.
const late = [...seen(1, days, '09:00'), ...filler];
assert.deepEqual(notOnYet({ agents: [fipc, mate], seenDays: late, syncedAt: '2026-10-19T08:33:47Z' }).items, []);
assert.equal(notOnYet({ agents: [fipc, mate], seenDays: late, syncedAt: '2026-10-19T09:50:00Z' }).items[0].expectedBy, '10:45');
// A partial day (only a few devices recorded) doesn't count towards the record.
assert.equal(notOnYet({ agents, seenDays: [...seen(1, ['2026-10-09']), ...seenDays], syncedAt: '2026-10-19T08:33:47Z' }).learning, false);
assert.equal(notOnYet({ agents, seenDays: seen(1, days), syncedAt: '2026-10-19T08:33:47Z' }).learning, false, 'one device every day is still a full record of that device');
// Known about: hidden until the date given.
r = notOnYet({ agents, seenDays, hidden: [{ agent_id: 1, until: '2026-10-19' }], syncedAt: '2026-10-19T08:33:47Z' });
assert.deepEqual([r.items.map(i => i.machine), r.hidden], [['DCSERVER'], 1]);
assert.equal(notOnYet({ agents, seenDays, hidden: [{ agent_id: 1, until: '2026-10-18' }], syncedAt: '2026-10-19T08:33:47Z' }).hidden, 0);

// — Reasons. —
const why = (a, o = {}) => reasons(a, { last: uk(a.last_seen), ...o }).map(x => x.key);
assert.deepEqual(why({ ...fipc, reboot: '2026-10-01T05:00:00Z' }), ['pending', 'off', 'agent']);
assert.match(reasons({ ...fipc, reboot: '2026-10-01T05:00:00Z' }, { last: uk(fipc.last_seen) })[0].text, /hadn't restarted since/);
assert.deepEqual(why({ ...fipc, last_seen: '2026-10-30T16:00:00Z' }), ['off', 'agent'], 'more than 10 days after Patch Tuesday');
assert.deepEqual(why({ ...fipc, disks: [{ Drive: 'C:', Free: 9000, Total: 240000 }], last_seen: '2026-10-30T11:00:00Z', bios: '2017-03-01' }),
  ['disk', 'midday', 'age', 'off', 'agent']);
assert.deepEqual(why({ ...fipc, disks: [{ Drive: 'C:', Free: 9000, Total: 240000 }], last_seen: '2026-10-16T11:00:00Z' }), ['disk', 'midday', 'updates', 'off', 'agent'], 'most telling first');
assert.equal(why(fipc, { siteQuiet: true, others: 3 })[0], 'site');
assert.equal(why(fipc, { siteQuiet: true, others: 0 })[0], 'updates', 'a one-PC site says nothing about the site');

console.log('offline: ok');
