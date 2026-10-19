import assert from 'node:assert/strict';
import { fromCatalogue, adviceTopics, composeEmail, emailAuth, servicesFrom, summaryFacts, adviceFacts, withM365Cover } from '../src/core/advice.js';

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

console.log('advice: ok');
