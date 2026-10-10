import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { VENDORS, vendorsFor, vendorMarks } from '../src/core/vendors.js';

const keys = text => vendorsFor(text).map(v => v.key);

// The catalogue as it is seeded (supabase/migrations/20261008090000_opportunities.sql, …_voip_dealer.sql).
assert.deepEqual(keys('Microsoft 365 through Gecko'), ['microsoft']);
assert.deepEqual(keys('Windows 11 upgrade / PC refresh'), ['microsoft']);
assert.deepEqual(keys('Microsoft 365 backup (Acronis)'), ['microsoft', 'acronis'], 'in the order they are named');
assert.deepEqual(keys('VoxOne hosted telephony'), ['voxone']);
assert.deepEqual(keys('Internet security + device backup'), ['opentext', 'acronis']);

// Names that look like another vendor's and are not.
assert.deepEqual(keys('Hornetsecurity 365 Total Protection'), ['hornetsecurity'], '"365" alone is not Microsoft');
assert.deepEqual(keys('VoIP Exchange → VoxOne migration'), ['voxone'], '"Exchange" here is VoIP Unlimited\'s');
assert.deepEqual(keys('Website hosting with Gecko'), []);
assert.deepEqual(keys('Keeper password manager'), [], 'no mark is better than a wrong one');

// Service lines as they are typed.
assert.deepEqual(keys('M365'), ['microsoft']);
assert.deepEqual(keys('O365 Business Premium'), ['microsoft']);
assert.deepEqual(keys('Voxone + FTTP'), ['voxone']);
assert.deepEqual(keys('Google Workspace'), ['google']);
assert.deepEqual(keys(null), []);

// Backups are Acronis and antivirus is Webroot, wherever the words are used (Jack, 10 Oct 2026).
assert.deepEqual(keys('IS + Backup'), ['opentext', 'acronis']);
assert.deepEqual(keys('Backup + AV stack'), ['acronis', 'opentext']);
assert.deepEqual(keys('Server back-ups'), ['acronis']);
assert.deepEqual(keys('Antivirus'), ['opentext']);
assert.deepEqual(keys('Webroot'), ['opentext']);
assert.deepEqual(keys('This is + that'), [], '"is" in a sentence is not Internet Security');
assert.deepEqual(keys('Travel and savings review'), [], '"av" inside a word is not antivirus');
assert.deepEqual(keys('Backupify migration'), [], 'whole words only');

assert.equal(vendorMarks('Support hours block (SSA) or retainer'), '');
assert.match(vendorMarks('M365'), /^<img class="vendor-mark" src="src\/assets\/vendors\/microsoft\.svg" alt="" title="Microsoft"/);

assert.match(vendorMarks('M365', true), /class="vendor-mark after"/, 'behind a name in a column');

// Every mark has its file: a missing one would draw a broken image.
for (const v of VENDORS) assert.ok(existsSync(`src/assets/vendors/${v.file}`), `${v.file} is missing`);

console.log('vendors: ok');
