/* Dates that come round (Philip, 19 Oct 2026: "yes build the dates next"): what falls due soon, raised early enough to act on and sell
   with: annual renewals in Xero, domains expiring, VoIP contracts ending, the PSTN switch-off, end of support for servers, Windows and
   Office. Each item feeds Do next (ranked) and the Monday brief (Coming up, by date). Pure: no window. Tests: tests/dates.mjs.
   Design: docs/superpowers/specs/2026-10-19-dates-come-round-design.md */

/** Openreach's PSTN and ISDN switch-off for the last lines (as the dealer list has it, 11 Oct 2026). */
export const PSTN_OFF = '2027-01-31';
/** How many days ahead each kind is raised. */
export const LEAD = { renewal: 60, domain: 60, contract: 90, support: 120, pstn: 180 };

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const whose = name => `${name}’${/s$/i.test(name) ? '' : 's'}`;   // "Daron Motors’", "Cowan Consultancy’s"
const daysUntil = (today, date) => Math.round((new Date(String(date).slice(0, 10) + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000);
export const longDay = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "Web Hosting - 1 year (freeston.co.uk)" → "Web Hosting"; a renewal line's name without the period and domain. */
const lineName = d => String(d || '').replace(/\s*[-–]\s*1 year.*$|\s*\(.*\)\s*$/i, '').replace(/\s+\b[a-z0-9.-]+\.(co\.uk|uk\.com|com|uk|net|org)\b.*$/i, '').trim() || 'Renewal';

/**
 * → [{ key, kind, date, days, group: 'protect'|'money', client, title, why, value, go }], soonest first. Every source optional.
 *   annual:   xero_repeating_invoices rows (period 11 or 12 months)    domains: domain_dates rows
 *   dealer:   voip_dealer_services rows                                upgrades: core/upgrades.js upgrades().clients
 */
export function comingUp({ annual = [], domains = [], dealer = [], upgrades = [], today }) {
  const out = [];
  const add = (lead, date, item) => {
    const days = daysUntil(today, date);
    if (days < 0 || days > lead) return;
    out.push({ value: null, ...item, date: String(date).slice(0, 10), days });
  };

  // Annual renewals: the invoice goes out by itself; the weeks before are the time to check they still need it and offer more.
  for (const r of annual.filter(x => x.status === 'AUTHORISED' && Number(x.period) >= 11 && x.next_date)) {
    const lines = r.line_items || [];
    const total = r2(lines.reduce((t, l) => t + Number(l.line_amount ?? l.LineAmount ?? 0), 0));
    const names = [...new Set(lines.map(l => lineName(l.description ?? l.Description)))];
    add(LEAD.renewal, r.next_date, { key: `renewal:${r.repeating_invoice_id || r.contact_name}:${r.next_date}`, kind: 'renewal', group: 'money', client: r.contact_name,
      title: `${names.join(' and ')} renews for ${r.contact_name}`, why: `The yearly invoice goes out ${longDay(r.next_date)}: a chance to check what they use and offer more.`,
      value: total ? { gbp: total, per: 'once' } : null, go: `client:advice:${r.contact_name}` });
  }

  // Domains: one Gecko bills for must be renewed at the registrar in time; one it doesn't is worth offering to look after.
  for (const d of domains.filter(x => x.expires_on)) {
    const soon = daysUntil(today, d.expires_on) <= 14;
    // Ours to renew: billed as a domain in Xero, or registered through Clook (Gecko's reseller account) for a client we invoice hosting to.
    const ours = d.billed || (/clook/i.test(d.registrar || '') && (d.sources || []).some(s => s === 'xero' || s === 'hosting'));
    add(LEAD.domain, d.expires_on, ours
      ? { key: `domain:${d.domain}`, kind: 'domain', group: 'protect', client: d.client_name, title: `Renew ${d.domain} for ${d.client_name || 'a client'}`,
          why: `Expires ${longDay(d.expires_on)}${d.registrar ? ` at ${d.registrar}` : ''}; we look after it. A lapsed domain stops their email and website.`, go: `client:contacts:${d.client_name}` }
      : { key: `domain:${d.domain}`, kind: 'domain', group: soon ? 'protect' : 'money', client: d.client_name, title: `${d.domain} expires ${longDay(d.expires_on)}`,
          why: `Not renewed through us${d.registrar ? ` (${d.registrar})` : ''}. Check it's in hand, and offer to look after it so it never lapses.`, go: `client:contacts:${d.client_name}` });
  }

  // VoIP Unlimited contracts ending: renew (or upgrade) through the dealer account.
  for (const s of dealer.filter(x => x.contract_end)) add(LEAD.contract, s.contract_end, { key: `contract:${s.id}`, kind: 'contract', group: 'money', client: s.client_name,
    title: `${whose(s.client_name)} ${String(s.service).toUpperCase() === 'VOXONE' ? 'VoxOne' : s.service} contract ends ${longDay(s.contract_end)}`,
    why: 'Renew through the dealer account before it ends, and look at what else they could move over.', go: 'opportunities:voip' });

  // The PSTN switch-off: lines still on PSTN need moving (SOGEA, FTTP or VoxOne through the dealer account).
  const pstn = new Map();
  for (const s of dealer.filter(x => x.service === 'pstn')) pstn.set(s.client_name, (pstn.get(s.client_name) || 0) + (Number(s.quantity) || 1));
  for (const [client, n] of pstn) add(LEAD.pstn, PSTN_OFF, { key: `pstn:${client}`, kind: 'pstn', group: 'money', client,
    title: `Move ${client} off ${plural(n, 'PSTN line')} before the switch-off`, why: `Openreach switches PSTN off on ${longDay(PSTN_OFF)}: the line stops working. Offer SOGEA, FTTP or VoxOne.`,
    go: 'opportunities:voip' });

  // End of support coming (servers, Windows versions, Office): plan it with the client before it passes.
  for (const c of upgrades.filter(x => !x.own)) {
    const by = new Map();
    for (const d of c.devices || []) for (const f of d.findings || []) if (f.level === 'soon' && f.ends) {
      const k = `${f.what}|${f.ends}|${f.text.split(':')[0]}`;
      by.set(k, { f, names: [...(by.get(k)?.names || []), d.name] });
    }
    for (const [k, { f, names }] of by) add(LEAD.support, f.ends, { key: `support:${c.name}:${k}`, kind: 'support', group: 'money', client: c.name,
      title: `${f.text.split(':')[0]} support ends ${longDay(f.ends)} at ${c.name}`,
      why: `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}: ${f.fix}.`, go: `client:advice:${c.name}` });
  }

  return out.sort((a, b) => a.days - b.days || a.client.localeCompare(b.client));
}
