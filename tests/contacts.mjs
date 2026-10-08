import assert from 'node:assert/strict';
import { cleanContact, contactsFor, mainContact, duplicateEmail, mailbox } from '../src/core/contacts.js';

let r = cleanContact({ name: '  Chris   Wyeth ', email: ' Chris@CowanConsult.co.uk ', phone: '01234 567890 ext', role: 'Owner / director', is_main: 'on' }, 'Cowan Consultancy');
assert.deepEqual(r.row, { client_name: 'Cowan Consultancy', name: 'Chris Wyeth', email: 'chris@cowanconsult.co.uk', phone: '01234 567890', role: 'Owner / director', notes: '', is_main: true });
assert.equal(cleanContact({ email: 'accounts@x.co.uk' }, 'X').row.name, '', 'email alone is enough');
assert.match(cleanContact({}, 'X').error, /name or an email/);
assert.match(cleanContact({ name: 'A', email: 'nope' }, 'X').error, /doesn’t look like/);
assert.match(cleanContact({ name: 'A', phone: '123' }, 'X').error, /too short/);
assert.match(cleanContact({ name: 'A' }, '').error, /client/);

const all = [
  { id: 1, client_name: 'Cowan Consultancy Ltd', name: 'Zoe', email: 'zoe@c.co.uk', is_main: false },
  { id: 2, client_name: 'Cowan Consultancy', name: 'Chris', email: 'chris@c.co.uk', is_main: true },
  { id: 3, client_name: 'Kingdom Products', name: 'Kim', email: 'kim@k.co.uk', is_main: true },
  { id: 4, client_name: 'cowan consultancy', name: 'Amy', email: '', is_main: false }
];
assert.deepEqual(contactsFor(all, 'Cowan Consultancy').map(c => c.id), [2, 4, 1], 'any spelling; main first, then by name');
assert.deepEqual(mainContact(contactsFor(all, 'Cowan Consultancy')), { name: 'Chris', email: 'chris@c.co.uk', phone: '', role: '' });
assert.equal(mainContact([], { name: 'From SSA', email: 's@x.co.uk' }).name, 'From SSA');
assert.equal(mainContact([], null), null);
assert.equal(duplicateEmail(all, 'CHRIS@c.co.uk'), true);
assert.equal(duplicateEmail(all, 'chris@c.co.uk', 2), false, 'editing the same person');
assert.equal(duplicateEmail(all, ''), false);
assert.equal(mailbox({ name: 'Chris', email: 'c@x.co.uk' }), 'Chris <c@x.co.uk>');
assert.equal(mailbox({ name: '', email: 'c@x.co.uk' }), 'c@x.co.uk');

console.log('contacts: all tests passed');
