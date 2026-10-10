/* Atera devices per client: pure logic (no window). Tested in tests/devices.mjs.
   Design: docs/superpowers/specs/2026-10-11-atera-devices-design.md

   Rows come from atera_agents (synced from Atera by the atera-sync Edge Function). Per Atera customer: devices,
   servers, workstations, machines still on Windows 10 (Microsoft ended support on 14 Oct 2025), machines Atera
   hasn't heard from in 30 days, and what the client was billed for Atera services in Xero that month. */

import { sameClient } from './client.js';

export const STALE_DAYS = 30;
/** Gecko's own machines in Atera: never billed to anyone, so never flagged for it. */
export const isInternal = name => /^gecko\b/i.test(String(name || '').trim());

/**
 * Atera customer names that don't match the Xero / Gecko HQ name by spelling (checked against the live data, 11 Oct 2026).
 * Add a line here when a client is wrongly shown as "No Atera billing" or its Devices tab is empty.
 */
export const ATERA_NAMES = {
  'P&M Packing': 'PM Packing',
  'CD Aluminium': 'CDA Ltd',
  'Cutler Solutions': 'Cutler Home Solutions'
};
const sameAs = (ateraName, other) => sameClient(ateraName, other) || (ATERA_NAMES[ateraName] ? sameClient(ATERA_NAMES[ateraName], other) : false);

const DAY = 86400000;
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

export const isServer = a => /server|domain controller/i.test(`${a.device_type || ''} ${a.os || ''}`);
export const isWin10 = a => /windows\s*10(?![.\d])/i.test(a.os || '') && !/server/i.test(a.os || '');
export const isWin11 = a => /windows\s*11\b/i.test(a.os || '');

/** Whole days since Atera last heard from the device; null when unknown. */
export function daysSince(iso, today) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((new Date(today + 'T23:59:59Z').getTime() - t) / DAY));
}

/** What a client was billed in Xero for Atera services in `month`, per contact (net). */
export function ateraBilling(invoices, month) {
  const out = new Map();
  for (const inv of invoices || []) {
    if (!String(inv.invoice_date || '').startsWith(month)) continue;
    if (!['AUTHORISED', 'PAID'].includes(String(inv.status || '').toUpperCase())) continue;
    for (const l of inv.line_items || []) {
      if (!/^atera\b/i.test(String(l.item_code || ''))) continue;
      const amount = l.line_amount != null ? Number(l.line_amount) : (Number(l.quantity) || 0) * (Number(l.unit_amount) || 0);
      const e = out.get(inv.contact_name) || { contact: inv.contact_name, billed: 0, lines: [] };
      e.billed = r2(e.billed + amount);
      e.lines.push(String(l.description || l.item_code));
      out.set(inv.contact_name, e);
    }
  }
  return out;
}

/**
 * Per Atera customer, worst first. agents: atera_agents rows. billing: ateraBilling(). today: YYYY-MM-DD.
 * → { clients: [{ name, devices, servers, workstations, win10, stale, offline, billed, billedTo, flags, agents }], totals }
 */
export function deviceSummary(agents, billing = new Map(), today) {
  const by = new Map();
  for (const a of agents || []) {
    const name = a.customer_name || 'No customer';
    const e = by.get(name) || { name, agents: [] };
    e.agents.push(a);
    by.set(name, e);
  }
  const bills = [...billing.values()];
  const clients = [...by.values()].map(e => {
    const list = e.agents.map(a => ({ ...a, server: isServer(a), win10: isWin10(a), days: daysSince(a.last_seen, today) }))
      .sort((x, y) => Number(y.server) - Number(x.server) || String(x.machine_name).localeCompare(String(y.machine_name)));
    const bill = bills.find(b => sameAs(e.name, b.contact));
    const win10 = list.filter(a => a.win10).length;
    const stale = list.filter(a => a.days != null && a.days >= STALE_DAYS).length;
    const flags = [];
    const internal = isInternal(e.name);
    if (!bill && list.length && !internal) flags.push('not_billed');
    if (win10) flags.push('win10');
    if (stale) flags.push('stale');
    return {
      name: e.name, devices: list.length, servers: list.filter(a => a.server).length, workstations: list.filter(a => !a.server).length,
      win10, stale, offline: list.filter(a => a.online === false).length,
      billed: bill ? bill.billed : 0, billedTo: bill ? bill.contact : '', billedLines: bill ? bill.lines : [],
      internal, flags, agents: list
    };
  }).sort((a, b) => b.flags.length - a.flags.length || b.devices - a.devices || a.name.localeCompare(b.name));
  const sum = k => clients.reduce((t, c) => t + c[k], 0);
  return {
    clients,
    totals: {
      devices: sum('devices'), servers: sum('servers'), workstations: sum('workstations'), win10: sum('win10'), stale: sum('stale'),
      clients: clients.length, notBilled: clients.filter(c => c.flags.includes('not_billed')).length,
      billed: r2(sum('billed'))
    }
  };
}

/** This client's devices (any spelling of the name) from deviceSummary's clients. */
export function devicesFor(summary, clientName) {
  return (summary?.clients || []).find(c => sameAs(c.name, clientName)) || null;
}
