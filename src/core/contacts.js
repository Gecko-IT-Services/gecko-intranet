/* Contacts per client: pure logic (no window). Tested in tests/contacts.mjs.
   Design: docs/superpowers/specs/2026-10-09-client-contacts-design.md

   Several people per client (role, email, phone, one main contact) in public.client_contacts,
   linked by client name like the rest of the client data. */

import { sameClient } from './client.js';

export const ROLES = ['Owner / director', 'Accounts', 'Office manager', 'IT contact', 'Staff'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Tidy and check what was typed. Returns { row } ready to save, or { error }. */
export function cleanContact(input, clientName) {
  const client = String(clientName || '').trim();
  const name = String(input.name || '').replace(/\s+/g, ' ').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const phone = String(input.phone || '').replace(/[^\d+()\s-]/g, '').replace(/\s+/g, ' ').trim();
  if (!client) return { error: 'No client chosen.' };
  if (!name && !email) return { error: 'Add a name or an email address.' };
  if (email && !EMAIL.test(email)) return { error: `“${email}” doesn’t look like an email address.` };
  if (phone && phone.replace(/\D/g, '').length < 6) return { error: 'That phone number looks too short.' };
  return {
    row: {
      client_name: client, name, email, phone,
      role: String(input.role || '').trim().slice(0, 60),
      notes: String(input.notes || '').trim().slice(0, 500),
      is_main: !!input.is_main
    }
  };
}

/** This client's contacts (any spelling of the name), main first, then by name. */
export function contactsFor(all, clientName) {
  return (all || []).filter(c => sameClient(c.client_name, clientName))
    .sort((a, b) => Number(!!b.is_main) - Number(!!a.is_main) || String(a.name || a.email).localeCompare(String(b.name || b.email)));
}

/** Who to show at the top of the client page: the main contact, else the first, else the SSA list's. */
export function mainContact(contacts, fallback = null) {
  const c = (contacts || []).find(x => x.is_main) || (contacts || [])[0];
  if (c) return { name: c.name || '', email: c.email || '', phone: c.phone || '', role: c.role || '' };
  if (fallback && (fallback.name || fallback.email)) return { name: fallback.name || '', email: fallback.email || '', phone: '', role: '' };
  return null;
}

/** Another contact already has this email for this client (case-insensitive), ignoring the one being edited. */
export function duplicateEmail(contacts, email, exceptId = null) {
  const e = String(email || '').trim().toLowerCase();
  return !!e && (contacts || []).some(c => String(c.id) !== String(exceptId) && String(c.email || '').toLowerCase() === e);
}

/** "Chris Wyeth <chris@…>" for an email To line; the bare address when there is no name. */
export function mailbox(c) {
  if (!c?.email) return '';
  return c.name ? `${c.name} <${c.email}>` : c.email;
}
