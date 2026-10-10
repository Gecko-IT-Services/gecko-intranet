import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { VENDORS, vendorsFor, vendorMarks, productPart } from '../src/core/vendors.js';

const keys = text => vendorsFor(text).map(v => v.key);
const is = (text, expected, why) => assert.deepEqual(keys(text), expected, why || text);

// The whole catalogue as it is seeded, read from the migrations so a new product cannot go unlooked-at.
const CATALOGUE = {
  voxone: ['voxone'], connectivity: [], email_security: ['hornetsecurity'], email_auth: [],
  m365_backup: ['microsoft', 'acronis'], endpoint: ['opentext', 'acronis'], exclaimer: [], keeper: ['keeper'],
  m365: ['microsoft'], hosting: [], seo: ['rankmath'], website: [], support: [], windows11: ['microsoft'],
  ve_migration: ['voxone'], vu_renewal: [], it_services: [],
};
const seeds = ['20261008090000_opportunities.sql', '20261008120000_voip_dealer.sql']
  .map(f => readFileSync('supabase/migrations/' + f, 'utf8')).join('\n');
const seeded = [...seeds.matchAll(/^\('([a-z0-9_]+)', '[^']+', '([^']+)', '[a-z0-9_]+',/gm)].map(m => [m[1], m[2]]);
assert.equal(seeded.length, Object.keys(CATALOGUE).length, 'every seeded product has an expectation here');
for (const [key, name] of seeded) is(name, CATALOGUE[key], `${key}: "${name}"`);

// In the order they are named.
is('Microsoft 365 backup (Acronis)', ['microsoft', 'acronis']);
is('Backup + AV stack', ['acronis', 'opentext']);

// Names that hold another vendor's word and are not theirs.
is('Hornetsecurity 365 Total Protection', ['hornetsecurity'], '"365" alone is not Microsoft');
is('VoIP Exchange → VoxOne migration', ['voxone'], 'VoIP Exchange is VoIP Unlimited\'s, not Microsoft Exchange');
is('voip exchange', []);
is('Exchange Online mailbox', ['microsoft']);
is('Email authentication set-up (SPF, DKIM, DMARC)', [], 'email set-up is not email filtering');
is('Exclaimer email signatures', []);

// Service lines as they are typed.
is('M365', ['microsoft']);
is('O365 Business Premium', ['microsoft']);
is('Business Standard', ['microsoft']);
is('Teams Phone', ['microsoft']);
is('Voxone + FTTP', ['voxone']);
is('VoIP + FTTP', [], 'telephony is VoxOne for some clients and VoIP Exchange for others');
is('Google Workspace', ['google']);
is('IS + Backup', ['opentext', 'acronis']);
is('Server back-ups', ['acronis']);
is('Antivirus', ['opentext']);
is('Password manager', ['keeper']);
is('Email filtering', ['hornetsecurity']);
is('Spam filter', ['hornetsecurity']);
is('SEO', ['rankmath']);
is('RankMath Pro', ['rankmath']);
is('IT support retainer', []);
is(null, []);

// Proper names and initials count only as they are properly written; other words only whole.
is('Two teams, one outlook', [], '"teams" and "outlook" in a sentence are not the products');
is('This is + that', [], '"is" in a sentence is not Internet Security');
is('Travel and savings review', [], '"av" inside a word is not antivirus');
is('Backupify migration', []);
is('Housekeeper access', []);
is('Hampshire Glass and Window Solutions Ltd', [], 'a client\'s name');

// An opportunity's title carries the client's name: only the product is read.
assert.equal(productPart('Website refresh — Google Street Garage'), 'Website refresh');
is(productPart('Website refresh — Google Street Garage'), []);
is(productPart('Keeper password manager — Alder & Finch'), ['keeper']);

// Never a row of logos.
assert.equal(vendorsFor('Microsoft 365, Google Workspace, backup, antivirus and a password manager').length, 3);

assert.equal(vendorMarks('Support hours block (SSA) or retainer'), '');
assert.match(vendorMarks('M365'), /^<img class="vendor-mark" src="src\/assets\/vendors\/microsoft\.svg" alt="" title="Microsoft"/);
assert.match(vendorMarks('M365', true), /class="vendor-mark after"/, 'behind a name in a column');

// Every mark has its file: a missing one would draw a broken image.
for (const v of VENDORS) assert.ok(existsSync(`src/assets/vendors/${v.file}`), `${v.file} is missing`);

console.log('vendors: ok');
