/* Advice email: a client's upgrades, protection gaps and product gaps as topics, and one friendly email from the ones ticked.
   Pure logic (no window); tests/advice.mjs. Design: docs/superpowers/specs/2026-10-18-client-advice-email-design.md

   Client-facing only: never our billing, margins, leaks or notes. Product wording comes from the Opportunities catalogue
   (opportunity_products.email_body: the paragraph that explains the problem, and its • benefit bullets), so the email reads
   like the single-product emails Philip already approved. Devices and servers have their own wording here. */

import { priceSentence } from './opportunities.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const who = d => `${d.name}${d.user ? ` (${d.user})` : ''}`;
/** "West Country Fires's" → "West Country Fires'": a name ending in s takes only the apostrophe. */
export const possessive = text => String(text || '').replace(/s's\b/g, "s'").replace(/s’s\b/g, 's’');

/** From a catalogue email: the paragraphs that explain why (after the greeting, before the bullets), and the • benefits. */
export function fromCatalogue(product, client) {
  const fill = s => String(s || '').replace(/\{\{#\w+\}\}[\s\S]*?\{\{\/\w+\}\}/g, '').replace(/\{\{client\}\}/g, client).replace(/\{\{\w+\}\}/g, '');
  const paras = fill(product?.email_body).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const body = paras.filter(p => !/^hi\b/i.test(p) && !/^i hope all is well/i.test(p) && !/^(kind regards|best|thanks)/i.test(p));
  const benefits = body.flatMap(p => p.split('\n')).filter(l => /^\s*[•\-]\s+/.test(l)).map(l => l.replace(/^\s*[•\-]\s+/, '').trim());
  const firstBullets = body.findIndex(p => /^\s*[•\-]\s+/m.test(p));
  const why = body.slice(0, firstBullets < 0 ? 1 : firstBullets)
    .filter(p => !/:\s*$/.test(p) || body.indexOf(p) === 0)        // drop "Keeper makes the safe way the easy way:" lead-ins
    .slice(0, 2).join('\n\n');
  return { why, benefits: benefits.slice(0, 5) };
}

const WINDOWS_WHY = 'Microsoft stopped supporting Windows 10 on 14 October 2025. Computers still running it no longer get security updates, which makes them an easier target for ransomware and can affect Cyber Essentials and insurance.';
const WINDOWS_BENEFITS = ['Security updates again, so every computer stays protected', 'Better built-in security and a quicker, more modern experience',
  'Staying in line with Cyber Essentials and insurers’ expectations', 'Done by us, planned around your team so nobody loses a working day'];

/**
 * The topics worth raising with this client, most important first. Each: { key, title, source, why, items, benefits, price,
 * checked, productKey, subject }. device: the client's entry from core/upgrades.js upgrades() (or null); coverage: its entry
 * from core/coverage.js (or null); gaps: [{ product, strength }] from the Opportunities catalogue (open deals and products
 * the client has, or said no to, already left out); products: the catalogue (for the Windows 11 wording).
 */
export function adviceTopics({ client, device = null, coverage = null, gaps = [], products = [] }) {
  const out = [];
  const prod = key => products.find(p => p.key === key) || null;
  const devs = device?.devices || [];
  // Windows 10/7 PCs: upgrade free where they can, replace where they can't.
  const win = devs.filter(d => d.plan === 'upgrade' || d.plan === 'replace' || (d.findings.some(f => f.what === 'Windows' && f.level === 'asap' && /Windows (10|7|8)/.test(f.text)) && d.plan !== 'server'));
  // (a Windows 11 PC on an unsupported processor is plan 'replace' too, and is told apart in its note)
  if (win.length) {
    const cat = prod('windows11') ? fromCatalogue(prod('windows11'), client) : null;
    const up = win.filter(d => d.plan === 'upgrade'), rep = win.filter(d => d.plan === 'replace');
    out.push({ key: 'windows', source: 'devices', productKey: 'windows11', checked: true,
      title: `${plural(win.length, 'computer')} that can’t get Windows security updates`,
      subject: `Windows 10 computers at ${client}`,
      why: cat?.why || WINDOWS_WHY,
      items: win.map(d => ({ name: who(d), note: d.plan === 'upgrade' ? 'can move to Windows 11 at no cost for the licence'
        : d.plan === 'replace' && /Windows 11/.test(d.os || '') ? 'runs Windows 11 on hardware Microsoft doesn’t support, so it can’t take the current version; we’d recommend replacing it'
        : d.plan === 'replace' ? 'too old to run Windows 11, so we’d recommend replacing it' : 'needs checking: upgrade or replace' })),
      summary: [up.length && `${plural(up.length, 'can be upgraded', 'can be upgraded')} free`, rep.length && `${plural(rep.length, 'needs', 'need')} replacing`].filter(Boolean).join(', '),
      benefits: cat?.benefits?.length ? cat.benefits : WINDOWS_BENEFITS });
  }
  const servers = devs.filter(d => d.plan === 'server');
  if (servers.length) {
    out.push({ key: 'server', source: 'devices', productKey: null, checked: true,
      title: `${plural(servers.length, 'server')} reaching the end of support`, subject: `Planning ahead for ${client}'s server`,
      why: 'Servers hold the files and systems everyone relies on, so they need to stay supported. Once Microsoft stops sending security updates, any new weakness stays open for good.',
      items: servers.map(d => ({ name: d.name, note: d.findings.filter(f => f.what === 'Windows').map(f => f.text.replace(/: /, ', ')).join('; ') || 'ageing' })),
      benefits: ['A supported, secure server, or moving files to SharePoint and the cloud if that suits you better', 'Faster and more reliable than ageing hardware',
        'Planned well ahead, with your data moved over by us and no rush', 'Fewer surprises: no emergency replacement when old hardware gives up'] });
  }
  const office = devs.filter(d => d.findings.some(f => f.what === 'Office' && f.level === 'asap'));
  if (office.length) {
    out.push({ key: 'office', source: 'devices', productKey: null, checked: true,
      title: `${plural(office.length, 'computer')} on an old version of Office`, subject: `Old versions of Office at ${client}`,
      why: 'Office 2021 and older versions (2019, 2016 and earlier) no longer receive security updates; Office 2021’s support ended on 13 October 2026. Documents and email attachments are one of the most common ways in for attackers, so it is worth moving to a supported version.',
      items: office.map(d => ({ name: who(d), note: (d.findings.find(f => f.what === 'Office')?.text || '').replace(/:.*$/, '') })),
      benefits: ['Always up to date: new features and security fixes arrive automatically', 'The same apps on PCs, Macs, tablets and phones',
        'Often included in your Microsoft 365 plan already, so there may be nothing extra to pay', 'Installed and set up by us'] });
  }
  const update = devs.filter(d => d.plan === 'update');
  if (update.length) {
    out.push({ key: 'update', source: 'devices', productKey: null, checked: false,
      title: `${plural(update.length, 'computer')} due the latest Windows 11 update`, subject: `Windows updates at ${client}`,
      why: 'Each version of Windows 11 gets security updates for two years, and some of your computers are on versions that have just reached that point. This is a free update: we’ll schedule it out of hours as part of looking after you.',
      items: update.map(d => ({ name: who(d), note: (d.findings.find(f => f.what === 'Windows')?.text || '').replace(/:.*$/, '') })),
      benefits: ['Security updates continue', 'No cost: part of our normal support', 'Done out of hours, so nobody is interrupted'] });
  }
  // Protection gaps that are the client's to decide (a machine or server nobody pays to back up). Failed or late backups
  // are ours to fix, never put to the client.
  const unprotected = (coverage?.issues || []).filter(i => i.level === 'red' && /no Acronis backup|no plan applied/.test(i.text));
  if (unprotected.length) {
    out.push({ key: 'backup', source: 'protection', productKey: 'endpoint', checked: true,
      title: `${plural(unprotected.length, 'machine')} with no backup`, subject: `Backing up ${client}'s server`,
      why: 'Some of your important machines aren’t backed up at the moment. If a disk fails, or ransomware gets in, the files and systems on them could be lost for good.',
      items: unprotected.map(i => ({ name: i.what, note: 'not backed up' })),
      benefits: ['Automatic backups every night, kept off-site in UK data centres', 'Restore a single file or the whole machine', 'Monitored by us every day, so a failed backup is spotted and fixed',
        'Protection against hardware failure, ransomware and accidents'] });
  }
  // Products from the catalogue the client hasn't got (Windows 11 is covered above when devices show it).
  const covered = new Set(out.map(t => t.productKey).filter(Boolean));
  for (const g of [...gaps].sort((a, b) => (b.strength || 0) - (a.strength || 0))) {
    const p = g.product;
    if (!p || covered.has(p.key)) continue;
    const cat = fromCatalogue(p, client);
    if (!cat.why && !cat.benefits.length) continue;
    covered.add(p.key);   // each product once
    // A Proposed deal has had an email already: there, unticked. An idea is ticked like any strong gap; one added by hand, ticked.
    out.push({ key: `product:${p.key}`, source: 'opportunity', productKey: p.key, deal: g.deal || null, added: !!g.added,
      checked: !!g.added || (g.deal?.status !== 'proposed' && (g.strength || 0) >= 2),
      title: p.name, subject: String(p.email_subject || p.name).replace(/\{\{client\}\}/g, client),
      why: cat.why, items: (g.findings || []).map(f => ({ name: f, note: '' })), benefits: cat.benefits,
      price: p.unit_price != null && p.unit_price !== '' ? priceSentence(p, {}) : '' });
  }
  return out;
}

/**
 * Microsoft 365 backup offered only for what isn't backed up already (Cowans, 19 Oct 2026: SharePoint and Teams were covered, and
 * the email offered them anyway). m365: { sharepoint, teams, mailboxes, onedrive } from Acronis, or null when unknown (unchanged).
 * Everything covered → the topic goes.
 */
export function withM365Cover(topics, m365) {
  if (!m365) return topics;
  const have = [m365.sharepoint && 'SharePoint sites', m365.teams && 'Teams', m365.mailboxes && 'email', m365.onedrive && 'OneDrive'].filter(Boolean);
  const missing = [!m365.mailboxes && 'email', !m365.onedrive && 'OneDrive', !m365.sharepoint && 'SharePoint sites', !m365.teams && 'Teams'].filter(Boolean);
  const list = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
  return topics.flatMap(t => {
    if (t.productKey !== 'm365_backup') return [t];
    if (!missing.length) return [];
    return [{ ...t, title: `Backing up ${list(missing)}`,
      items: [...(have.length ? [{ name: 'Already backed up', note: list(have) }] : []), { name: 'Not backed up yet', note: list(missing) }],
      benefits: [`${list(missing).replace(/^./, c => c.toUpperCase())} backed up automatically every day${have.length ? `, alongside the ${list(have)} we already back up` : ''}`,
        ...t.benefits.filter(b => !/every mailbox|onedrive|sharepoint|teams/i.test(b))] }];
  });
}

/**
 * One email from the ticked topics → { subject, text, html }. firstName: the main contact's; sender: the sign-off.
 */
export function composeEmail({ client, firstName = '', sender = '', topics = [] }) {
  const n = topics.length;
  const devicesOrSafety = topics.some(t => t.source !== 'opportunity');
  const subject = n === 1 ? topics[0].subject : devicesOrSafety ? `Keeping ${client}'s IT secure and up to date` : `A few ideas for ${client}`;
  const intro = n === 1
    ? 'While looking after your systems, we’ve spotted something I wanted to flag with you.'
    : `While looking after your systems, we’ve spotted ${n === 2 ? 'a couple of things' : 'a few things'} worth acting on. I’ve put them in order of importance.`;
  const blocks = topics.map((t, i) => {
    const head = n === 1 ? '' : `${i + 1}. ${t.title}`;
    const items = t.items.length ? `What we can see:\n${t.items.map(x => `• ${x.name}${x.note ? `: ${x.note}` : ''}`).join('\n')}` : '';
    const benefits = t.benefits.length ? `What it means for you:\n${t.benefits.map(b => `• ${b}`).join('\n')}` : '';
    return { head, parts: [t.why, items, benefits, t.price].filter(Boolean) };
  });
  const close = topics.some(t => t.source !== 'opportunity' || t.price)
    ? 'None of this has to happen all at once. We can plan it around you, and we’ll send a clear quote for anything that has a cost before we do anything.'
    : 'There’s no obligation at all; I just thought it worth mentioning.';
  const sign = sender || 'Kind regards,\nGecko IT Services';
  const textParts = [`Hi ${firstName || 'there'},`, `I hope all is well at ${client}.`, intro,
    ...blocks.flatMap(b => [b.head, ...b.parts].filter(Boolean)), close, 'Just reply to this email or give me a call and we’ll take it from there.', sign];
  const text = textParts.join('\n\n');
  const para = p => {
    const lines = p.split('\n');
    const bullets = lines.filter(l => l.startsWith('• '));
    if (!bullets.length) return `<p>${esc(p).replace(/\n/g, '<br>')}</p>`;
    const lead = lines.filter(l => !l.startsWith('• '));
    return `${lead.length ? `<p>${esc(lead.join(' '))}</p>` : ''}<ul>${bullets.map(b => `<li>${esc(b.slice(2))}</li>`).join('')}</ul>`;
  };
  const html = [`<p>Hi ${esc(firstName || 'there')},</p>`, `<p>I hope all is well at ${esc(client)}.</p>`, `<p>${esc(intro)}</p>`,
    ...blocks.map(b => `${b.head ? `<p><strong>${esc(b.head)}</strong></p>` : ''}${b.parts.map(para).join('')}`),
    `<p>${esc(close)}</p>`, '<p>Just reply to this email or give me a call and we’ll take it from there.</p>', `<p>${esc(sign).replace(/\n/g, '<br>')}</p>`].join('\n');
  return { subject: possessive(subject), text: possessive(text), html: possessive(html) };
}

// ─── Facts for the AI email writer (19 Oct: Philip chose AI-written emails from a context note) ───────────────────
// Only what the client may be told. Counts that would expose our own gaps (devices missing antivirus, a backup that failed)
// are never passed: the writer can't mention what it isn't given.

/** SPF / DKIM / DMARC from public DNS answers → client-facing states. */
export function emailAuth({ mx = [], txt = [], dmarc = [], dkim = [] }) {
  const spf = txt.find(t => /v=spf1/i.test(t)) || '';
  const d = dmarc.find(t => /v=DMARC1/i.test(t)) || '';
  const policy = (d.match(/;\s*p=(\w+)/i) || [])[1] || '';
  return {
    provider: mx.some(m => /protection\.outlook\.com/i.test(m)) ? 'Microsoft 365 (no separate filtering service in front)'
      : mx.some(m => /hornetsecurity|mimecast|barracuda|proofpoint/i.test(m)) ? 'a dedicated filtering service' : mx.length ? 'other' : 'unknown',
    spf: spf ? (/-all/.test(spf) ? 'set up, strict' : 'set up, lenient') : 'missing',
    dkim: dkim.length ? 'set up' : 'not found',
    dmarc: d ? (policy === 'reject' || policy === 'quarantine' ? `set up, enforced (${policy})` : 'set up, monitoring only') : 'missing'
  };
}

const SERVICE_WORDS = [[/m365|microsoft 365|office 365/i, 'Microsoft 365 licences'], [/exclaimer|signature/i, 'Email signatures'],
  [/web hosting|website hosting/i, 'Website hosting'], [/domain/i, 'Domain renewal'], [/internet security|antivirus|opentext|webroot/i, 'Business antivirus'],
  [/backup/i, 'Backups'], [/work from home/i, 'Secure remote access'], [/keeper|password/i, 'Password manager'], [/hornet/i, 'Email filtering'],
  [/support|ssa|retainer/i, 'IT support'], [/voip|voxone|phone/i, 'Phones']];
/** What the client gets from Gecko, in its words, from its repeating invoice lines (no prices, no tool names). */
export function servicesFrom(lines) {
  const out = new Set();
  for (const l of lines || []) for (const [re, name] of SERVICE_WORDS) if (re.test(String(l.description || l))) out.add(name);
  return [...out];
}

/**
 * The "IT at a glance" facts. agents: the client's atera_agents rows (with raw); device: its upgrades() entry; acronis: { machines:
 * [{ name, lastSuccess }], m365: { accounts, sharepoint, teams, mailboxes, onedrive } } ; antivirus: how many computers Webroot covers
 * (0 = none; true = yes, count unknown);
 * services: servicesFrom(); email: emailAuth(); topics: adviceTopics() (all, as recommendations); today: YYYY-MM-DD.
 */
export function summaryFacts({ agents = [], device = null, acronis = null, antivirus = false, services = [], email = null, topics = [], leftOut = [], themes = [], today }) {
  const supportPatterns = themes.map(t => ({ theme: t.theme, jobs: t.jobs, hours: t.hours, from: t.from, to: t.to }));
  const day = 86400000, at = new Date(today + 'T12:00:00Z').getTime();
  const recent = agents.filter(a => a.last_seen && at - new Date(a.last_seen).getTime() <= 30 * day);
  const quiet = agents.filter(a => !a.last_seen || at - new Date(a.last_seen).getTime() > 30 * day);
  const os = {};
  for (const a of recent) { const k = /windows 11/i.test(a.os) ? 'Windows 11' : /windows 10/i.test(a.os) ? 'Windows 10' : /windows 7/i.test(a.os) ? 'Windows 7' : /server/i.test(a.os) ? 'Windows Server' : /mac/i.test(a.os) ? 'Mac' : 'Other'; os[k] = (os[k] || 0) + 1; }
  const m365apps = recent.filter(a => /365/i.test(a.raw?.Office || '') || (Number(String(a.raw?.OfficeFullVersion || '').split('.')[0]) >= 16 && !/2016|2019|2021/.test(a.raw?.Office || ''))).length;
  // A backup is only told as current when it is: a late one is ours to fix, never the client's news.
  const freshBackups = (acronis?.machines || []).filter(m => m.lastSuccess && at - new Date(m.lastSuccess).getTime() <= 3 * day)
    .map(m => ({ machine: m.name, lastGoodBackup: String(m.lastSuccess).slice(0, 10) }));
  return {
    computers: { inUseLastMonth: recent.length, byWindowsVersion: os, onCurrentMicrosoft365Apps: m365apps, monitored: recent.length > 0 },
    notSeenForAMonth: quiet.map(a => ({ name: a.machine_name, lastSeen: a.last_seen ? String(a.last_seen).slice(0, 10) : 'never' })),
    microsoft365: acronis?.m365 ? { accounts: acronis.m365.accounts, backedUp: [acronis.m365.sharepoint && 'SharePoint sites', acronis.m365.teams && 'Teams',
      acronis.m365.mailboxes && 'email', acronis.m365.onedrive && 'OneDrive'].filter(Boolean), notBackedUp: [!acronis.m365.mailboxes && 'email', !acronis.m365.onedrive && 'OneDrive'].filter(Boolean) } : null,
    email,
    // "On every computer" only when Webroot's count reaches the computers in use; a shortfall is ours to fix, never the client's news.
    protection: { managedAntivirus: !!antivirus, antivirusOnEveryComputer: typeof antivirus === 'number' && antivirus >= recent.length && recent.length > 0,
      nightlyBackups: freshBackups },
    servicesFromGecko: services,
    recommendations: topics.map(recFacts),
    ...(supportPatterns.length ? { supportPatterns } : {}),
    ...(leftOut.length ? { leaveAlone: leftOut } : {})
  };
}

/** One recommendation as the writer sees it; evidence (their own support history) only when there is some. */
const recFacts = t => ({ title: t.title, why: t.why, items: t.items, benefits: t.benefits, price: t.price || '', ...(t.evidence ? { evidence: t.evidence } : {}) });

const monthYear = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "6 jobs (4.5 hours of support) between Jun 2026 and Oct 2026" from a "What we keep fixing" theme; the figures are Gecko HQ's sums. */
export const themeFigures = t => `${plural(t.jobs, 'job')} (${t.hours} hour${t.hours === 1 ? '' : 's'} of support) ${monthYear(t.from) === monthYear(t.to) ? `in ${monthYear(t.to)}` : `between ${monthYear(t.from)} and ${monthYear(t.to)}`}`;

/**
 * "What we keep fixing" themes attached to the product topic that would stop them (Philip, 19 Oct 2026: AI finds the patterns in six
 * months of timesheet notes; real evidence sells better than a catalogue paragraph). Topics without a matching theme are unchanged.
 */
export function withEvidence(topics, themes = []) {
  if (!themes.length) return topics;
  return topics.map(t => {
    const hits = themes.filter(x => x.product_key && x.product_key === t.productKey);
    if (!hits.length) return t;
    return { ...t, evidence: hits.map(x => `${x.theme}: ${themeFigures(x)}. ${x.client_line}`.trim()).join(' ') };
  });
}

/** The ticked topics as facts for an advice email; leftOut: machines Gecko chose not to raise. */
export const adviceFacts = (topics, leftOut = []) => ({ recommendations: topics.map(recFacts),
  ...(leftOut.length ? { leaveAlone: leftOut } : {}) });

/* ── Leave out one machine (Philip, 19 Oct 2026: ENGINEER-HP2 is the Windows 7 PC kept for TimFram, and only a whole topic could
   be unticked). Remembered per client in client_notes.left_out. ── */

/** The machine an item is about: "PAULAPCNEW (Paula)" → "PAULAPCNEW". */
export const itemKey = i => String(i?.key ?? i?.name ?? '').replace(/\s*\(.*\)\s*$/, '').trim();

/** Topics without the left-out machines; a device topic with none left goes, and its count is redone. Catalogue topics are untouched. */
export function leaveOut(topics, names) {
  const out = new Set((names || []).map(n => String(n).toUpperCase()));
  if (!out.size) return topics;
  return topics.flatMap(t => {
    if (t.source === 'opportunity') return [t];
    const items = t.items.filter(i => !out.has(itemKey(i).toUpperCase()));
    if (items.length === t.items.length) return [t];
    if (!items.length) return [];
    return [{ ...t, items, summary: '', title: t.title.replace(/^\d+ (computer|server|machine)s?\b/, (_, w) => plural(items.length, w)) }];
  });
}

/* ── What the AI will be told, for Philip to read before writing (19 Oct 2026: the Teams backup error was visible in the facts). ── */

const list = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
const shortDay = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * summaryFacts() as lines to read → [[label, text]]. antivirusCount: how many computers Webroot covers (shown here, never sent);
 * kind 'advice' shows only the recommendations.
 */
export function factsPanel(facts, { kind = 'summary', antivirusCount = null, sell = [] } = {}) {
  const rows = [];
  const recs = facts?.recommendations || [];
  // A sales tool first (Philip, 19 Oct 2026: "i want to be using this to sell gaps in the product range"): what's being sold, at the top.
  rows.push(['Selling', sell.length ? sell.map(t => `${t.title}${t.price ? ` (${t.price.replace(/\.$/, '').replace(/^.*?\bis\s+(?=£)/, '')})` : ''}${t.evidence ? ' + evidence from their support history' : ''}`).join(' · ') : 'no products ticked: tick a gap under What to raise to sell it']);
  if (kind === 'summary') {
    const c = facts.computers || {};
    const os = Object.entries(c.byWindowsVersion || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
    rows.push(['Computers', `${c.inUseLastMonth || 0} in use in the last month${os ? `: ${os}` : ''}; ${c.onCurrentMicrosoft365Apps || 0} on current Microsoft 365 apps`]);
    const p = facts.protection || {};
    rows.push(['Antivirus', !p.managedAntivirus ? 'none (it won’t mention antivirus)'
      : `${typeof antivirusCount === 'number' ? `on ${antivirusCount} of ${c.inUseLastMonth || 0}` : 'in place'}; told ${p.antivirusOnEveryComputer ? '“on every computer”' : '“in place”, not “every computer”'}`]);
    rows.push(['Nightly backups', (p.nightlyBackups || []).length ? p.nightlyBackups.map(b => `${b.machine} (${shortDay(b.lastGoodBackup)})`).join(', ') : 'none current (it won’t mention machine backups)']);
    const m = facts.microsoft365;
    rows.push(['Microsoft 365 backup', !m ? 'not known (it won’t mention it)' : `${m.backedUp.length ? `backed up: ${list(m.backedUp)}` : 'nothing backed up'}${m.notBackedUp.length ? `; not backed up: ${list(m.notBackedUp)}` : ''}`]);
    const e = facts.email;
    rows.push(['Email', !e ? 'still checking, or not known' : `${e.provider}; SPF ${e.spf}, DKIM ${e.dkim}, DMARC ${e.dmarc}`]);
    if ((facts.servicesFromGecko || []).length) rows.push(['From Gecko', list(facts.servicesFromGecko)]);
    if ((facts.notSeenForAMonth || []).length) rows.push(['Not seen for a month', facts.notSeenForAMonth.map(n => n.name).join(', ')]);
  }
  const q = facts?.lastThreeMonths;
  if (q) rows.push(['Last three months', q.jobs ? `${plural(q.jobs, 'job')}, ${q.hours} hours: ${q.byType.map(t => `${t.type} ${t.hours}h`).join(', ')}` : 'no support logged']);
  rows.push(['Recommendations', recs.length ? recs.map(r => `${r.title}${(r.items || []).length ? `: ${r.items.map(i => itemKey(i)).join(', ')}` : ''}`).join(' · ') : 'none ticked']);
  if ((facts?.leaveAlone || []).length) rows.push(['Left out', facts.leaveAlone.join(', ')]);
  return rows;
}

/* ── Gecko HQ's own check of what came back (no AI, no cost): the things a customer would catch. ── */

const TOOLS = /\b(Atera|Acronis|Webroot|Supabase|Gecko HQ)\b/i;
const MONEY = /\b(margins?|mark-?up|our costs?|we pay|leaks?|under-?billed|over-?billed|unbilled)\b/i;
const TELLS = ['crucial', 'delve', 'enhance', 'foster', 'garner', 'intricate', 'landscape', 'pivotal', 'seamless', 'showcase', 'tapestry',
  'testament', 'underscore', 'vibrant', 'robust', 'leverage', 'streamline', 'additionally', 'moreover', 'game-changer', 'peace of mind'];
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const COUNTED = '(?:computers?|machines?|pcs?|laptops?|servers?|people|users|mailboxes|accounts|sites|devices)';
const COVER_TERMS = { 'SharePoint sites': /sharepoint/i, Teams: /\bteams\b/i, email: /\b(mailbox(es)?|emails?)\b/i, OneDrive: /onedrive/i };
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Problems in an AI email → [{ level: 'red'|'amber', text }]. text: the email as plain text; facts: what it was told; note: the
 * setup note; machines: every machine name the client has in Atera; leftOut: machines not to raise.
 */
export function checkEmail(text, { facts = {}, note = '', machines = [], leftOut = [] } = {}) {
  const t = String(text || '');
  const out = [];
  const add = (level, msg) => { if (!out.some(o => o.text === msg)) out.push({ level, text: msg }); };
  const sentences = t.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  const known = (JSON.stringify(facts) + ' ' + note).toLowerCase();
  const tool = t.match(TOOLS);
  if (tool) add('red', `Names an internal tool: ${tool[1]}.`);
  const money = t.match(MONEY);
  if (money) add('red', `Talks about “${money[1]}”: our costs and billing stay private.`);
  for (const n of leftOut) if (new RegExp(`\\b${reEsc(n)}\\b`, 'i').test(t)) add('amber', `Mentions ${n}, which you left out: make sure nothing is recommended for it.`);
  for (const m of machines) {
    if (!m || leftOut.some(n => n.toUpperCase() === m.toUpperCase())) continue;
    if (new RegExp(`\\b${reEsc(m)}\\b`, 'i').test(t) && !known.includes(m.toLowerCase())) add('amber', `Names ${m}, which it wasn’t told about.`);
  }
  // Numbers: every figure should come from the facts or the note.
  const allowed = new Set((known.match(/\d+(?:\.\d+)?/g) || []).map(Number));
  for (const m of t.matchAll(/(?<![\w£$.])(\d+(?:\.\d+)?)(?![\w.]*\d)/g)) { const n = Number(m[1]); if (!allowed.has(n)) add('amber', `Says ${m[1]}, which isn’t in the facts or your note.`); }
  for (const m of t.matchAll(new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\s+(?:of\\s+(?:your|the|them|those)\\s+)?${COUNTED}\\b`, 'gi'))) {
    const n = WORDS[m[1].toLowerCase()];
    if (!allowed.has(n)) add('amber', `Says “${m[0]}”, but ${n} isn’t in the facts or your note.`);
  }
  // "Every" / "all" claims about now, one clause at a time ("All of them are monitored by us, and managed antivirus is in place" is two
  // true claims). Monitored is always true (every machine in Atera is); a product's pitch ("would be backed up") is not a claim.
  const every = !!facts.protection?.antivirusOnEveryComputer;
  for (const s of sentences) for (const c of s.split(/,\s*(?:and|but)\s+|;\s*/)) {
    if (!/\b(every|all)\b/i.test(c) || /\b(would|will|could|can)\b|’d|'d/i.test(c)) continue;
    if (/antivirus/i.test(c)) { if (!every) add('red', `“${s}”: antivirus isn’t on every computer.`); continue; }
    if (/\b(computers?|pcs?|machines?|devices?|all of (them|those))\b/i.test(c) && /\b(protected|backed up|up to date|supported|secure|patched)\b/i.test(c))
      add('amber', `“${s}”: check that’s true of every one.`);
  }
  if ((facts.recommendations || []).length && /\b(none of (this|it) is|isn[’']t|is not|not)\s+(really\s+)?urgent\b/i.test(t))
    add('amber', 'Says it isn’t urgent: this is a sales email, and some of it (no security updates) is time-sensitive.');
  // Offering backup of what is already backed up.
  for (const k of facts.microsoft365?.backedUp || []) {
    const term = COVER_TERMS[k];
    if (!term) continue;
    for (const s of sentences) if (/back(ed)?[\s-]?up/i.test(s) && term.test(s) && !/already|(is|are) backed up|covered|in place/i.test(s)) {
      add('amber', `Offers ${k} backup, but ${k} is already backed up: “${s}”`);
      break;
    }
  }
  if (/[\u2013\u2014]/.test(t)) add('amber', 'Has a long dash (an AI tell).');
  for (const w of TELLS) if (new RegExp(`\\b${reEsc(w)}\\b`, 'i').test(t)) add('amber', `Uses “${w}” (an AI tell).`);
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));
}

/* ── Quarterly review (Philip, 19 Oct 2026: "1-3 i like very much"; this is 2): the last three months of support, Gecko HQ's sums. ── */

/**
 * The last three months from timesheet entries (System, deleted and zero-hour entries already left out by the reader). from/to:
 * YYYY-MM-DD. → { from, to, jobs, hours, byType: [{ type, jobs, hours }], examples: newest distinct job titles (at most 40) }.
 */
export function quarterFacts(entries, { from, to }) {
  const rows = (entries || []).filter(e => e.entry_date >= from && e.entry_date <= to && Number(e.hours) > 0);
  const r2 = n => Math.round(n * 100) / 100;
  const by = new Map();
  for (const e of rows) {
    const k = String(e.work_type || '').trim() || 'Support';
    const x = by.get(k) || { type: k, jobs: 0, hours: 0 };
    x.jobs++; x.hours = r2(x.hours + Number(e.hours));
    by.set(k, x);
  }
  const seen = new Set();
  const examples = [...rows].sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)))
    .map(e => String(e.title || e.work_description || '').trim()).filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 40);
  return { from, to, jobs: rows.length, hours: r2(rows.reduce((t, e) => t + Number(e.hours), 0)),
    byType: [...by.values()].sort((a, b) => b.hours - a.hours || a.type.localeCompare(b.type)), examples };
}