/* Prospects (new business): pure logic (no window). Tested in tests/prospects.mjs.
   Design: docs/superpowers/specs/2026-10-09-prospects-design.md */

import { sameClient } from './client.js';
import { cleanContact } from './contacts.js';

export const STAGES = [['new', 'New'], ['contacted', 'Contacted'], ['meeting', 'Meeting'], ['proposal', 'Proposal'], ['won', 'Won'], ['lost', 'Lost']];
export const SOURCES = [['referral', 'Referral'], ['website', 'Website'], ['voip_dealer', 'VoIP Unlimited customer'], ['networking', 'Networking'],
  ['existing_contact', 'Someone we know'], ['cold', 'Cold approach'], ['other', 'Other']];
export const OPEN_STAGES = ['new', 'contacted', 'meeting', 'proposal'];
const day = d => String(d || '').slice(0, 10);

/** Tidy and check a prospect. Returns { row } or { error }. */
export function cleanProspect(input) {
  const company = String(input.company || '').replace(/\s+/g, ' ').trim();
  if (!company) return { error: 'Add the company name.' };
  const contact = cleanContact({ name: input.contact_name, email: input.email, phone: input.phone }, company);
  if (contact.error && (input.contact_name || input.email || input.phone)) return { error: contact.error };
  const c = contact.row || { name: '', email: '', phone: '' };
  const mrr = Number(input.est_mrr);
  return {
    row: {
      company, contact_name: c.name, email: c.email, phone: c.phone,
      source: SOURCES.some(([k]) => k === input.source) ? input.source : 'other',
      interest: String(input.interest || '').trim().slice(0, 200),
      stage: STAGES.some(([k]) => k === input.stage) ? input.stage : 'new',
      est_mrr: Number.isFinite(mrr) && mrr > 0 ? Math.round(mrr * 100) / 100 : 0,
      next_step: String(input.next_step || '').trim().slice(0, 200),
      follow_up_on: day(input.follow_up_on) || null,
      notes: String(input.notes || '').trim().slice(0, 2000)
    }
  };
}

/** Counts and £/month per stage, and how many follow-ups are due. */
export function prospectSummary(prospects, today) {
  const by = Object.fromEntries(STAGES.map(([k]) => [k, { count: 0, mrr: 0 }]));
  for (const p of prospects || []) {
    const s = by[p.stage] || by.new;
    s.count++; s.mrr = Math.round((s.mrr + (Number(p.est_mrr) || 0)) * 100) / 100;
  }
  const open = (prospects || []).filter(p => OPEN_STAGES.includes(p.stage));
  return {
    by, openCount: open.length,
    openMrr: Math.round(open.reduce((t, p) => t + (Number(p.est_mrr) || 0), 0) * 100) / 100,
    due: open.filter(p => p.follow_up_on && day(p.follow_up_on) <= today).length
  };
}

/** Open first (furthest stage, then follow-up soonest), then won/lost newest first. */
export function sortProspects(prospects) {
  const order = s => { const i = OPEN_STAGES.indexOf(s); return i < 0 ? 10 : 3 - i; };
  return (prospects || []).slice().sort((a, b) => order(a.stage) - order(b.stage)
    || String(a.follow_up_on || '9999').localeCompare(String(b.follow_up_on || '9999'))
    || String(b.modified_at || '').localeCompare(String(a.modified_at || '')));
}

/**
 * What "Make client" writes: the client (status New, starting today), its main contact (when there is a name or
 * email) and a first activity line. Refuses when a client of that name already exists (any spelling).
 */
export function conversion(p, existingClientNames, today, by = '') {
  const name = String(p.company || '').trim();
  const clash = (existingClientNames || []).find(n => sameClient(n, name));
  if (clash) return { error: `${clash} is already a client. Open their page instead, or rename the prospect.` };
  const source = (SOURCES.find(([k]) => k === p.source) || [, 'Other'])[1];
  return {
    client: { title: name, status: 'New', contract_start: today, notes: [p.interest && `Interested in: ${p.interest}`, p.notes].filter(Boolean).join('\n') },
    contact: p.contact_name || p.email
      ? { client_name: name, name: p.contact_name || '', email: p.email || '', phone: p.phone || '', role: '', notes: '', is_main: true, created_by: by }
      : null,
    activity: { client_name: name, kind: 'note', body: `Became a client (prospect from ${source.toLowerCase()}${p.interest ? `; interested in ${p.interest}` : ''}${Number(p.est_mrr) ? `; estimated £${Number(p.est_mrr).toFixed(2)}/month` : ''}).`, created_by: by },
    prospect: { stage: 'won', converted_client: name, converted_at: new Date(today + 'T12:00:00Z').toISOString() }
  };
}
