import assert from 'node:assert/strict';
import { fromCatalogue, adviceTopics, composeEmail, emailAuth, servicesFrom, summaryFacts, adviceFacts, withM365Cover, leaveOut, itemKey, factsPanel, checkEmail, withEvidence, themeFigures, quarterFacts } from '../src/core/advice.js';

// Catalogue wording as it is in opportunity_products (18 Oct 2026, shortened).
const keeper = { key: 'keeper', name: 'Keeper password manager', unit_price: null, price_unit: 'user', email_subject: 'A safer, simpler way to manage passwords at {{client}}',
  email_body: 'Hi {{first_name}},\n\nI hope all is well at {{client}}.\n\nMost teams have more passwords than anyone can remember, so they end up reused, written down or kept in a spreadsheet.\n\nKeeper makes the safe way the easy way:\n\n• Each person gets their own encrypted vault\n• Strong passwords created and filled in automatically\n\n{{#findings}}Also worth knowing:\n{{findings}}{{/findings}}\n\n{{#price}}{{price}}{{/price}}\n\nWe\'d be happy to show you how it works.\n\n{{sender}}' };
const hornet = { key: 'email_security', name: 'Hornetsecurity 365 Total Protection', unit_price: 7.5, price_unit: 'user', email_subject: 'Keeping phishing emails away from {{client}}',
  email_body: 'Hi {{first_name}},\n\nI hope all is well at {{client}}.\n\nEmail is still the most common way criminals target small businesses.\n\n• Phishing and fake invoices stopped before they arrive\n\n{{sender}}' };
const win11 = { key: 'windows11', name: 'Windows 11 upgrade / PC refresh', email_subject: 'Windows 10 computers at {{client}}',
  email_body: 'Hi {{first_name}},\n\nI hope all is well at {{client}}.\n\nMicrosoft stopped supporting Windows 10 on 14 October 2025.\n\n{{#findings}}What we can see:\n{{findings}}{{/findings}}\n\nMoving to Windows 11 means:\n\n• Security updates again\n• A planned upgrade done by us\n\n{{sender}}' };

// — The catalogue's why and benefits. —
const k = fromCatalogue(keeper, 'CDA Ltd');
assert.equal(k.why, 'Most teams have more passwords than anyone can remember, so they end up reused, written down or kept in a spreadsheet.');
assert.deepEqual(k.benefits, ['Each person gets their own encrypted vault', 'Strong passwords created and filled in automatically']);
assert.equal(fromCatalogue(win11, 'WCF').why, 'Microsoft stopped supporting Windows 10 on 14 October 2025.');

// — Topics from West Country Fires' real findings (18 Oct). —
const f = (what, level, text, fix) => ({ what, level, text, fix });
const device = { devices: [
  { name: 'PAULAPCNEW', user: 'Paula', plan: 'replace', level: 'asap', findings: [f('Windows', 'asap', 'Windows 10: no security updates since 14 Oct 2025', 'Replace'), f('Office', 'asap', 'Office 2013: no security updates since 11 Apr 2023', 'Move')] },
  { name: 'SAGEPC', user: 'Dannii', plan: 'upgrade', level: 'asap', findings: [f('Windows', 'asap', 'Windows 10: no security updates since 14 Oct 2025', 'Upgrade')] },
  { name: 'DI-PC', user: 'Di', plan: 'update', level: 'asap', findings: [f('Windows', 'asap', 'Windows 11 24H2: no security updates since 13 Oct 2026', 'Install')] },
  { name: 'TSERVER', user: '', plan: 'server', level: 'soon', findings: [f('Windows', 'soon', 'Windows Server 2016: support ends 12 Jan 2027', 'Plan')] }
] };
const coverage = { issues: [{ level: 'red', what: 'DCSERVER', text: 'Domain Controller in Atera with no Acronis backup' }, { level: 'red', what: 'Tserver.wcf.local', text: 'No good backup since 2026-04-18' }] };
const topics = adviceTopics({ client: 'West Country Fires', device, coverage, gaps: [{ product: keeper, strength: 1 }, { product: win11, strength: 2 }, { product: hornet, strength: 2 }], products: [win11, keeper] });
assert.deepEqual(topics.map(t => [t.key, t.checked]), [['windows', true], ['server', true], ['office', true], ['update', false], ['backup', true], ['product:email_security', true], ['product:keeper', false]],
  'devices first; the routine Windows 11 update unticked; catalogue Windows 11 not repeated; strong gaps ticked');
const w = topics[0];
assert.equal(w.title, '2 computers that can’t get Windows security updates');
assert.deepEqual(w.items.map(i => i.name), ['PAULAPCNEW (Paula)', 'SAGEPC (Dannii)']);
assert.match(w.items[0].note, /replacing/);
assert.match(w.items[1].note, /no cost/);
assert.deepEqual(w.benefits, ['Security updates again', 'A planned upgrade done by us'], 'the catalogue’s own bullets');
assert.deepEqual(topics.find(t => t.key === 'backup').items.map(i => i.name), ['DCSERVER'], 'a late backup is ours to fix, never put to the client');
assert.match(topics.find(t => t.key === 'product:email_security').price, /£7\.50 per user/);

// — The email. —
const pick = topics.filter(t => t.checked);
const mail = composeEmail({ client: 'West Country Fires', firstName: 'Tim', sender: 'Kind regards,\nPhilip Morris\nGecko IT Services', topics: pick });
assert.equal(mail.subject, 'Keeping West Country Fires\' IT secure and up to date', 'a name ending in s: just the apostrophe');
assert.match(mail.text, /^Hi Tim,\n\nI hope all is well at West Country Fires\./);
assert.match(mail.text, /1\. 2 computers that can’t get Windows security updates/);
assert.match(mail.text, /• PAULAPCNEW \(Paula\): too old to run Windows 11/);
assert.match(mail.text, /What it means for you:\n• Security updates again/);
assert.match(mail.text, /we’ll send a clear quote for anything that has a cost/);
assert.match(mail.text, /Philip Morris\nGecko IT Services$/);
assert.doesNotMatch(mail.text, /margin|leak|Atera|Acronis|Tserver\.wcf|No good backup/i, 'nothing internal, no tool names');
assert.match(mail.text, /• TSERVER: Windows Server 2016, support ends 12 Jan 2027/);
assert.match(mail.html, /<ul><li>PAULAPCNEW \(Paula\): too old/);
assert.match(mail.html, /<strong>1\. 2 computers/);
// One topic: its own subject, no numbering.
const one = composeEmail({ client: 'CDA Ltd', firstName: '', topics: [topics.find(t => t.key === 'product:keeper')] });
assert.equal(one.subject, 'A safer, simpler way to manage passwords at West Country Fires');
assert.match(one.text, /^Hi there,/);
assert.doesNotMatch(one.text, /^1\./m);
assert.match(one.text, /no obligation/);

// — Facts for the AI writer (Cowans, 18–19 Oct 2026). —
assert.deepEqual(emailAuth({ mx: ['0 cowanconsult-co-uk.mail.protection.outlook.com.'], txt: ['"v=spf1 include:spf.protection.outlook.com include:spf.exclaimer.net -all"'],
  dmarc: ['"v=DMARC1; p=quarantine; rua=mailto:dmarc@cowanconsult.co.uk; pct=100"'], dkim: ['selector1-…'] }),
  { provider: 'Microsoft 365 (no separate filtering service in front)', spf: 'set up, strict', dkim: 'set up', dmarc: 'set up, enforced (quarantine)' });
assert.equal(emailAuth({}).dmarc, 'missing');
assert.deepEqual(servicesFrom(['Atera - Internet Security & Backup & Work from Home (x5)', 'Web Hosting - 1 year', 'Domain Renewal - cowanconsult.co.uk', 'M365 Subscription', 'Exclaimer Signature Server Side']).sort(),
  ['Backups', 'Business antivirus', 'Domain renewal', 'Email signatures', 'Microsoft 365 licences', 'Secure remote access', 'Website hosting']);
const agents = [
  { machine_name: 'CHRIS-PC', os: 'Microsoft Windows 11 Pro  x64', last_seen: '2026-10-16T10:00:00Z', raw: { Office: 'Microsoft Office 365 Business', OfficeFullVersion: '16.0.1' } },
  { machine_name: 'TEKLA', os: 'Microsoft Windows 10 Pro  x64', last_seen: '2026-10-18T10:00:00Z', raw: {} },
  { machine_name: 'CCL-FILE-SERVER', os: 'Microsoft Windows 11 Pro  x64', last_seen: '2026-10-18T10:00:00Z', raw: { Office: 'Microsoft Office Professional Plus 2019', OfficeFullVersion: '16.0.1' } },
  { machine_name: 'ENGINEER-IOW', os: 'Microsoft Windows 10 Home  x64', last_seen: '2024-06-10T10:00:00Z', raw: {} }];
const sf = summaryFacts({ agents, today: '2026-10-19', antivirus: true, services: ['Backups'], topics: [],
  acronis: { machines: [{ name: 'SagePC', lastSuccess: '2026-10-18T18:15:02Z' }, { name: 'OldPC', lastSuccess: '2026-04-18T19:40:39Z' }],
    m365: { accounts: 15, sharepoint: true, teams: true, mailboxes: false, onedrive: false } } });
assert.deepEqual(sf.computers, { inUseLastMonth: 3, byWindowsVersion: { 'Windows 11': 2, 'Windows 10': 1 }, onCurrentMicrosoft365Apps: 1, monitored: true });
assert.deepEqual(sf.notSeenForAMonth, [{ name: 'ENGINEER-IOW', lastSeen: '2024-06-10' }]);
assert.deepEqual(sf.protection.nightlyBackups, [{ machine: 'SagePC', lastGoodBackup: '2026-10-18' }], 'a stale backup is never told as current');
assert.deepEqual(sf.microsoft365, { accounts: 15, backedUp: ['SharePoint sites', 'Teams'], notBackedUp: ['email', 'OneDrive'] });
assert.doesNotMatch(JSON.stringify(sf), /Atera|Acronis|Webroot|margin|cost/i, 'nothing internal in the facts');
assert.equal(adviceFacts(pick).recommendations.length, pick.length);
assert.equal(sf.protection.antivirusOnEveryComputer, false, 'a yes with no count never becomes "every computer"');
const sfAv = n => summaryFacts({ agents, today: '2026-10-19', antivirus: n }).protection;
assert.deepEqual([sfAv(17).antivirusOnEveryComputer, sfAv(3).antivirusOnEveryComputer, sfAv(2).antivirusOnEveryComputer, sfAv(0).managedAntivirus], [true, true, false, false],
  '3 computers in use: 3 covered is every one, 2 is not');

// — Microsoft 365 backup offered only for what isn't covered (Cowans, 19 Oct 2026). —
const m365b = { key: 'product:m365_backup', productKey: 'm365_backup', title: 'Microsoft 365 backup (Acronis)', items: [],
  benefits: ['Every mailbox, OneDrive, SharePoint site and Teams backed up automatically, every day', 'Copies kept separately from Microsoft, in UK data centres'] };
const [cov] = withM365Cover([m365b], { sharepoint: true, teams: true, mailboxes: false, onedrive: false });
assert.equal(cov.title, 'Backing up email and OneDrive');
assert.deepEqual(cov.items, [{ name: 'Already backed up', note: 'SharePoint sites and Teams' }, { name: 'Not backed up yet', note: 'email and OneDrive' }]);
assert.deepEqual(cov.benefits, ['Email and OneDrive backed up automatically every day, alongside the SharePoint sites and Teams we already back up', 'Copies kept separately from Microsoft, in UK data centres']);
assert.deepEqual(withM365Cover([m365b], { sharepoint: true, teams: true, mailboxes: true, onedrive: true }), [], 'all covered: nothing to offer');
assert.equal(withM365Cover([m365b], null)[0], m365b, 'unknown: unchanged');
assert.match(adviceTopics({ client: 'X', device }).find(t => t.key === 'office').why, /Office 2021 and older/);

// — Leave one machine out (Cowans' ENGINEER-HP2, 19 Oct 2026). —
assert.equal(itemKey({ name: 'PAULAPCNEW (Paula)' }), 'PAULAPCNEW');
const lo = leaveOut(topics, ['paulapcnew']);
assert.equal(lo.find(t => t.key === 'windows').title, '1 computer that can’t get Windows security updates');
assert.deepEqual(lo.find(t => t.key === 'windows').items.map(i => i.name), ['SAGEPC (Dannii)']);
assert.equal(lo.find(t => t.key === 'office'), undefined, 'a topic with every machine left out goes');
assert.equal(leaveOut(topics, ['DCSERVER']).find(t => t.key === 'backup'), undefined);
assert.equal(leaveOut(topics, []), topics);
assert.deepEqual(adviceFacts(lo, ['PAULAPCNEW']).leaveAlone, ['PAULAPCNEW'], 'the writer is told what was left out');
assert.equal(adviceFacts(lo).leaveAlone, undefined);

// — What the AI will be told. —
const panelFacts = summaryFacts({ agents, today: '2026-10-19', antivirus: 2, services: ['Backups', 'Website hosting'], topics: lo, leftOut: ['PAULAPCNEW'],
  acronis: { machines: [{ name: 'SagePC', lastSuccess: '2026-10-18T18:15:02Z' }], m365: { accounts: 15, sharepoint: true, teams: true, mailboxes: false, onedrive: false } } });
const panel = Object.fromEntries(factsPanel(panelFacts, { antivirusCount: 2, sell: lo.filter(t => t.productKey) }));
assert.equal(panel.Selling, '1 computer that can’t get Windows security updates · 1 machine with no backup · Hornetsecurity 365 Total Protection (£7.50 per user a month, plus VAT) · Keeper password manager');
assert.equal(panel.Computers, '3 in use in the last month: 2 Windows 11, 1 Windows 10; 1 on current Microsoft 365 apps');
assert.equal(panel.Antivirus, 'on 2 of 3; told “in place”, not “every computer”');
assert.equal(panel['Microsoft 365 backup'], 'backed up: SharePoint sites and Teams; not backed up: email and OneDrive');
assert.equal(panel['Nightly backups'], 'SagePC (18 Oct)');
assert.equal(panel['Left out'], 'PAULAPCNEW');
assert.match(panel.Recommendations, /1 computer that can’t get Windows security updates: SAGEPC/);
assert.equal(Object.fromEntries(factsPanel(panelFacts, { kind: 'advice' })).Computers, undefined, 'an advice email gets the recommendations only');
assert.match(Object.fromEntries(factsPanel({ recommendations: [] })).Selling, /no products ticked/);

// — Gecko HQ's check of what came back: the holes in the Cowans emails, 19 Oct 2026. —
const cf = { computers: { inUseLastMonth: 22 }, protection: { managedAntivirus: true, antivirusOnEveryComputer: false },
  microsoft365: { backedUp: ['SharePoint sites', 'Teams'], notBackedUp: ['email', 'OneDrive'] }, recommendations: [{ title: '3 computers', items: [{ name: 'DANPC (Dan)' }] }] };
const ck = (text, o = {}) => checkEmail(text, { facts: cf, note: 'Whiteley has a 1gb ethernet circuit', machines: ['DANPC', 'ENGINEER-HP2', 'DAVIDPC'], ...o }).map(x => `${x.level}: ${x.text}`);
assert.deepEqual(ck('3. Backup for mailboxes, OneDrive and Teams. Your SharePoint documents are already covered.'),
  ['amber: Offers Teams backup, but Teams is already backed up: “Backup for mailboxes, OneDrive and Teams.”'], 'the Teams error is caught; the true SharePoint sentence is not');
assert.deepEqual(ck('Managed antivirus runs on all of them.'), ['red: “Managed antivirus runs on all of them.”: antivirus isn’t on every computer.']);
assert.deepEqual(ck('All of them are monitored by us, and managed antivirus is in place.'), [], 'two true claims in one sentence');
assert.deepEqual(ck('All 22 computers are backed up every night.'), ['amber: “All 22 computers are backed up every night.”: check that’s true of every one.']);
assert.deepEqual(ck('None of this is urgent.'), ['amber: Says it isn’t urgent: this is a sales email, and some of it (no security updates) is time-sensitive.']);
assert.deepEqual(ck('Every mailbox and OneDrive would be backed up automatically, every day.'), [], 'the pitch is not a claim');
assert.deepEqual(ck('22 computers were in use. Your line is 1Gb. DANPC needs replacing.'), [], 'numbers and machines from the facts and the note');
assert.deepEqual(ck('21 computers were in use, and four computers need replacing.'), ['amber: Says 21, which isn’t in the facts or your note.', 'amber: Says “four computers”, but 4 isn’t in the facts or your note.']);
assert.deepEqual(ck('DAVIDPC is old too.'), ['amber: Names DAVIDPC, which it wasn’t told about.']);
assert.deepEqual(ck('ENGINEER-HP2 should be replaced.', { leftOut: ['ENGINEER-HP2'] }), ['amber: Mentions ENGINEER-HP2, which you left out: make sure nothing is recommended for it.']);
assert.deepEqual(ck('Acronis backs it up and our margin is fine.').map(x => x.split(':')[0]), ['red', 'red']);
assert.deepEqual(ck('It works seamlessly — and it is seamless.'), ['amber: Has a long dash (an AI tell).', 'amber: Uses “seamless” (an AI tell).']);

// — Open deals and products added by hand (19 Oct 2026). —
const dealt = adviceTopics({ client: 'Cowans', gaps: [{ product: hornet, strength: 2, deal: { status: 'proposed', id: 31, since: '2026-10-19' } },
  { product: keeper, strength: 2, deal: { status: 'idea', id: 12 } }, { product: keeper, strength: 0, added: true }] });
assert.deepEqual(dealt.map(t => [t.key, t.checked, t.deal?.status || null, t.added]),
  [['product:email_security', false, 'proposed', false], ['product:keeper', true, 'idea', false]], 'Proposed: listed, unticked; an idea ticked; no product twice');
assert.deepEqual(adviceTopics({ client: 'Cowans', gaps: [{ product: keeper, strength: 0, added: true }] }).map(t => [t.checked, t.added]), [[true, true]], 'added by hand: ticked');

// — What we keep fixing → evidence on the product that would stop it (19 Oct 2026). —
const phish = { theme: 'Suspicious and phishing emails', product_key: 'email_security', jobs: 6, hours: 4.5, from: '2026-06-03', to: '2026-10-19',
  client_line: 'A filter in front of your mailboxes would stop most of these before anyone sees them.' };
assert.equal(themeFigures(phish), '6 jobs (4.5 hours of support) between Jun 2026 and Oct 2026');
assert.equal(themeFigures({ ...phish, jobs: 1, hours: 1, from: '2026-10-01' }), '1 job (1 hour of support) in Oct 2026');
const evT = withEvidence(dealt, [phish, { ...phish, theme: 'Printers', product_key: null }]);
assert.equal(evT[0].evidence, 'Suspicious and phishing emails: 6 jobs (4.5 hours of support) between Jun 2026 and Oct 2026. A filter in front of your mailboxes would stop most of these before anyone sees them.');
assert.equal(evT[1].evidence, undefined, 'only the product the theme points at');
assert.equal(withEvidence(dealt, []), dealt);
assert.equal(adviceFacts(evT).recommendations[0].evidence, evT[0].evidence, 'the writer gets it');
assert.equal('evidence' in adviceFacts(evT).recommendations[1], false);
assert.deepEqual(summaryFacts({ agents, today: '2026-10-19', themes: [phish] }).supportPatterns, [{ theme: 'Suspicious and phishing emails', jobs: 6, hours: 4.5, from: '2026-06-03', to: '2026-10-19' }]);
assert.match(Object.fromEntries(factsPanel({ recommendations: [] }, { sell: evT.slice(0, 1) })).Selling, /\+ evidence from their support history/);
assert.deepEqual(checkEmail('We helped with 6 suspicious emails, 4.5 hours of your support time.', { facts: adviceFacts(evT) }), [], 'its figures are known numbers');

// — Quarterly review: the last three months, Gecko HQ's sums. —
const qe = [
  { entry_date: '2026-10-19', hours: 0.25, work_type: 'Remote Support', title: 'Moved Lena’s email capture to Jacqui' },
  { entry_date: '2026-09-02', hours: 1.5, work_type: 'Onsite', title: 'New PC for Dan' },
  { entry_date: '2026-08-01', hours: 0.75, work_type: 'Remote Support', title: 'Moved Lena’s email capture to Jacqui' },
  { entry_date: '2026-06-30', hours: 2, work_type: 'Onsite', title: 'Before the quarter' },
  { entry_date: '2026-08-15', hours: 0.5, work_type: '', title: 'Printer' }];
const q = quarterFacts(qe, { from: '2026-07-20', to: '2026-10-19' });
assert.deepEqual([q.jobs, q.hours], [4, 3]);
assert.deepEqual(q.byType, [{ type: 'Onsite', jobs: 1, hours: 1.5 }, { type: 'Remote Support', jobs: 2, hours: 1 }, { type: 'Support', jobs: 1, hours: 0.5 }]);
assert.deepEqual(q.examples, ['Moved Lena’s email capture to Jacqui', 'New PC for Dan', 'Printer'], 'newest first, each once');
assert.equal(Object.fromEntries(factsPanel({ recommendations: [], lastThreeMonths: q }))['Last three months'], '4 jobs, 3 hours: Onsite 1.5h, Remote Support 1h, Support 0.5h');
assert.equal(quarterFacts([], { from: '2026-07-20', to: '2026-10-19' }).jobs, 0);

console.log('advice: ok');
