import assert from 'node:assert/strict';

// The renderers call escapeHtml, which resolves through window at call time.
globalThis.window = {
  escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]))
};

import {
  cleanGroup,
  parseJobSubject,
  parseReportSubject,
  failureReason,
  reportHeadline,
  buildBoard,
  messagesPath,
  renderClient,
  SENDER,
  MAILBOX
} from '../src/sections/backups.js';

// — cleanGroup —
assert.equal(cleanGroup('Gecko IT Services (#0191292) > Daron Ford Motors'), 'Daron Ford Motors');
assert.equal(cleanGroup('Cowans'), 'Cowans');
assert.equal(cleanGroup(''), 'Unknown');

// — parseJobSubject: the three real Acronis subject shapes —
assert.deepEqual(
  parseJobSubject('BACKUP SUCCEEDED (group: Cowans)(resource: CCL)(plan: SharePoint sites to Cloud storage (4))'),
  { status: 'ok', group: 'Cowans', what: 'CCL', isMachine: false, plan: 'SharePoint sites to Cloud storage (4)' },
  'cloud-to-cloud success, with a bracketed plan name'
);
assert.equal(
  parseJobSubject('BACKUP SUCCEEDED WITH WARNINGS  (group: MSA Safety)(resource: MSA Training)(plan: Microsoft Teams to Cloud storage (6))').status,
  'warn',
  'warnings must not be read as success, double space and all'
);
assert.deepEqual(
  parseJobSubject('BACKUP FAILED (group: Gecko IT Services (#0191292) > Daron Ford Motors)(backup account: daronadmin)(machine: DESKTOP-IC6BFS8)(plan: Bobs Backup (14/04/26))'),
  { status: 'fail', group: 'Daron Ford Motors', what: 'DESKTOP-IC6BFS8', isMachine: true, plan: 'Bobs Backup (14/04/26)' },
  'machine failure: reseller prefix stripped, machine used as the job name'
);
assert.equal(parseJobSubject('BACKUP DID NOT START (group: X)(machine: Y)(plan: Z)').status, 'warn',
  'an unfamiliar BACKUP subject is surfaced as a warning, never dropped');
assert.equal(parseJobSubject('DAILY STATUS REPORT ON Oct 5, 2026 (group: X) (Critical: 1, Error: 0, Warning: 0, Information: 0)'), null);
assert.equal(parseJobSubject('Take the next step with the Hornetsecurity stack'), null);

// — parseReportSubject —
assert.deepEqual(
  parseReportSubject('DAILY STATUS REPORT ON Oct 5, 2026, 1:03:00 PM (group: Gecko IT Services (#0191292) > West Country Fires) (Critical: 1, Error: 0, Warning: 2, Information: 0)'),
  { group: 'West Country Fires', critical: 1, error: 0, warning: 2 }
);
assert.equal(parseReportSubject('BACKUP FAILED (group: X)'), null);

// — preview parsing —
const failPreview = 'Manage data protection\r\n\r\nBackup failed\r\n        DESKTOP-IC6BFS8\r\n\r\nThe cloud storage is temporarily unavailable.\r\n\r\n          Show details';
assert.equal(failureReason(failPreview, 'DESKTOP-IC6BFS8'), 'The cloud storage is temporarily unavailable.');
assert.equal(failureReason('Backup succeeded\r\n CCL', 'CCL'), '', 'no reason for a success');
assert.deepEqual(
  reportHeadline('Active alerts\r\nCRITICAL\r\n1\r\n\r\nCritical\r\n\r\nMachine is offline for more than 30 days\r\nOct 4, 2026, 10:01:39 PM\r\n\r\nThere has been no connection with machine \'Tserver\' for 97 days.'),
  { title: 'Machine is offline for more than 30 days', detail: "There has been no connection with machine 'Tserver' for 97 days." }
);

// — buildBoard —
const msg = (subject, iso, bodyPreview = '') => ({ subject, receivedDateTime: iso, bodyPreview, webLink: 'https://outlook.office365.com/x' });
const board = buildBoard([
  msg('BACKUP FAILED (group: A > Daron)(backup account: a)(machine: PC1)(plan: P)', '2026-10-05T08:00:00Z', 'Backup failed\r\nPC1\r\nDNS failed'),
  msg('BACKUP SUCCEEDED (group: A > Daron)(backup account: a)(machine: PC1)(plan: P)', '2026-10-05T22:00:00Z'),
  msg('BACKUP SUCCEEDED WITH WARNINGS  (group: MSA)(resource: Training)(plan: Teams (6))', '2026-10-05T23:00:00Z'),
  msg('BACKUP FAILED (group: Cowans)(resource: CCL)(plan: SP (4))', '2026-10-05T05:00:00Z', 'Backup failed\r\nCCL\r\nstorage unavailable'),
  msg('DAILY STATUS REPORT ON Oct 5 (group: A > WCF) (Critical: 1, Error: 0, Warning: 0, Information: 0)', '2026-10-05T11:00:00Z', 'Critical\r\n\r\nMachine is offline for more than 30 days'),
  msg('DAILY STATUS REPORT ON Oct 5 (group: A > Onsite) (Critical: 0, Error: 0, Warning: 0, Information: 0)', '2026-10-05T11:00:00Z'),
  msg('Unrelated subject', '2026-10-05T11:00:00Z'),
  msg('BACKUP SUCCEEDED (group: X)(resource: Y)(plan: Z)', 'not a date'),
]);

assert.equal(board.jobCount, 3, 'one job per client + resource/machine + plan');
assert.deepEqual(board.totals, { ok: 1, warn: 1, fail: 1 }, 'totals count each job once, by its latest result');
const daron = board.clients.find(c => c.name === 'Daron');
assert.equal(daron.jobs[0].latest.status, 'ok', 'a later success clears an earlier failure');
assert.deepEqual(daron.jobs[0].runs, { ok: 1, warn: 0, fail: 1 }, 'earlier runs are still tallied');
assert.equal(board.clients[0].name, 'Cowans', 'clients with a failure sort first');
assert.equal(board.clients[0].jobs[0].latest.reason, 'storage unavailable');
assert.deepEqual(board.alerts.map(a => a.group), ['WCF'], 'all-zero daily reports are not alerts');
assert.equal(board.alerts[0].title, 'Machine is offline for more than 30 days');
assert.deepEqual(buildBoard([]).totals, { ok: 0, warn: 0, fail: 0 }, 'empty mailbox is an empty board, not an error');

// — messagesPath —
const path = messagesPath(24, new Date('2026-10-06T07:00:00Z'));
assert.ok(path.startsWith(`/users/${encodeURIComponent(MAILBOX)}/messages?`), 'reads the shared support mailbox');
const decoded = decodeURIComponent(path);
assert.ok(decoded.includes('receivedDateTime ge 2026-10-05T07:00:00.000Z'), 'window starts 24h back');
assert.ok(decoded.includes(`from/emailAddress/address eq '${SENDER}'`), 'filtered to Acronis');
assert.ok(decoded.indexOf('$filter=receivedDateTime') < decoded.indexOf('$orderby=receivedDateTime'),
  'receivedDateTime leads $filter, which Graph requires when combined with $orderby');

// — renderClient: escaping and filtering —
const evil = buildBoard([msg('BACKUP FAILED (group: <img src=x>)(resource: <b>r</b>)(plan: p)', '2026-10-05T05:00:00Z')]);
const html = renderClient(evil.clients[0]);
assert.ok(!html.includes('<img') && !html.includes('<b>r'), 'every rendered field is escaped');
const msa = board.clients.find(c => c.name === 'MSA');
assert.equal(renderClient(msa, { filter: 'fail' }), '', 'a client with nothing matching the filter renders nothing');
assert.ok(renderClient(msa, { query: 'train' }).includes('Training'), 'search matches the resource name');

console.log('backups-board: all assertions passed');
