/* Client details: pure logic (no window). Tested in tests/profile.mjs.
   Design: docs/superpowers/specs/2026-10-10-client-details-design.md

   Address (UK postcode checked and tidied), office number as a tel: link VoxOne can dial, website, a map from the
   postcode's coordinates, and which mail belongs to a client (their domains and contacts' addresses). */

import { sameClient } from './client.js';

const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

/** "sw1a1aa" → "SW1A 1AA"; '' when it isn't a UK postcode. */
export function tidyPostcode(pc) {
  const m = String(pc || '').toUpperCase().replace(/\s+/g, '').match(UK_POSTCODE);
  return m ? `${m[1]} ${m[2]}` : '';
}

/**
 * A UK number as E.164 for tel: links ("01234 567890" → "+441234567890"), so a click dials the same way from
 * VoxOne, a mobile or Teams. Anything already international is kept; '' when there aren't enough digits.
 */
export function telHref(phone) {
  let s = String(phone || '').trim();
  if (!s) return '';
  s = s.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return s.replace(/\D/g, '').length >= 8 ? s : '';
  if (s.startsWith('0') && s.length >= 10) return '+44' + s.slice(1);
  return s.length >= 6 ? s : '';
}

/** "www.acme.co.uk/" → "https://www.acme.co.uk". */
export function tidyWebsite(w) {
  const s = String(w || '').trim();
  if (!s) return '';
  const url = /^https?:\/\//i.test(s) ? s : 'https://' + s;
  try { const u = new URL(url); return u.hostname.includes('.') ? (u.origin + (u.pathname === '/' ? '' : u.pathname)) : ''; } catch { return ''; }
}

/** Check and tidy what was typed. Returns { row } or { error }. */
export function cleanProfile(input, clientName) {
  const client = String(clientName || '').trim();
  if (!client) return { error: 'No client chosen.' };
  const pcIn = String(input.postcode || '').trim();
  const postcode = tidyPostcode(pcIn);
  if (pcIn && !postcode) return { error: `“${pcIn}” isn’t a UK postcode.` };
  const phoneIn = String(input.office_phone || '').trim();
  if (phoneIn && !telHref(phoneIn)) return { error: 'The office number looks too short.' };
  const webIn = String(input.website || '').trim();
  const website = tidyWebsite(webIn);
  if (webIn && !website) return { error: `“${webIn}” isn’t a web address.` };
  const visit = String(input.visit_notes || '').trim();
  if (/\b(password|passcode|pin|alarm code|door code)\b\s*[:=]?\s*\S+/i.test(visit)) {
    return { error: 'Visit notes must not hold passwords or codes. Keep those in the password manager.' };
  }
  const t = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return {
    row: {
      client_name: client, address_line1: t(input.address_line1), address_line2: t(input.address_line2),
      town: t(input.town), county: t(input.county), postcode,
      office_phone: phoneIn.replace(/\s+/g, ' '), website, visit_notes: visit.slice(0, 1000)
    }
  };
}

/** One line for the header: "12 High Street, Bedford MK40 1AA". */
export function addressLine(p) {
  if (!p) return '';
  return [p.address_line1, p.address_line2, [p.town, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

/** Google Maps search / directions and an OpenStreetMap embed (needs lat/lon). */
export function mapLinks(p) {
  const q = [p?.address_line1, p?.address_line2, p?.town, p?.postcode].filter(Boolean).join(', ');
  if (!q) return null;
  const enc = encodeURIComponent(q);
  const out = {
    search: `https://www.google.com/maps/search/?api=1&query=${enc}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${enc}`
  };
  const lat = Number(p.lat), lon = Number(p.lon);
  if (p.lat != null && p.lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    const d = 0.006;
    out.embed = `https://www.openstreetmap.org/export/embed.html?bbox=${(lon - d * 1.6).toFixed(5)}%2C${(lat - d).toFixed(5)}%2C${(lon + d * 1.6).toFixed(5)}%2C${(lat + d).toFixed(5)}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lon.toFixed(5)}`;
  }
  return out;
}

const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|me|aol|btinternet|sky|virginmedia|talktalk|ntlworld|protonmail)\./i;
const domainOf = e => String(e || '').toLowerCase().split('@')[1] || '';

/** Who counts as "this client" in a mailbox: their own domains (not free mail) and their contacts' addresses. */
export function mailIdentity({ contacts = [], domains = [], website = '', ssaEmail = '' }) {
  const addresses = new Set([...contacts.map(c => c.email), ssaEmail].map(e => String(e || '').toLowerCase().trim()).filter(e => e.includes('@')));
  const ds = new Set(domains.map(d => String(d || '').toLowerCase().trim()).filter(Boolean));
  for (const a of addresses) { const d = domainOf(a); if (d && !FREE_MAIL.test(d)) ds.add(d); }
  if (website) { try { ds.add(new URL(website).hostname.replace(/^www\./, '').toLowerCase()); } catch { /* ignore */ } }
  return { addresses: [...addresses], domains: [...ds] };
}

/** Graph $search terms: one per domain and per free-mail address (searched separately, merged). */
export function mailSearches(id) {
  const freeAddrs = id.addresses.filter(a => !id.domains.includes(domainOf(a)));
  return [...id.domains, ...freeAddrs].slice(0, 6);
}

/**
 * Keep only messages that really involve the client (from or to one of their domains/addresses), newest first,
 * no duplicates across mailboxes (same internetMessageId or same subject + minute).
 * messages: [{ id, mailbox, subject, from, to: [], received, preview, webLink, internetMessageId }]
 */
export function clientMail(messages, id, { limit = 25 } = {}) {
  const mine = a => { const e = String(a || '').toLowerCase(); return id.addresses.includes(e) || id.domains.includes(domainOf(e)); };
  const seen = new Set(), out = [];
  for (const m of (messages || []).slice().sort((a, b) => String(b.received).localeCompare(String(a.received)))) {
    if (!mine(m.from) && !(m.to || []).some(mine)) continue;
    const key = m.internetMessageId || `${m.subject}|${String(m.received).slice(0, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...m, direction: mine(m.from) ? 'in' : 'out' });
    if (out.length >= limit) break;
  }
  return out;
}

/** This client's details row (any spelling of the name). */
export function profileFor(all, clientName) {
  return (all || []).find(p => sameClient(p.client_name, clientName)) || null;
}

/** "Tue 8 Oct, 10:32" in UK time. */
export function stamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Which mailboxes the Emails tab searches (Philip, 10 Oct: "pick up Jack's emails as well, not just mine"): the
 * signed-in person's own (/me), the rest of the team's, and the shared ones. Reading a colleague's mailbox needs
 * Read and manage (Full Access) on it in Microsoft 365, like support@ for Backups/Alerts.
 * → [{ key, path, label }]
 */
export function mailboxesFor(me, team = [], shared = []) {
  const self = String(me || '').trim().toLowerCase();
  const first = a => { const n = a.split('@')[0]; return n.charAt(0).toUpperCase() + n.slice(1); };
  const others = [...new Set([...team, ...shared].map(a => String(a).trim().toLowerCase()))].filter(a => a && a !== self);
  return [
    { key: 'me', path: '/me/messages', label: 'your mailbox' },
    ...others.map(a => ({ key: a, path: `/users/${encodeURIComponent(a)}/messages`, label: team.map(t => t.toLowerCase()).includes(a) ? `${first(a)}’s mailbox` : a.split('@')[0] + '@' }))
  ];
}
