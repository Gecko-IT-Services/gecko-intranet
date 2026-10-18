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
  if (win.length) {
    const cat = prod('windows11') ? fromCatalogue(prod('windows11'), client) : null;
    const up = win.filter(d => d.plan === 'upgrade'), rep = win.filter(d => d.plan === 'replace');
    out.push({ key: 'windows', source: 'devices', productKey: 'windows11', checked: true,
      title: `${plural(win.length, 'computer')} on an unsupported version of Windows`,
      subject: `Windows 10 computers at ${client}`,
      why: cat?.why || WINDOWS_WHY,
      items: win.map(d => ({ name: who(d), note: d.plan === 'upgrade' ? 'can move to Windows 11 at no cost for the licence'
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
      why: 'Older versions of Microsoft Office (2016, 2019 and earlier) no longer receive security updates. Documents and email attachments are one of the most common ways in for attackers, so it is worth moving to a supported version.',
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
    out.push({ key: `product:${p.key}`, source: 'opportunity', productKey: p.key, checked: (g.strength || 0) >= 2,
      title: p.name, subject: String(p.email_subject || p.name).replace(/\{\{client\}\}/g, client),
      why: cat.why, items: (g.findings || []).map(f => ({ name: f, note: '' })), benefits: cat.benefits,
      price: p.unit_price != null && p.unit_price !== '' ? priceSentence(p, {}) : '' });
  }
  return out;
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
