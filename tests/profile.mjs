import assert from 'node:assert/strict';
import { tidyPostcode, telHref, tidyWebsite, cleanProfile, addressLine, mapLinks, mailIdentity, mailSearches, clientMail, profileFor, stamp } from '../src/core/profile.js';

assert.equal(tidyPostcode('mk401aa'), 'MK40 1AA');
assert.equal(tidyPostcode(' sw1a 1aa '), 'SW1A 1AA');
assert.equal(tidyPostcode('W1A0AX'), 'W1A 0AX');
assert.equal(tidyPostcode('12345'), '');

assert.equal(telHref('01234 567890'), '+441234567890');
assert.equal(telHref('+44 (0)1234 567890'), '+441234567890');
assert.equal(telHref('0044 1234 567890'), '+441234567890');
assert.equal(telHref('07700 900123'), '+447700900123');
assert.equal(telHref('123'), '');
assert.equal(telHref(''), '');

assert.equal(tidyWebsite('www.acme.co.uk/'), 'https://www.acme.co.uk');
assert.equal(tidyWebsite('http://acme.co.uk/about'), 'http://acme.co.uk/about');
assert.equal(tidyWebsite('not a site'), '');

let r = cleanProfile({ address_line1: ' 12  High Street ', town: 'Bedford', postcode: 'mk401aa', office_phone: '01234 567890', website: 'acme.co.uk', visit_notes: 'Park round the back' }, 'Acme');
assert.deepEqual(r.row, { client_name: 'Acme', address_line1: '12 High Street', address_line2: '', town: 'Bedford', county: '', postcode: 'MK40 1AA', office_phone: '01234 567890', website: 'https://acme.co.uk', visit_notes: 'Park round the back' });
assert.match(cleanProfile({ postcode: 'nope' }, 'A').error, /isn’t a UK postcode/);
assert.match(cleanProfile({ office_phone: '12' }, 'A').error, /too short/);
assert.match(cleanProfile({ website: 'x' }, 'A').error, /web address/);
assert.match(cleanProfile({ visit_notes: 'Alarm code: 1234' }, 'A').error, /password manager/);
assert.match(cleanProfile({ visit_notes: 'password = hunter2' }, 'A').error, /password manager/);
assert.ok(cleanProfile({ visit_notes: 'Ask for the alarm to be off before 8am' }, 'A').row, 'mentioning the alarm is fine');

assert.equal(addressLine(r.row), '12 High Street, Bedford MK40 1AA');
const m = mapLinks({ ...r.row, lat: 52.136, lon: -0.466 });
assert.equal(m.directions, 'https://www.google.com/maps/dir/?api=1&destination=12%20High%20Street%2C%20Bedford%2C%20MK40%201AA');
assert.match(m.embed, /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=-0\.47560%2C52\.13000%2C-0\.45640%2C52\.14200&layer=mapnik&marker=52\.13600%2C-0\.46600$/);
assert.equal(mapLinks({ ...r.row }).embed, undefined, 'no coordinates, no embed');
assert.equal(mapLinks({}), null);

const id = mailIdentity({ contacts: [{ email: 'Chris@CowanConsult.co.uk' }, { email: 'bob.cowan@gmail.com' }], domains: ['cowanconsult.co.uk'], website: 'https://www.cowan-group.com' });
assert.deepEqual([...id.domains].sort(), ['cowan-group.com', 'cowanconsult.co.uk']);
assert.deepEqual(mailSearches(id), ['cowanconsult.co.uk', 'cowan-group.com', 'bob.cowan@gmail.com'], 'free-mail people searched by address, never the whole gmail.com');
const mail = clientMail([
  { id: 1, mailbox: 'me', subject: 'Quote', from: 'philip@gecko-it.com', to: ['chris@cowanconsult.co.uk'], received: '2026-10-07T10:00:00Z', internetMessageId: 'a' },
  { id: 2, mailbox: 'support', subject: 'Printer', from: 'chris@cowanconsult.co.uk', to: ['support@gecko-it.com'], received: '2026-10-08T09:00:00Z', internetMessageId: 'b' },
  { id: 3, mailbox: 'support', subject: 'Quote', from: 'philip@gecko-it.com', to: ['chris@cowanconsult.co.uk'], received: '2026-10-07T10:00:00Z', internetMessageId: 'a' },
  { id: 4, mailbox: 'me', subject: 'Newsletter mentioning cowanconsult.co.uk', from: 'news@other.com', to: ['philip@gecko-it.com'], received: '2026-10-08T11:00:00Z' },
  { id: 5, mailbox: 'me', subject: 'From Bob', from: 'bob.cowan@gmail.com', to: ['philip@gecko-it.com'], received: '2026-10-01T11:00:00Z' }
], id);
assert.deepEqual(mail.map(x => [x.id, x.direction]), [[2, 'in'], [1, 'out'], [5, 'in']], 'newest first; duplicates and mere mentions dropped');

assert.equal(profileFor([{ client_name: 'Cowan Consultancy Ltd', town: 'X' }], 'Cowan Consultancy').town, 'X');
assert.equal(stamp('2026-10-08T09:32:00Z'), 'Thu 8 Oct, 10:32', 'UK time (BST)');
assert.equal(stamp(''), '');

console.log('profile: all tests passed');

// Team mailboxes (10 Oct: Jack's emails too)
{
  const { mailboxesFor } = await import('../src/core/profile.js');
  const team = ['philip@gecko-it.com', 'jack@gecko-it.com'], shared = ['support@gecko-it.com'];
  assert.deepEqual(mailboxesFor('Philip@Gecko-IT.com', team, shared).map(b => [b.key, b.label]),
    [['me', 'your mailbox'], ['jack@gecko-it.com', 'Jack’s mailbox'], ['support@gecko-it.com', 'support@']]);
  assert.deepEqual(mailboxesFor('jack@gecko-it.com', team, shared).map(b => b.label), ['your mailbox', 'Philip’s mailbox', 'support@']);
  assert.equal(mailboxesFor('', team, shared).length, 4, 'not known who is signed in: search every one');
  assert.equal(mailboxesFor('philip@gecko-it.com', team, shared)[1].path, '/users/jack%40gecko-it.com/messages');
  console.log('profile: mailboxes ok');
}
