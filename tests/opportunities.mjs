import assert from 'node:assert/strict';
import {
  classifyMx, spfStatus, dmarcPolicy, summariseDns, summarisePageSpeed, ticketHits,
  holds, evaluate, clientGaps, withoutOpen, pipelineTotals, fillTemplate, priceSentence, unitValue, emailDomain, THRESHOLDS,
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
  { name: 'Hornetsecurity', email_subject: 'Stopping phishing at {{client}}', email_body: 'Hi {{first_name}},\n\n{{#findings}}We noticed:\n{{findings}}{{/findings}}\n\n{{#price}}{{price}}{{/price}}\n\n{{sender}}\n\n\n' },
  { client: 'A&B <Ltd>', firstName: 'Chris', findings: ['DMARC is none.', 'No filter.'], mrr: 30, oneOff: 50, sender: 'Philip' });
assert.equal(mail.subject, 'Stopping phishing at A&B <Ltd>', 'subject is plain text (Graph escapes it)');
assert.ok(mail.html.includes('<p>Hi Chris,</p>'));
assert.ok(mail.html.includes('We noticed:<br>• DMARC is none.<br>• No filter.'), 'findings as bullets');
assert.ok(mail.html.includes('This would come to £30.00 a month, plus VAT, with a one-off £50.00 to set up.'), 'no client price: the opportunity value');

// Client prices per unit (Philip, 8 Oct: "Hornet is £7.50 per user").
const hornetPrice = { name: 'Hornetsecurity 365 Total Protection', unit_price: 7.5, price_unit: 'user' };
assert.equal(priceSentence(hornetPrice, {}), 'Hornetsecurity 365 Total Protection is £7.50 per user a month, plus VAT.');
assert.equal(priceSentence(hornetPrice, { quantity: 12, mrr: 999 }), 'Hornetsecurity 365 Total Protection is £7.50 per user a month, plus VAT. For your 12 users, that comes to £90.00 a month.', 'the client price wins over the pipeline value');
assert.equal(priceSentence(hornetPrice, { quantity: 1, oneOff: 50 }), 'Hornetsecurity 365 Total Protection is £7.50 per user a month, plus VAT. For your 1 user, that comes to £7.50 a month. There’s a one-off £50.00 to set up.');
assert.equal(priceSentence({ name: 'VoxOne', unit_price: 15, price_unit: 'seat' }, { quantity: 8 }), 'VoxOne is £15.00 per seat a month, plus VAT. For your 8 seats, that comes to £120.00 a month.');
assert.equal(priceSentence({ name: 'SEO', unit_price: 150, price_unit: 'month' }, { quantity: 3 }), 'SEO is £150.00 a month, plus VAT.', 'flat monthly ignores quantity');
assert.equal(priceSentence({ name: 'Hosting', unit_price: 199, price_unit: 'year' }), 'Hosting is £199.00 a year, plus VAT.');
assert.equal(priceSentence({ name: 'DMARC', unit_price: 150, price_unit: 'one-off' }, { oneOff: 150 }), 'This would be a one-off £150.00, plus VAT.');
assert.equal(priceSentence({ name: 'VE', unit_price: null, price_unit: 'seat', default_mrr: 4 }, {}), '', 'commission (default_mrr) is never quoted');
assert.equal(priceSentence({ name: 'X', unit_price: 1234.5, price_unit: 'month' }), 'X is £1,234.50 a month, plus VAT.');
assert.ok(fillTemplate({ ...hornetPrice, email_body: '{{#price}}{{price}}{{/price}}' }, { quantity: 4 }).text.endsWith('£30.00 a month.'));
assert.equal(unitValue(hornetPrice, 12), 90);
assert.equal(unitValue(hornetPrice, 0), null);
assert.equal(unitValue({ unit_price: 150, price_unit: 'month' }, 3), null, 'only per-unit prices multiply');
assert.ok(!/<Ltd>/.test(mail.html.replace(/<\/?(p|br)>/g, '')), 'values are escaped in the HTML');
assert.equal(fillTemplate({ name: 'X', email_body: 'Hi {{first_name}}' }, {}).text, 'Hi there', 'no contact name → "there"');
const bare = fillTemplate({ name: 'X', email_body: 'Hi,\n\n{{#findings}}We noticed:\n{{findings}}{{/findings}}\n\n{{#price}}Cost: {{price}}{{/price}}\n\nBye' }, {});
assert.equal(bare.text, 'Hi,\n\nBye', 'optional blocks vanish with nothing to say');
assert.equal(fillTemplate({ name: 'X', email_body: '{{evidence}}' }, { findings: ['a'] }).text, '• a', 'old {{evidence}} shows findings only');

// Findings never carry our internal notes.
{
  const m365Only = evaluate({ ...base, cspClient: true, services: [], tickets: [] },
    { key: 'exclaimer', rule: 'missing_if_m365', keywords: 'exclaimer', active: true, sort: 1 }, { now: NOW });
  assert.ok(m365Only.reasons.length && m365Only.findings.length === 0, 'billing gaps stay internal');
  const ve = evaluate({ ...base, dealer: [{ service: 'voip_exchange', quantity: 13, contract: 'out_of_contract', extras: 'no maintenance', notes: 'target first' }] },
    { key: 've_migration', rule: 'voip_exchange', default_mrr: 4, active: true, sort: 1 }, { now: NOW });
  assert.deepEqual(ve.findings, ['13 × VoIP Exchange: out of contract']);
  assert.ok(!ve.findings.join(' ').match(/commission|target/), 'no commission or notes to the client');
}

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

// Dealer list from VoIP Unlimited (11 Oct): call recording = priority upgrade; PSTN lines raise a renewal.
{
  const freeston = { ...base, tickets: [], dealer: [{ service: 'voip_exchange', quantity: 12, contract: 'out_of_contract', extras: '12 x maintenance, 1 x call recording', notes: '' }] };
  const f = evaluate(freeston, ve, { now: NOW });
  assert.match(f.reasons[0], /^Priority/, 'call recording puts the reason first');
  assert.ok(f.findings.some(x => /call-recording service/.test(x)), 'and tells the client in their words');
  assert.ok(!evaluate(cowan, ve, { now: NOW }).reasons.some(x => /^Priority/.test(x)), 'no call recording, no priority');
  const brazier = { ...base, tickets: [], dealer: [{ service: 'voxone', quantity: 1, contract: 'out_of_contract' }, { service: 'pstn', quantity: 1, contract: 'unknown' }] };
  const b = evaluate(brazier, renew, { now: NOW });
  assert.ok(b.reasons.some(x => /1 × PSTN line: .*31 January 2027/.test(x)));
  assert.ok(b.findings.some(x => /analogue \(PSTN\) phone line/.test(x)));
  const nowVox = { ...base, tickets: [], dealer: [{ service: 'voxone', quantity: 13, contract: 'in_contract' }] };
  assert.equal(evaluate(nowVox, ve, { now: NOW }), null, 'moved to VoxOne (Cowan, MSA): no migration');
  assert.equal(evaluate(nowVox, renew, { now: NOW }), null);
  console.log('opportunities dealer list: ok');
}

// New opportunity from the client page (9 Oct)
{
  const { newOpportunity } = await import('../src/core/opportunities.js');
  const hornet = { key: 'email_security', name: 'Hornetsecurity 365 Total Protection', unit_price: 7.5, price_unit: 'user', default_mrr: 45, default_one_off: null };
  let r = newOpportunity({ client: 'Kingdom Products', product: hornet, quantity: '12', owner: 'Philip' });
  assert.equal(r.title, 'Hornetsecurity 365 Total Protection — Kingdom Products');
  assert.equal(r.mrr, 90, '12 users × £7.50');
  assert.equal(r.quantity, 12);
  assert.equal(r.product_key, 'email_security');
  assert.equal(r.status, 'idea');
  assert.equal(newOpportunity({ client: 'K', product: hornet }).mrr, 45, 'no quantity: the default value');
  assert.equal(newOpportunity({ client: 'K', product: hornet, quantity: 12, mrr: '80' }).mrr, 80, 'typed £/month wins');
  r = newOpportunity({ client: 'K', title: ' New website ', oneOff: '1200', status: 'proposed', nextStep: 'Send quote' });
  assert.deepEqual([r.title, r.product_key, r.mrr, r.one_off, r.status, r.next_step], ['New website', null, 0, 1200, 'proposed', 'Send quote']);
  assert.match(newOpportunity({ client: 'K' }).error, /name/);
  assert.match(newOpportunity({ client: '', title: 'x' }).error, /client/);
  assert.equal(newOpportunity({ client: 'K', title: 'x', status: 'won' }).status, 'idea', 'new ones start open');
  console.log('opportunities: newOpportunity ok');
}

// Sharper pipeline (9 Oct)
{
  const { dealState, jobFromDeal, boardColumns } = await import('../src/core/opportunities.js');
  const today = '2026-10-08';
  const s = o => dealState({ status: 'proposed', mrr: 0, one_off: 0, modified_at: '2026-10-07T10:00:00Z', ...o }, today);
  assert.equal(s({}).stale, 0);
  assert.equal(s({ modified_at: '2026-09-20T10:00:00Z' }).stale, 18, 'no change for 18 days');
  assert.equal(s({ modified_at: '2026-09-20T10:00:00Z', follow_up_on: '2026-10-15' }).stale, 0, 'a follow-up still to come is not stale');
  assert.equal(s({ modified_at: '2026-09-20T10:00:00Z', follow_up_on: '2026-10-01' }).stale, 18, 'a missed follow-up does not hide it');
  assert.deepEqual([s({ follow_up_on: today }).followUpDue, s({ follow_up_on: today }).followUpLate], [true, 0]);
  assert.equal(s({ follow_up_on: '2026-10-05' }).followUpLate, 3);
  assert.equal(s({ follow_up_on: '2026-10-11' }).followUpSoon, 3);
  assert.equal(s({ status: 'won', follow_up_on: '2026-10-01' }).followUpDue, false, 'closed deals have no follow-up');
  const won = { id: 7, status: 'won', client_name: 'Cowan', title: 'Server', mrr: 40, one_off: 1200, next_step: 'Order', modified_at: '2026-10-08' };
  assert.deepEqual([s(won).needsJob, s(won).needsBilling], [true, true]);
  assert.deepEqual([s({ ...won, job_id: 3, billing_set_up_at: '2026-10-08' }).needsJob, s({ ...won, job_id: 3, billing_set_up_at: '2026-10-08' }).needsBilling], [false, false]);
  assert.deepEqual(jobFromDeal(won, 'Philip'), { client_name: 'Cowan', title: 'Server', status: 'agreed', value: 1200, next_step: 'Order', owner: 'Philip', notes: 'From the won opportunity “Server”.', source_ref: 'opp:7' });
  const cols = boardColumns([
    { id: 1, status: 'idea', mrr: 10 }, { id: 2, status: 'idea', mrr: 50 }, { id: 3, status: 'proposed', mrr: 5 },
    { id: 4, status: 'won', mrr: 5, closed_at: '2026-09-30' }, { id: 5, status: 'won', mrr: 5, closed_at: '2026-05-01' }, { id: 6, status: 'lost', closed_at: '2026-10-01' }
  ], today);
  assert.deepEqual(cols.map(c => [c.key, c.items.map(o => o.id)]), [['idea', [2, 1]], ['proposed', [3]], ['won', [4]], ['lost', [6]]]);
  console.log('opportunities: pipeline ok');
}

// Gaps map cells
{
  const { mapCell } = await import('../src/core/opportunities.js');
  assert.equal(mapCell({ gap: { strength: 2 }, deal: { status: 'proposed' } }), 'deal', 'a deal beats the gap');
  assert.equal(mapCell({ deal: { status: 'won' } }), 'won');
  assert.equal(mapCell({ gap: { strength: 2 }, deal: { status: 'lost' } }), 'strong', 'a lost deal leaves the gap showing');
  assert.equal(mapCell({ has: true }), 'has');
  assert.equal(mapCell({ status: 'has' }), 'has');
  assert.equal(mapCell({ status: 'not_interested', gap: { strength: 1 } }), 'no');
  assert.equal(mapCell({ status: 'not_applicable' }), '');
  assert.equal(mapCell({ gap: { strength: 1 } }), 'some');
  assert.equal(mapCell({ gap: { strength: 0 } }), 'maybe');
  assert.equal(mapCell({}), '');
  console.log('opportunities: map ok');
}
