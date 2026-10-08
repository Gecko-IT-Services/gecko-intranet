import assert from 'node:assert/strict';
import {
  classifyMx, spfStatus, dmarcPolicy, summariseDns, summarisePageSpeed, ticketHits,
  holds, evaluate, clientGaps, withoutOpen, pipelineTotals, fillTemplate, emailDomain, THRESHOLDS,
  renewalsDue
} from '../src/core/opportunities.js';

const NOW = new Date('2026-10-08T09:00:00Z');

// — DNS reading —
assert.deepEqual(classifyMx(['acme-co-uk.mail.protection.outlook.com.']), { provider: 'microsoft', filter: null });
assert.deepEqual(classifyMx(['mx01.hornetsecurity.com', 'mx02.hornetsecurity.com']), { provider: 'filtered', filter: 'Hornetsecurity' });
assert.equal(classifyMx(['aspmx.l.google.com']).provider, 'google');
assert.equal(classifyMx([]).provider, 'none');
assert.equal(classifyMx(['mail.someisp.net']).provider, 'other');

assert.equal(spfStatus([]), 'missing');
assert.equal(spfStatus(['"v=spf1 include:spf.protection.outlook.com -all"']), 'ok');
assert.equal(spfStatus(['v=spf1 include:x ~all']), 'soft');
assert.equal(spfStatus(['v=spf1 +all']), 'open');
assert.equal(spfStatus(['v=spf1 -all', 'v=spf1 ~all']), 'multiple');
assert.equal(spfStatus(['"v=spf1 include:a" " -all"']), 'ok', 'split TXT strings are joined');
assert.equal(spfStatus(['google-site-verification=abc']), 'missing');

assert.equal(dmarcPolicy([]), 'missing');
assert.equal(dmarcPolicy(['v=DMARC1; p=none; rua=mailto:x@y']), 'none');
assert.equal(dmarcPolicy(['"v=DMARC1; p=reject"']), 'reject');
assert.equal(dmarcPolicy(['v=DMARC1; rua=mailto:x@y']), 'none', 'no p= is treated as none');

assert.deepEqual(
  summariseDns({ mx: ['x.mail.protection.outlook.com'], txt: ['v=spf1 -all'], dmarc: ['v=DMARC1; p=quarantine'], dkim: true }),
  { provider: 'microsoft', filter: null, spf: 'ok', dmarc: 'quarantine', dkim: true }
);

// — PageSpeed —
const ps = summarisePageSpeed({ lighthouseResult: {
  finalDisplayedUrl: 'https://www.example.co.uk/',
  categories: { performance: { score: 0.38 }, seo: { score: 0.72 }, accessibility: { score: 0.9 }, 'best-practices': { score: null } }
} });
assert.deepEqual(ps, { performance: 38, seo: 72, accessibility: 90, bestPractices: null, https: true, finalUrl: 'https://www.example.co.uk/' });
assert.equal(summarisePageSpeed({ lighthouseResult: { finalUrl: 'http://x.com/', categories: {} } }).https, false);

// — Timesheets —
const tickets = [
  { date: '2026-09-12', text: 'Assisted Chris with Phishing scam email', hours: 0.25 },
  { date: '2026-08-03', text: 'Spam getting through to accounts mailbox', hours: 0.5 },
  { date: '2026-02-01', text: 'Phishing training', hours: 1 },        // outside 6 months
  { date: '2026-09-20', text: 'Reset Bens password', hours: 0.25 }
];
const hits = ticketHits(tickets, 'phish|spam', { now: NOW });
assert.deepEqual(hits.map(h => h.date), ['2026-09-12', '2026-08-03'], 'newest first, window applied');
assert.deepEqual(ticketHits(tickets, '([bad', { now: NOW }), [], 'a broken pattern matches nothing');
assert.deepEqual(ticketHits(tickets, '', { now: NOW }), []);

// — Catalogue fixtures —
const P = (key, rule, extra = {}) => ({ key, rule, name: key, family: 'x', keywords: '', ticket_keywords: '', active: true, sort: 1, default_mrr: null, default_one_off: null, email_subject: '', email_body: '', ...extra });
const hornet = P('email_security', 'email_filter', { keywords: 'hornet|mimecast', ticket_keywords: 'phish|spam', default_mrr: 30 });
const dmarc = P('email_auth', 'dmarc');
const voxone = P('voxone', 'missing', { keywords: 'voxone|voip', ticket_keywords: 'phone|voicemail' });
const backup = P('m365_backup', 'missing_if_m365', { keywords: '365.{0,25}backup' });
const seo = P('seo', 'seo', { keywords: 'seo|rank math' });
const site = P('website', 'website');
const support = P('support', 'support', { keywords: 'retainer', ticket_keywords: '.' });
const m365 = P('m365', 'm365_elsewhere', { keywords: 'm365' });
const hosting = P('hosting', 'hosting', { keywords: 'hosting' });
const win11 = P('windows11', 'devices', { active: false });

const base = {
  name: 'Acme Ltd', services: [{ title: 'IS + Backup', category: 'stack', notes: '' }],
  cspClient: true, dns: { provider: 'microsoft', filter: null, spf: 'soft', dmarc: 'none', dkim: false },
  emailDomain: 'acme.co.uk', webDomain: 'acme.co.uk', tickets
};

// — holds —
assert.deepEqual(holds({ ...base, services: [{ title: 'VoxOne x4', notes: '' }] }, voxone), { has: true, via: 'service line "VoxOne x4"' });
assert.equal(holds(base, m365).has, true, 'TD SYNNEX customer has M365 through us');
assert.equal(holds({ ...base, ssa: true }, support).has, true);
assert.equal(holds({ ...base, services: [{ title: 'IT Support Retainer', category: 'retainer' }] }, support).has, true);
assert.equal(holds({ ...base, hostedDomains: ['acme.co.uk'] }, hosting).has, true);

// — evaluate: email filtering, with DMARC and timesheets as evidence —
const h = evaluate(base, hornet, { now: NOW });
assert.ok(h, 'M365 with no filter is a gap');
assert.equal(h.strength, 2, 'rule and timesheets agree');
assert.equal(h.tickets.length, 2);
assert.ok(h.reasons.some(r => /DMARC is set to “none”/.test(r)));
assert.ok(h.reasons.some(r => /2 timesheet entries/.test(r)));
assert.equal(h.mrr, 30);
assert.equal(evaluate({ ...base, dns: { ...base.dns, filter: 'Mimecast' } }, hornet, { now: NOW }), null, 'already filtered');
assert.equal(evaluate(base, hornet, { now: NOW, status: 'not_interested' }), null, 'Philip said not interested');
assert.equal(evaluate({ ...base, cspClient: false, dns: null, tickets: [] }, hornet, { now: NOW }), null, 'no M365 and no evidence');
// Not on M365 by rule, but keeps calling about phishing → still raised, on timesheet evidence.
const tOnly = evaluate({ ...base, cspClient: false, dns: null }, hornet, { now: NOW });
assert.equal(tOnly.strength, 1);

// — DMARC / SPF / DKIM —
const d = evaluate(base, dmarc, { now: NOW });
assert.deepEqual(d.reasons.length, 2, 'p=none + no DKIM on M365 (soft SPF is fine)');
assert.equal(evaluate({ ...base, dns: { provider: 'microsoft', filter: null, spf: 'ok', dmarc: 'reject', dkim: true } }, dmarc, { now: NOW }), null);
assert.equal(evaluate({ ...base, dns: null }, dmarc, { now: NOW }), null, 'not checked yet → no claim');

// — missing: weak on its own, strong with timesheet evidence —
const v0 = evaluate({ ...base, tickets: [] }, voxone, { now: NOW });
assert.equal(v0.strength, 0);
const v2 = evaluate({ ...base, tickets: [{ date: '2026-09-01', text: 'Phone not ringing', hours: 1 }, { date: '2026-09-02', text: 'voicemail setup', hours: 1 }] }, voxone, { now: NOW });
assert.equal(v2.strength, 2);

// — M365 backup only for M365 users —
assert.ok(evaluate(base, backup, { now: NOW }));
assert.equal(evaluate({ ...base, cspClient: false, dns: { provider: 'google' } }, backup, { now: NOW }), null);

// — M365 elsewhere —
assert.equal(evaluate(base, m365, { now: NOW }), null, 'already via TD SYNNEX');
assert.match(evaluate({ ...base, cspClient: false }, m365, { now: NOW }).reasons[0], /aren’t billed through us/);

// — Website and SEO from PageSpeed —
const withPs = { ...base, pagespeed: { performance: 38, seo: 72, accessibility: 90, https: true } };
assert.match(evaluate(withPs, seo, { now: NOW }).reasons[0], /SEO 72\/100, performance 38\/100/);
assert.match(evaluate(withPs, site, { now: NOW }).reasons[0], /38\/100 for speed/);
assert.equal(evaluate({ ...base, pagespeed: { performance: 90, seo: 95, https: true } }, seo, { now: NOW }), null);
assert.equal(evaluate({ ...base, pagespeed: { error: 'quota' } }, site, { now: NOW }), null, 'a failed check is not evidence');
assert.equal(evaluate({ ...base, services: [{ title: 'SEO (Rank Math)' }], pagespeed: withPs.pagespeed }, seo, { now: NOW }), null);

// — Support block from ad-hoc hours —
const sup = evaluate({ ...base, tickets: [
  { date: '2026-09-01', text: 'a', hours: 2 }, { date: '2026-08-01', text: 'b', hours: 1.5 }] }, support, { now: NOW });
assert.match(sup.reasons[0], /3\.5 hours of ad-hoc support/);
assert.equal(evaluate({ ...base, tickets: [{ date: '2026-09-01', text: 'a', hours: 1 }] }, support, { now: NOW }), null, 'under the threshold');
assert.equal(THRESHOLDS.supportHours, 3);

// — Inactive products and ordering —
assert.equal(evaluate(base, win11, { now: NOW }), null, 'Windows 11 waits for Atera data');
const gaps = clientGaps(base, [voxone, hornet, dmarc, win11], {}, { now: NOW });
assert.deepEqual(gaps.map(g => g.product.key), ['email_security', 'email_auth', 'voxone'], 'strongest first');
assert.deepEqual(withoutOpen(gaps, [{ client_name: 'Acme Ltd', product_key: 'email_auth', status: 'proposed' }], 'Acme Ltd').map(g => g.product.key),
  ['email_security', 'voxone'], 'already in the pipeline → not raised again');
assert.equal(withoutOpen(gaps, [{ client_name: 'Acme Ltd', product_key: 'email_auth', status: 'lost' }], 'Acme Ltd').length, 3, 'a lost one can come back');

// — Pipeline totals —
const t = pipelineTotals([
  { status: 'idea', mrr: 30, one_off: 0 }, { status: 'proposed', mrr: 45.5, one_off: 150 },
  { status: 'won', mrr: 60, closed_at: '2026-10-02T10:00:00Z' }, { status: 'won', mrr: 20, closed_at: '2026-09-02T10:00:00Z' },
  { status: 'lost', mrr: 99 }
], NOW);
assert.deepEqual(t, { openCount: 2, openMrr: 75.5, openOneOff: 150, wonMrr: 80, wonMrrThisMonth: 60, wonCountThisMonth: 1 });

// — Email —
const mail = fillTemplate(
  { name: 'Hornetsecurity', email_subject: 'Stopping phishing at {{client}}', email_body: 'Hi {{first_name}},\n\n{{evidence}}\n\n{{price}}\n\n{{sender}}\n\n\n' },
  { client: 'A&B <Ltd>', firstName: 'Chris', evidence: ['DMARC is none.', 'No filter.'], mrr: 30, oneOff: 50, sender: 'Philip' });
assert.equal(mail.subject, 'Stopping phishing at A&B <Ltd>', 'subject is plain text (Graph escapes it)');
assert.ok(mail.html.includes('<p>Hi Chris,</p>'));
assert.ok(mail.html.includes('DMARC is none.<br>No filter.'), 'evidence lines kept');
assert.ok(mail.html.includes('£30.00 a month plus £50.00 to set up'));
assert.ok(!/<Ltd>/.test(mail.html.replace(/<\/?(p|br)>/g, '')), 'values are escaped in the HTML');
assert.equal(fillTemplate({ name: 'X', email_body: 'Hi {{first_name}}' }, {}).text, 'Hi there', 'no contact name → "there"');

// — Email domains —
assert.equal(emailDomain('andy@AccessInstrumentation.co.uk'), 'accessinstrumentation.co.uk');
assert.equal(emailDomain('someone@gmail.com'), '', 'free mail is not a company domain');
assert.equal(emailDomain('nonsense'), '');

// — VoIP Unlimited dealer side —
const conn = P('connectivity', 'missing', { keywords: 'fttp|sogea' });
const ve = P('ve_migration', 'voip_exchange', { default_mrr: 4 });
const renew = P('vu_renewal', 'dealer_renewal');
const prospect = P('it_services', 'dealer_prospect');
const daron = { ...base, tickets: [], dealer: [
  { service: 'ethernet', quantity: 1, contract: 'out_of_contract', extras: '100MB/100MB', notes: '' },
  { service: 'voxone', quantity: 2, contract: 'in_contract', contract_end: '2026-12-01', extras: '', notes: '' }] };
assert.deepEqual(holds(daron, voxone), { has: true, via: 'VoIP Unlimited dealer: VoxOne' }, 'dealer VoxOne counts as has');
assert.equal(holds(daron, conn).via, 'VoIP Unlimited dealer: Ethernet');
assert.equal(evaluate(daron, voxone, { now: NOW }), null, 'never pitch VoxOne to a dealer VoxOne customer');
const unknownDealer = { ...base, tickets: [], dealer: [{ service: 'unknown', quantity: 1, contract: 'unknown' }] };
assert.equal(evaluate(unknownDealer, voxone, { now: NOW }), null, 'on the dealer list with services not recorded → not pitched');
assert.equal(evaluate(unknownDealer, conn, { now: NOW }), null);

const r = evaluate(daron, renew, { now: NOW });
assert.equal(r.reasons.length, 2, 'out-of-contract Ethernet + VoxOne ending within 90 days');
assert.match(r.reasons[0], /Ethernet 100MB\/100MB: out of contract/);
assert.match(r.reasons[1], /2 × VoxOne: in contract \(ends 1 Dec 2026\)/);
assert.equal(renewalsDue(daron.dealer, { now: new Date('2026-06-01T00:00:00Z') }).length, 1, 'Dec end date not yet within 90 days in June');

const cowan = { ...base, tickets: [], dealer: [{ service: 'voip_exchange', quantity: 13, contract: 'out_of_contract', extras: 'no maintenance, 1 x mobile app', notes: '' }] };
const m = evaluate(cowan, ve, { now: NOW });
assert.equal(m.mrr, 52, '13 seats × £4 commission');
assert.ok(m.reasons.some(x => /call recordings are not accessible/.test(x)));
assert.ok(m.reasons.some(x => /13 seats × £4\.00 commission = £52\.00 a month/.test(x)));
assert.equal(evaluate(cowan, renew, { now: NOW }), null, 'VoIP Exchange is the migration, not a renewal');
assert.equal(evaluate(base, ve, { now: NOW }), null, 'no VoIP Exchange, no migration');

const waterside = { name: 'Waterside Homes', services: [], tickets: [], dealerOnly: true,
  dealer: [{ service: 'voip_exchange', quantity: 4, contract: 'out_of_contract', extras: '', notes: '' }] };
assert.match(evaluate(waterside, prospect, { now: NOW }).reasons[0], /Buys VoIP Exchange from VoIP Unlimited through us, but isn’t a Gecko IT client yet/);
assert.equal(evaluate(base, prospect, { now: NOW }), null, 'existing IT clients are not prospects');

console.log('opportunities: ok');
