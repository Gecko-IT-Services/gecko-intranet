import assert from 'node:assert/strict';

globalThis.window = {
  escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]))
};

import {
  parseAteraEmail, classify, assess, isServer, isKeyMachine, isHomeMachine,
  buildIssues, summarise, messagesPath, renderIssue, SENDER, MAILBOX
} from '../src/sections/alerts.js';

// — parseAteraEmail: the real HTML shape, two devices in one email —
const twoDevices = `<div style="x">Alert Summary</div>
<div style="line-height:24px">Device: <a href="https://app.atera.com/Admin#/rmm/device/6744/agent">Bob's Home PC</a> (Daron Motors)</div>
<div style="line-height:24px">Status: Problem</div><div> </div>
<div style="font-weight:bold">Machine status unknown - agent has not established communication within the expected interval.</div>
<div style="font-size:12px">Created at 09/28/2026 08:35:31</div>
<div><a href="https://app.atera.com/Admin#/alerts/resolve/171901">Mark alert as resolved</a></div><hr />
<div style="line-height:24px">Device: <a href="https://app.atera.com/Admin#/rmm/device/8681/agent">Stacey&#39;s New Laptop</a> (ALS Locksmiths)</div>
<div>Status: Problem</div><div style="font-weight:bold">The Disk Usage(C:) 90.61% is greater than the threshold of 90.00%</div>
<div>Created at 09/28/2026 08:35:44</div>`;
const parsed = parseAteraEmail(twoDevices);
assert.equal(parsed.length, 2, 'one entry per Device: block');
assert.deepEqual(
  { device: parsed[0].device, client: parsed[0].client, status: parsed[0].status },
  { device: "Bob's Home PC", client: 'Daron Motors', status: 'Problem' }
);
assert.equal(parsed[0].deviceUrl, 'https://app.atera.com/Admin#/rmm/device/6744/agent', 'keeps the Atera device link');
assert.equal(parsed[1].device, "Stacey's New Laptop", 'entities decoded');
assert.match(parsed[1].message, /^The Disk Usage\(C:\) 90.61%/);

const plain = parseAteraEmail("Alert Summary\r\n\r\nDevice: Karen's PC (Home) (Freeston Water Treatment)\r\nStatus: Problem\r\n\r\nThe Disk Usage(C:) 90.20% is greater than the threshold of 90.00%\r\n\r\nCreated at 10/05/2026 14:07:17");
assert.deepEqual([plain[0].device, plain[0].client], ["Karen's PC (Home)", 'Freeston Water Treatment'],
  'plain text: brackets in the device name, client is the last bracket');
assert.deepEqual(parseAteraEmail(''), [], 'empty body, no entries');

// — classify —
assert.deepEqual(classify('The Disk Usage(D:) 100.00% is greater than the threshold of 90.00%'), { kind: 'disk', drive: 'D', value: 100 });
assert.deepEqual(classify('The CPU Load 99.84% is greater than the threshold of 95.00% for 30.00 minutes.'), { kind: 'cpu', value: 99.84 });
assert.deepEqual(classify('The Memory Usage 96.47% is greater than'), { kind: 'memory', value: 96.47 });
assert.deepEqual(classify('The Windows Service (Acronis Agent Core Service) State is Stopped'),
  { kind: 'service', service: 'Acronis Agent Core Service', state: 'Stopped' });
assert.equal(classify('Machine status unknown - agent has not established communication').kind, 'offline');
assert.equal(classify('No SNMP response from device due to a communication problem.').kind, 'snmp');
assert.equal(classify('Something brand new').kind, 'other');

// — machine roles —
assert.ok(isServer('FP Server') && isServer('T Server') && isServer('DC Server'));
assert.ok(!isServer("Ollie's Main Laptop") && !isServer('Observer PC'), 'word match, not substring');
assert.ok(isKeyMachine('Sage PC') && isKeyMachine('File PC') && isKeyMachine('Database PC') && isKeyMachine("David's PC (Accounts)"));
assert.ok(!isKeyMachine("Mandy's PC"));
assert.ok(isHomeMachine("Bob's Home PC") && isHomeMachine("Karen's PC (Home)"));

// — assess: the rules —
const lvl = issue => assess({ days: 1, peak: 0, current: 0, drive: 'C', ...issue }).level;
assert.equal(lvl({ kind: 'snmp', device: 'HPFBA9D1' }), 'noise', 'printers never surface');
assert.equal(lvl({ kind: 'service', device: 'FP Server' }), 'critical', 'anything on a server is critical');
assert.equal(lvl({ kind: 'offline', device: 'DC Server' }), 'critical');
assert.equal(lvl({ kind: 'cpu', device: 'FP Server' }), 'noise', 'one server CPU spike is not critical');
assert.equal(lvl({ kind: 'cpu', device: 'FP Server', days: 3 }), 'important', 'repeated server CPU is');
assert.equal(lvl({ kind: 'disk', device: "Jenny's PC", current: 100 }), 'critical', 'full disk');
assert.equal(lvl({ kind: 'disk', device: 'x', current: 96 }), 'important', 'nearly full');
assert.equal(lvl({ kind: 'disk', device: 'x', current: 90.09 }), 'noise', 'hovering at 90% is noise');
assert.equal(lvl({ kind: 'disk', device: 'x', peak: 99.5, current: 94.2 }), 'noise', 'judged on the latest reading');
assert.equal(lvl({ kind: 'service', device: "Mandy's PC" }), 'noise', 'one-off agent stop on a workstation');
assert.equal(lvl({ kind: 'service', device: "Mandy's PC", days: 2 }), 'important', 'repeated agent stop');
assert.equal(lvl({ kind: 'service', device: 'Sage PC' }), 'important', 'agent stop on a key machine');
assert.equal(lvl({ kind: 'offline', device: "Bob's Home PC" }), 'noise');
assert.equal(lvl({ kind: 'offline', device: 'Sage PC' }), 'important');
assert.equal(lvl({ kind: 'offline', device: "Luke's Laptop" }), 'noise');
assert.equal(lvl({ kind: 'memory', device: "Darryl's Laptop", days: 5 }), 'noise', 'workstation memory never surfaces');
assert.equal(lvl({ kind: 'other', device: 'x' }), 'important', 'unknown alert types surface rather than hide');

// — buildIssues: a replay of the real 22 Sep – 6 Oct 2026 pattern —
const NOW = new Date('2026-10-06T12:00:00Z');
const at = (iso, client, device, message, status = 'Problem') => ({ when: iso, client, device, message, status, link: 'L' });
const disk = (d, p) => `The Disk Usage(${d}:) ${p}% is greater than the threshold of 90.00%`;
const replay = [
  // noise: printer, every couple of hours
  ...Array.from({ length: 20 }, (_, i) => at(`2026-10-0${1 + (i % 5)}T0${i % 9}:00:00Z`, 'Onsite Commercials', 'HPFBA9D1', 'No SNMP response from device due to a communication problem.')),
  // noise: disk bouncing at 90%
  ...Array.from({ length: 15 }, (_, i) => at(`2026-10-0${1 + (i % 5)}T1${i % 9}:00:00Z`, 'Daron Motors', 'Warranty PC - Workshop', disk('C', '90.0' + (i % 9)))),
  // noise: laptop memory, Bob's home PC, one-off Acronis update stops
  ...Array.from({ length: 5 }, (_, i) => at(`2026-10-0${2 + i}T09:00:00Z`, 'MSA Safety', "Darryl's Laptop", 'The Memory Usage 96.40% is greater than the threshold of 95.00% for 30.00 minutes.')),
  ...Array.from({ length: 9 }, (_, i) => at(`2026-09-2${2 + (i % 7)}T21:00:00Z`, 'Daron Motors', "Bob's Home PC", 'Machine status unknown - agent has not established communication within the expected interval.')),
  at('2026-10-02T05:54:00Z', 'Daron Motors', "Bob's Home PC", 'The Windows Service (Acronis Agent Core Service) State is Stopped'),
  at('2026-10-01T12:14:00Z', 'Daron Motors', "Mandy's PC", 'The Windows Service (Acronis Agent Core Service) State is Stopped'),
  // real: D: full and staying full
  at('2026-09-22T17:48:00Z', 'Hillcrest Engineering', "Jenny's PC", disk('D', '100.00')),
  at('2026-10-05T07:50:00Z', 'Hillcrest Engineering', "Jenny's PC", disk('D', '100.00')),
  // real: server backup agent stopped
  at('2026-10-02T05:58:00Z', 'West Country Fires', 'FP Server', 'The Windows Service (Acronis Agent Core Service) State is Stopped'),
  // fixed since: 99.5 → 94
  at('2026-09-24T08:12:00Z', 'West Country Fires', "Vicky's Laptop", disk('C', '99.51')),
  at('2026-09-30T08:24:00Z', 'West Country Fires', "Vicky's Laptop", disk('C', '94.24')),
  // key machine offline, then quiet for 4 days
  at('2026-10-02T08:14:00Z', 'Clarke Lane Engineering', 'Sage PC', 'Machine status unknown - agent has not established communication within the expected interval.'),
  // key machine offline yesterday, then Atera says Resolved
  at('2026-10-05T08:00:00Z', 'Technix Rubber & Plastics', 'File PC', 'Machine status unknown - agent has not established communication'),
  at('2026-10-05T09:00:00Z', 'Technix Rubber & Plastics', 'File PC', 'Machine status unknown - agent has not established communication', 'Resolved'),
  at('not a date', 'X', 'Y', 'Z'),
];
const issues = buildIssues(replay, NOW);
const shown = issues.filter(i => i.level !== 'noise').map(i => `${i.level}:${i.device}`);
assert.deepEqual(shown, ["critical:Jenny's PC", 'critical:FP Server'],
  `only the two real problems surface; got ${JSON.stringify(shown)}`);

const jenny = issues.find(i => i.device === "Jenny's PC");
assert.equal(jenny.count, 2, 'repeats folded into one issue');
assert.equal(jenny.days, 2);
assert.equal(jenny.label, 'D: drive at 100.0%');

const sage = issues.find(i => i.device === 'Sage PC');
assert.equal(sage.level, 'noise', 'an important issue quiet for 3+ days drops to filtered');
assert.equal(sage.quiet, true);
assert.match(sage.why, /quiet for 4 days/);

assert.ok(!issues.some(i => i.device === 'File PC'), 'a Resolved email closes the issue');
assert.equal(issues.find(i => i.device === "Vicky's Laptop").label, 'C: drive at 94.2% (peaked 99.5%)');
assert.equal(issues.find(i => i.device === 'HPFBA9D1').count, 20);

const stats = summarise(issues, replay.length - 2);
assert.equal(stats.critical, 2);
assert.equal(stats.important, 0);
assert.ok(stats.noiseAlerts >= 49, 'the noise is counted, not lost');

// — messagesPath —
const decoded = decodeURIComponent(messagesPath(7, NOW));
assert.ok(decoded.startsWith(`/users/${MAILBOX}/messages?`));
assert.ok(decoded.includes('receivedDateTime ge 2026-09-29T12:00:00.000Z'), '7-day window');
assert.ok(decoded.includes(`from/emailAddress/address eq '${SENDER}'`));
assert.ok(decoded.includes('$select=subject,receivedDateTime,body,webLink'), 'needs the body: multi-device emails');

// — renderIssue escapes everything —
const html = renderIssue({ ...jenny, client: '<script>x</script>', device: '<img src=x>', deviceUrl: '' });
assert.ok(!html.includes('<script>') && !html.includes('<img'), 'escaped');

console.log('atera-alerts: all assertions passed');
