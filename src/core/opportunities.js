/**
 * Opportunities — the pure logic (docs/superpowers/specs/2026-10-08-opportunities-design.md).
 *
 * Given what a client already buys, how their email and website are set up and
 * what they keep calling us about, decide which products in the catalogue are
 * gaps, with the evidence in words Philip can put in front of the client.
 *
 * No window, no network: the section gathers the data and passes it in.
 * Tests: tests/opportunities.mjs.
 */

/** Thresholds Philip can tune here (design note, open question 3). */
export const THRESHOLDS = {
  seoBelow: 80,            // PageSpeed SEO score (mobile) below this → SEO gap
  performanceBelow: 50,    // PageSpeed performance (mobile) below this → website/SEO gap
  ticketHits: 2,           // timesheet entries matching a product's phrases in the window
  ticketMonths: 6,         // how far back timesheets are read
  supportHours: 3          // reactive hours in the window that make a support block worth offering
};

const FILTER_MX = [
  [/hornetsecurity|hornet\.email/i, 'Hornetsecurity'],
  [/mimecast/i, 'Mimecast'],
  [/pphosted|proofpoint/i, 'Proofpoint'],
  [/barracuda/i, 'Barracuda'],
  [/messagelabs|symantec/i, 'Symantec'],
  [/spamtitan|titanhq/i, 'SpamTitan']
];

/** MX hostnames → who handles their mail, and whether a filter sits in front. */
export function classifyMx(hosts = []) {
  const all = hosts.map(h => String(h).toLowerCase().replace(/\.$/, ''));
  if (!all.length) return { provider: 'none', filter: null };
  const filter = FILTER_MX.find(([re]) => all.some(h => re.test(h)))?.[1] || null;
  let provider = 'other';
  if (all.some(h => h.endsWith('.mail.protection.outlook.com'))) provider = 'microsoft';
  else if (all.some(h => /(^|\.)google(mail)?\.com$|aspmx\.l\.google\.com$/.test(h))) provider = 'google';
  else if (filter) provider = 'filtered';   // M365 behind a filter shows only the filter's MX
  return { provider, filter };
}

/** SPF text from the root TXT records: missing | ok | soft | open (+all) | multiple. */
export function spfStatus(txt = []) {
  const spf = txt.map(t => String(t).replace(/^"|"$/g, '').replace(/"\s*"/g, ''))
    .filter(t => /^v=spf1(\s|$)/i.test(t));
  if (!spf.length) return 'missing';
  if (spf.length > 1) return 'multiple';
  if (/\+all\b/i.test(spf[0])) return 'open';
  if (/~all\b|\?all\b/i.test(spf[0])) return 'soft';
  return 'ok';
}

/** DMARC policy from _dmarc TXT: missing | none | quarantine | reject. */
export function dmarcPolicy(txt = []) {
  const rec = txt.map(t => String(t).replace(/"/g, '')).find(t => /^v=DMARC1/i.test(t));
  if (!rec) return 'missing';
  const p = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(rec)?.[1];
  return p ? p.toLowerCase() : 'none';
}

/**
 * Everything the DNS check stores, from raw answers:
 * { mx: [hosts], txt: [root TXT], dmarc: [_dmarc TXT], dkim: bool (M365 selector1/2 CNAME) }
 */
export function summariseDns(raw) {
  const mx = classifyMx(raw.mx);
  return {
    provider: mx.provider,
    filter: mx.filter,
    spf: spfStatus(raw.txt),
    dmarc: dmarcPolicy(raw.dmarc),
    dkim: !!raw.dkim
  };
}

/** Google PageSpeed Insights v5 response → the scores we use (0–100) and HTTPS. */
export function summarisePageSpeed(json) {
  const cats = json?.lighthouseResult?.categories || {};
  const score = k => (cats[k]?.score == null ? null : Math.round(cats[k].score * 100));
  const finalUrl = json?.lighthouseResult?.finalDisplayedUrl || json?.lighthouseResult?.finalUrl || json?.id || '';
  return {
    performance: score('performance'),
    seo: score('seo'),
    accessibility: score('accessibility'),
    bestPractices: score('best-practices'),
    https: /^https:/i.test(finalUrl),
    finalUrl
  };
}

/** Case-insensitive pattern from the catalogue; a bad pattern matches nothing rather than throwing. */
export function pattern(src) {
  if (!src) return null;
  try { return new RegExp(src, 'i'); } catch { return null; }
}

/** Timesheet entries in the window whose description matches the product's phrases. */
export function ticketHits(tickets = [], src, { now = new Date(), months = THRESHOLDS.ticketMonths } = {}) {
  const re = pattern(src);
  if (!re) return [];
  const since = new Date(now);
  since.setMonth(since.getMonth() - months);
  const sinceKey = since.toISOString().slice(0, 10);
  return tickets
    .filter(t => (t.date || '') >= sinceKey && re.test(t.text || ''))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/** VoIP Unlimited dealer services (client buys direct; Gecko earns commission). */
export const DEALER_VOICE = new Set(['voxone', 'voip_exchange', 'pstn', 'mobile']);
export const DEALER_LINES = new Set(['ethernet', 'leased_line', 'fttp', 'fttc', 'sogea']);
const SERVICE_LABEL = {
  voxone: 'VoxOne', voip_exchange: 'VoIP Exchange', ethernet: 'Ethernet', leased_line: 'leased line',
  fttp: 'FTTP', fttc: 'FTTC', sogea: 'SOGEA', pstn: 'PSTN line', mobile: 'mobile', unknown: 'services not yet recorded'
};
export const serviceLabel = s => SERVICE_LABEL[s] || s;
const CONTRACT_LABEL = { in_contract: 'in contract', out_of_contract: 'out of contract', expiring: 'expiring', unknown: 'contract unknown' };

/** Dealer rows that are out of contract, or end within `days`. */
export function renewalsDue(dealer = [], { now = new Date(), days = 90 } = {}) {
  const limit = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  return dealer.filter(d => d.contract === 'out_of_contract' || d.contract === 'expiring' ||
    (d.contract_end && d.contract_end <= limit));
}

function dealerLine(d) {
  const qty = d.quantity > 1 || d.service === 'voxone' || d.service === 'voip_exchange' ? `${d.quantity} × ` : '';
  const end = d.contract_end ? ` (ends ${fmtDate(d.contract_end)})` : '';
  return `${qty}${serviceLabel(d.service)}${d.extras ? ` ${d.extras}` : ''}: ${CONTRACT_LABEL[d.contract] || d.contract}${end}${d.notes ? `. ${d.notes}` : ''}`;
}

/** Does the client already have this product? → { has, via } */
export function holds(client, product) {
  const dealer = client.dealer || [];
  if (dealer.length && (product.key === 'voxone' || product.key === 'connectivity')) {
    const unknown = dealer.some(d => d.service === 'unknown');
    const want = product.key === 'voxone' ? DEALER_VOICE : DEALER_LINES;
    const row = dealer.find(d => want.has(d.service));
    if (row) return { has: true, via: `VoIP Unlimited dealer: ${serviceLabel(row.service)}` };
    if (unknown) return { has: true, via: 'VoIP Unlimited dealer customer (services not yet recorded)' };
  }
  const lines = client.services || [];
  const re = pattern(product.keywords);
  const line = re && lines.find(s => re.test(`${s.title || ''} ${s.notes || ''}`));
  if (line) return { has: true, via: `service line "${line.title}"` };
  switch (product.key) {
    case 'm365':      if (client.cspClient) return { has: true, via: 'TD SYNNEX licences' }; break;
    case 'exclaimer': if (client.exclaimer) return { has: true, via: 'Exclaimer invoice' }; break;
    case 'hosting':   if (client.hostedDomains?.length) return { has: true, via: `Clook: ${client.hostedDomains[0]}` }; break;
    case 'support':   if (client.ssa) return { has: true, via: 'SSA hours block' }; break;
    case 'email_security':
      if (client.dns?.filter) return { has: true, via: `${client.dns.filter} filtering (MX)` }; break;
  }
  if (product.key === 'support' && lines.some(s => s.category === 'retainer')) {
    return { has: true, via: 'retainer' };
  }
  return { has: false, via: '' };
}

const onM365 = c => !!(c.cspClient || c.dns?.provider === 'microsoft' || (c.dns?.provider === 'filtered'));
const fmtDate = d => {
  const [y, m, day] = String(d || '').split('-');
  return day ? `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1]} ${y}` : '';
};

/**
 * One product for one client: null when it is not a gap, otherwise
 * { product, reasons: [plain sentences], tickets: [hits], mrr, oneOff, strength }.
 * strength: 2 = rule + timesheets agree, 1 = one of them.
 */
export function evaluate(client, product, { status, now = new Date() } = {}) {
  if (!product.active) return null;
  if (status && status !== 'none') return null;   // has / not_interested / not_applicable
  const owned = holds(client, product);
  if (owned.has) return null;

  const reasons = [];
  const dns = client.dns, ps = client.pagespeed;
  let ruleHit = false;

  switch (product.rule) {
    case 'missing':
      ruleHit = true;
      reasons.push(`Not something they buy from us today.`);
      break;
    case 'missing_if_m365':
      if (onM365(client)) { ruleHit = true; reasons.push('They use Microsoft 365 and don’t have this from us.'); }
      break;
    case 'm365_elsewhere':
      if (dns?.provider === 'microsoft' && !client.cspClient) { ruleHit = true; reasons.push(`${client.emailDomain || 'Their domain'} runs on Microsoft 365, but the licences aren’t billed through us.`); }
      else if (dns?.provider === 'google') { ruleHit = true; reasons.push(`${client.emailDomain || 'Their domain'} uses Google Workspace.`); }
      break;
    case 'email_filter':
      if (onM365(client) && dns && !dns.filter) {
        ruleHit = true;
        reasons.push('Email arrives straight into Microsoft 365 with no filtering service in front.');
        if (dns.dmarc === 'missing' || dns.dmarc === 'none') reasons.push(`DMARC is ${dns.dmarc === 'missing' ? 'not set up' : 'set to “none” (monitor only)'}, so spoofed email isn’t blocked.`);
      }
      break;
    case 'dmarc':
      if (dns) {
        if (dns.spf === 'missing') reasons.push('No SPF record: nothing says which servers may send as this domain.');
        if (dns.spf === 'open') reasons.push('SPF ends in “+all”, which lets anyone send as this domain.');
        if (dns.spf === 'multiple') reasons.push('More than one SPF record, which makes SPF fail.');
        if (dns.dmarc === 'missing') reasons.push('No DMARC record.');
        if (dns.dmarc === 'none') reasons.push('DMARC is set to “none”, so spoofed email is reported but still delivered.');
        if (dns.provider === 'microsoft' && !dns.dkim) reasons.push('DKIM signing isn’t switched on for Microsoft 365.');
        ruleHit = reasons.length > 0;
      }
      break;
    case 'hosting':
      if (client.webDomain) { ruleHit = true; reasons.push(`${client.webDomain} isn’t hosted with us.`); }
      break;
    case 'seo':
      if (ps && !ps.error && ((ps.seo ?? 100) < THRESHOLDS.seoBelow || (ps.performance ?? 100) < THRESHOLDS.performanceBelow)) {
        ruleHit = true;
        reasons.push(`Google PageSpeed (mobile): SEO ${ps.seo ?? '—'}/100, performance ${ps.performance ?? '—'}/100, accessibility ${ps.accessibility ?? '—'}/100.`);
      }
      break;
    case 'website':
      if (ps && !ps.error && ((ps.performance ?? 100) < THRESHOLDS.performanceBelow || ps.https === false)) {
        ruleHit = true;
        if ((ps.performance ?? 100) < THRESHOLDS.performanceBelow) reasons.push(`The site scores ${ps.performance}/100 for speed on mobile (Google PageSpeed).`);
        if (ps.https === false) reasons.push('The site doesn’t load over HTTPS, so browsers mark it “Not secure”.');
      }
      break;
    case 'support':
      ruleHit = false;   // raised by timesheet volume only, below
      break;
    case 'devices':
      break;             // phase 2: needs Atera device data
    case 'voip_exchange': {
      const ve = (client.dealer || []).filter(d => d.service === 'voip_exchange');
      const seats = ve.reduce((t, d) => t + (Number(d.quantity) || 0), 0);
      if (seats) {
        ruleHit = true;
        for (const d of ve) reasons.push(dealerLine(d) + '.');
        reasons.push('VoIP Unlimited report that VoIP Exchange call recordings are not accessible from mid-August 2026 and the mobile app is unreliable; they recommend moving to VoxOne.');
        if (product.default_mrr != null) reasons.push(`${seats} seats × ${money(product.default_mrr)} commission = ${money(seats * Number(product.default_mrr))} a month.`);
      }
      break;
    }
    case 'dealer_renewal': {
      const due = renewalsDue(client.dealer, { now }).filter(d => d.service !== 'voip_exchange');   // VE has its own migration
      if (due.length) { ruleHit = true; for (const d of due) reasons.push(dealerLine(d) + '.'); }
      break;
    }
    case 'dealer_prospect':
      if (client.dealerOnly) {
        ruleHit = true;
        const what = [...new Set((client.dealer || []).map(d => serviceLabel(d.service)))].join(', ');
        reasons.push(`Buys ${what} from VoIP Unlimited through us, but isn’t a Gecko IT client yet.`);
      }
      break;
  }
  if (!client.dealerOnly && product.rule === 'dealer_prospect') return null;

  // What they keep calling us about.
  let tickets = ticketHits(client.tickets, product.ticket_keywords, { now });
  if (product.rule === 'support') {
    const hours = tickets.reduce((t, e) => t + (Number(e.hours) || 0), 0);
    if (hours >= THRESHOLDS.supportHours) {
      reasons.push(`${round1(hours)} hours of ad-hoc support in the last ${THRESHOLDS.ticketMonths} months, outside any hours block or retainer.`);
      ruleHit = true;
    }
    tickets = [];
  } else if (tickets.length >= THRESHOLDS.ticketHits) {
    const eg = tickets.slice(0, 2).map(t => `“${clip(t.text)}” (${fmtDate(t.date)})`).join('; ');
    reasons.push(`${tickets.length} timesheet entries in the last ${THRESHOLDS.ticketMonths} months relate to this, e.g. ${eg}.`);
  } else {
    tickets = [];
  }

  if (!ruleHit && !tickets.length) return null;
  // "Not something they buy" alone is weak; say so in strength, but keep it.
  const strength = (ruleHit && tickets.length) ? 2 : (product.rule === 'missing' && !tickets.length ? 0 : 1);
  const seats = product.rule === 'voip_exchange'
    ? (client.dealer || []).filter(d => d.service === 'voip_exchange').reduce((t, d) => t + (Number(d.quantity) || 0), 0) : 1;
  return {
    product,
    reasons,
    tickets,
    mrr: product.default_mrr == null ? null : Math.round(Number(product.default_mrr) * seats * 100) / 100,
    oneOff: product.default_one_off == null ? null : Number(product.default_one_off),
    strength
  };
}

/** Every gap for a client, strongest and most valuable first. */
export function clientGaps(client, products, statuses = {}, opts = {}) {
  return products
    .map(p => evaluate(client, p, { ...opts, status: statuses[p.key] }))
    .filter(Boolean)
    .sort((a, b) => b.strength - a.strength || (b.mrr || 0) - (a.mrr || 0) || (a.product.sort - b.product.sort));
}

/** Open products already in the pipeline for a client are not raised again. */
export function withoutOpen(gaps, opportunities, clientName) {
  const open = new Set(opportunities
    .filter(o => o.client_name === clientName && (o.status === 'idea' || o.status === 'proposed'))
    .map(o => o.product_key));
  return gaps.filter(g => !open.has(g.product.key));
}

/** Pipeline headline: open MRR, open one-off, won MRR this month and in total. */
export function pipelineTotals(opps, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const sum = (rows, k) => round2(rows.reduce((t, o) => t + (Number(o[k]) || 0), 0));
  const open = opps.filter(o => o.status === 'idea' || o.status === 'proposed');
  const won = opps.filter(o => o.status === 'won');
  const wonThisMonth = won.filter(o => String(o.closed_at || '').startsWith(month));
  return {
    openCount: open.length,
    openMrr: sum(open, 'mrr'),
    openOneOff: sum(open, 'one_off'),
    wonMrr: sum(won, 'mrr'),
    wonMrrThisMonth: sum(wonThisMonth, 'mrr'),
    wonCountThisMonth: wonThisMonth.length
  };
}

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => HTML_ESC[c]);

/**
 * The email for an opportunity: the product's template with this client's
 * details. Every value is HTML-escaped; paragraphs come from blank lines.
 * → { subject, html, text }
 */
export function fillTemplate(product, ctx) {
  const price = ctx.mrr ? `It would be £${Number(ctx.mrr).toFixed(2)} a month${ctx.oneOff ? ` plus £${Number(ctx.oneOff).toFixed(2)} to set up` : ''}.`
    : ctx.oneOff ? `It would be a one-off £${Number(ctx.oneOff).toFixed(2)}.` : '';
  const vars = {
    first_name: ctx.firstName || 'there',
    client: ctx.client || '',
    evidence: (ctx.evidence || []).join('\n'),
    product: product.name,
    price,
    sender: ctx.sender || ''
  };
  const fill = s => String(s || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
  const text = fill(product.email_body).replace(/\n{3,}/g, '\n\n').trim();
  const html = text.split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return { subject: fill(product.email_subject).trim() || product.name, html, text };
}

/** Domain from an email address, ignoring free mail providers. */
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|me|aol|btinternet|sky|virginmedia|talktalk|ntlworld|protonmail)\./i;
export function emailDomain(address) {
  const d = String(address || '').toLowerCase().trim().split('@')[1] || '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) || FREE_MAIL.test(d)) return '';
  return d;
}

function money(n) { return '£' + (Number(n) || 0).toFixed(2); }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function clip(s, n = 70) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
