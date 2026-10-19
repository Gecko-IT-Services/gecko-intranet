import assert from 'node:assert/strict';
import { comingUp, PSTN_OFF, LEAD } from '../src/core/dates.js';

const today = '2026-10-19';
const items = comingUp({ today,
  annual: [
    { status: 'AUTHORISED', period: 12, next_date: '2026-12-01', contact_name: 'CDA Ltd', repeating_invoice_id: 'r1', line_items: [
      { description: 'Web Hosting - 1 year', line_amount: 99 }, { description: 'Domain Renewal cdaluminium.uk.com - 1 year', line_amount: 75 }] },
    { status: 'AUTHORISED', period: 12, next_date: '2026-12-01', contact_name: 'Freeston Water Treatment', line_items: [{ description: 'Web Hosting - 1 year (freeston.co.uk)', line_amount: 199 }] },
    { status: 'AUTHORISED', period: 12, next_date: '2027-03-01', contact_name: 'Cowan Consultancy', line_items: [{ description: 'Web Hosting - 1 year', line_amount: 125 }] },
    { status: 'AUTHORISED', period: 1, next_date: '2026-11-01', contact_name: 'Monthly Co', line_items: [] }],
  domains: [
    { domain: 'lscommercials.co.uk', client_name: 'LS Commercials', billed: true, expires_on: '2026-12-05', registrar: 'Nominet' },
    { domain: 'cowanconsult.co.uk', client_name: 'Cowan Consultancy', billed: false, expires_on: '2026-10-28', registrar: '123-Reg' },
    { domain: 'far.co.uk', client_name: 'Far', billed: false, expires_on: '2027-06-01' }, { domain: 'broken.com', client_name: 'X', expires_on: null }],
  dealer: [{ id: 7, client_name: 'Daron Motors', service: 'voxone', contract_end: '2026-12-01' },
    { id: 32, client_name: 'Brazier Interiors', service: 'pstn', quantity: 1 }, { id: 41, client_name: 'Clarke Lane Engineering', service: 'pstn', quantity: 2 }],
  upgrades: [{ name: 'West Country Fires', devices: [
    { name: 'TSERVER', findings: [{ level: 'soon', what: 'Windows', text: 'Windows Server 2016: support ends 12 Jan 2027', fix: 'Plan a new server or a supported Windows Server', ends: '2027-01-12' }] },
    { name: 'OLDPC', findings: [{ level: 'asap', what: 'Windows', text: 'Windows 10: no security updates since 14 Oct 2025', fix: 'Replace', ends: '2025-10-14' }] }] },
    { name: 'Gecko IT', own: true, devices: [{ name: 'X', findings: [{ level: 'soon', what: 'Windows', text: 'Windows Server 2016: support ends 12 Jan 2027', ends: '2027-01-12' }] }] }]
});
assert.deepEqual(items.map(i => [i.kind, i.client, i.days, i.group]), [
  ['domain', 'Cowan Consultancy', 9, 'protect'],
  ['renewal', 'CDA Ltd', 43, 'money'],
  ['contract', 'Daron Motors', 43, 'money'],
  ['renewal', 'Freeston Water Treatment', 43, 'money'],
  ['domain', 'LS Commercials', 47, 'protect'],
  ['support', 'West Country Fires', 85, 'money'],
  ['pstn', 'Brazier Interiors', 104, 'money'],
  ['pstn', 'Clarke Lane Engineering', 104, 'money']
], 'soonest first; beyond each lead time, monthly invoices, past dates, Gecko’s own and missing dates left out');
const by = k => items.find(i => i.key.startsWith(k));
assert.equal(by('renewal:r1').title, 'Web Hosting and Domain Renewal renews for CDA Ltd');
assert.deepEqual(by('renewal:r1').value, { gbp: 174, per: 'once' });
assert.equal(by('renewal:Freeston').title, 'Web Hosting renews for Freeston Water Treatment');
assert.match(by('domain:lscommercials').why, /we look after it/);
const clook = comingUp({ today, domains: [{ domain: 'freeston.co.uk', client_name: 'Freeston', billed: false, expires_on: '2026-11-11', registrar: 'Sub 6 Limited t/a Clook Internet', sources: ['xero', 'email'] },
  { domain: 'own.co.uk', client_name: 'Own', billed: false, expires_on: '2026-11-11', registrar: 'Sub 6 Limited t/a Clook Internet', sources: ['email'] },
  { domain: 'southernglassservices.co.uk', client_name: 'Southern Glass', billed: false, expires_on: '2026-11-12', registrar: 'Sub 6 Limited t/a Clook Internet', sources: ['email', 'hosting'] }] });
assert.deepEqual(clook.map(x => [x.client, x.group, x.title]), [['Freeston', 'protect', 'Renew freeston.co.uk for Freeston'], ['Own', 'money', 'own.co.uk expires 11 Nov 2026'], ['Southern Glass', 'protect', 'Renew southernglassservices.co.uk for Southern Glass']],
  'a Clook domain for a client we invoice hosting to is ours; one only seen on an email address is theirs');
assert.equal(by('domain:cowanconsult').title, 'cowanconsult.co.uk expires 28 Oct 2026');
assert.equal(by('domain:cowanconsult').go, 'client:contacts:Cowan Consultancy');
assert.equal(by('pstn:Clarke').title, 'Move Clarke Lane Engineering off 2 PSTN lines before the switch-off');
assert.equal(by('support:West Country Fires').title, 'Windows Server 2016 support ends 12 Jan 2027 at West Country Fires');
assert.match(by('support:West Country Fires').why, /^TSERVER: Plan a new server/);
assert.equal(by('contract:7').title, 'Daron Motors’ VoxOne contract ends 1 Dec 2026');
assert.equal(PSTN_OFF, '2027-01-31');
assert.ok(LEAD.pstn > LEAD.renewal);
assert.deepEqual(comingUp({ today }), []);
console.log('dates: ok');
