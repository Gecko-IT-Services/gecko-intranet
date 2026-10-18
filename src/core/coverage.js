/* Backup coverage per client: pure logic (no window). Tested in tests/coverage.mjs.
   Design: docs/superpowers/specs/2026-10-18-backup-coverage-design.md

   Rows come from the acronis-sync Edge Function (acronis_tenants, acronis_items: Acronis's own records in `raw`) and
   atera-sync (atera_agents). Answers "is everything that should be backed up, backed up?", which the job emails on the
   Backups tab can't: a machine that stops sends nothing, and one never protected never did. */

import { sameAteraClient, isServer, isInternal } from './devices.js';

/** Working hours (Mon–Fri) without a good backup before it's red: most plans run weekday nights only. */
export const STALE_WORKING_HOURS = 48;
const HOUR = 3600000;
/** Every client has a few MB of SharePoint Acronis doesn't back up (system and app sites, Oct 2026: 21–37 MB). Above this, look. */
export const UNPROTECTED_SHAREPOINT_BYTES = 500e6;

/**
 * The same machine seen twice in Acronis: once by its own agent, once as a VM through the ESXi host (Acronis keeps the
 * host's name for it). Key: client name + the VM's name, both lower case → the agent's machine name. Add a line when a VM
 * shows "Not backed up" but its machine is backed up by its own agent.
 */
export const SAME_MACHINE = {
  'west country fires|file server': 'fpserver'
};

/** "FPServer.wcf.local", "FPSERVER", "FP Server" → "fpserver": how two systems' names for one machine are compared. */
export const machineKey = name => String(name || '').trim().split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

/** Weekday hours between `fromIso` and `now` (UTC days; close enough for a 48-hour line). Never → Infinity. */
export function workingHoursSince(fromIso, now) {
  const from = fromIso ? new Date(fromIso).getTime() : NaN;
  if (Number.isNaN(from)) return Infinity;
  const end = new Date(now).getTime();
  let t = from, n = 0;
  for (let i = 0; t < end && i < 24 * 400; i++) {           // capped at ~400 days: past that it's "never" in practice
    const step = Math.min(HOUR, end - t);
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n += step / HOUR;
    t += step;
  }
  return t < end ? Infinity : n;
}

const latest = list => list.filter(Boolean).sort().pop() || null;
const usageOf = (usage, name) => usage.filter(u => u.name === name).reduce((t, u) => t + (Number(u.value) || 0), 0);

/** Acronis's records for one machine (resource_status raw) → what the page needs. */
export function machineFrom(status, agentsById) {
  const ctx = status.context || {};
  const policies = Array.isArray(status.policies) ? status.policies : [];
  const agent = agentsById.get(ctx.agent_id) || null;
  return {
    name: ctx.name || ctx.user_defined_name || '—',
    key: machineKey(ctx.name),
    vm: /virtual_machine/.test(ctx.type || ''),
    plans: String(status.aggregate?.names || '').split(';').map(s => s.trim()).filter(Boolean),
    state: status.aggregate?.status || '',
    progress: status.aggregate?.progress ?? null,
    protected: policies.length > 0,
    lastSuccess: latest(policies.map(p => p.last_success_run)),
    lastRun: latest(policies.map(p => p.last_run)),
    nextRun: policies.map(p => p.next_run).filter(Boolean).sort()[0] || null,
    agentOnline: agent ? agent.online === true : null,
    agentVersion: agent?.core_version?.current?.release_id || ''
  };
}

const MACHINE_TYPES = /^resource\.(machine|virtual_machine\.)/;
const major = v => Number(String(v || '').split('.')[0]) || 0;

/**
 * Per client, worst first.
 * tenants: acronis_tenants rows ({ tenant_id, name, kind }); items: acronis_items rows ({ kind, tenant_id, raw });
 * ateraAgents: atera_agents rows; now: Date or ISO.
 * → { clients: [{ name, level, issues, machines, m365, alerts }], totals }
 * An issue: { level: 'red' | 'amber' | 'info', what, text }.
 */
export function coverage(tenants, items, ateraAgents = [], now = new Date()) {
  const customers = (tenants || []).filter(t => t.kind === 'customer');
  const byTenant = new Map(customers.map(t => [t.tenant_id, { statuses: [], agents: [], usage: [], alerts: [] }]));
  for (const i of items || []) {
    const e = byTenant.get(i.tenant_id);
    if (!e) continue;
    if (i.kind === 'resource_status' && MACHINE_TYPES.test(i.raw?.context?.type || '')) e.statuses.push(i.raw);
    else if (i.kind === 'agent') e.agents.push(i.raw);
    else if (i.kind === 'usage') e.usage.push(i.raw);
    else if (i.kind === 'alert') e.alerts.push(i.raw);
  }
  const newest = Math.max(0, ...[...byTenant.values()].flatMap(e => e.agents.map(a => major(a.core_version?.current?.release_id))));
  const usedAtera = new Set();

  const clients = customers.map(t => {
    const e = byTenant.get(t.tenant_id);
    const agentsById = new Map(e.agents.map(a => [a.id, a]));
    const atera = (ateraAgents || []).filter(a => sameAteraClient(t.name, a.customer_name));
    atera.forEach(a => usedAtera.add(a));
    const ateraByKey = new Map(atera.map(a => [machineKey(a.machine_name), a]));
    const all = e.statuses.map(s => machineFrom(s, agentsById));
    const agentKeys = new Set(all.filter(m => !m.vm).map(m => m.key));
    // A VM seen through the host that is the same machine as one with its own agent is shown once, as that machine.
    const machines = all.filter(m => !(m.vm && (agentKeys.has(m.key) || agentKeys.has(SAME_MACHINE[`${t.name.toLowerCase()}|${m.name.toLowerCase()}`]))));
    const issues = [];
    for (const m of machines) {
      const hours = workingHoursSince(m.lastSuccess, now);
      const onAtera = ateraByKey.get(m.key) || null;
      m.ateraOnline = onAtera ? onAtera.online : null;
      m.stale = m.protected && hours > STALE_WORKING_HOURS;
      if (!m.protected) issues.push({ level: m.vm ? 'amber' : 'red', what: m.name, text: m.vm ? 'Virtual machine on the host is not backed up' : 'Not backed up: no plan applied' });
      else if (m.stale) issues.push({ level: 'red', what: m.name, text: m.lastSuccess ? `No good backup since ${String(m.lastSuccess).slice(0, 10)}${m.state === 'running' ? ' (backing up now)' : ''}` : 'Never backed up successfully' });
      else if (m.state === 'critical') issues.push({ level: 'red', what: m.name, text: 'Last backup failed' });
      else if (m.state === 'warning') issues.push({ level: 'amber', what: m.name, text: 'Last backup had warnings' });
      if (m.agentOnline === false) {
        issues.push(m.ateraOnline === true
          ? { level: 'red', what: m.name, text: 'Acronis agent offline while the machine is on (restart “Acronis Managed Machine Service”)' }
          : { level: 'amber', what: m.name, text: 'Machine offline in Acronis and Atera' });
      }
      if (m.agentVersion && newest && major(m.agentVersion) < newest) issues.push({ level: 'amber', what: m.name, text: `Acronis agent out of date (${m.agentVersion})` });
    }
    const protectedKeys = new Set(machines.filter(m => m.protected).map(m => m.key));
    for (const a of isInternal(t.name) ? [] : atera.filter(isServer)) {
      if (!protectedKeys.has(machineKey(a.machine_name))) issues.push({ level: 'red', what: a.machine_name, text: `${a.device_type || 'Server'} in Atera with no Acronis backup` });
    }
    const m365 = {
      seats: usageOf(e.usage, 'pw_base_m365_seats'),
      sites: usageOf(e.usage, 'pw_base_m365_sharepoint_sites'),
      teams: usageOf(e.usage, 'pw_base_m365_teams'),
      unprotectedBytes: usageOf(e.usage, 'unprotected_site_collection_storage') + usageOf(e.usage, 'unprotected_group_site_storage')
    };
    m365.any = m365.seats + m365.sites + m365.teams > 0;
    // Philip, 18 Oct 2026: every client keeps its documents in SharePoint, and SharePoint must always be backed up.
    if (m365.any && !m365.sites) issues.push({ level: 'red', what: 'SharePoint', text: 'Microsoft 365 is in Acronis but no SharePoint sites are backed up' });
    else if (m365.unprotectedBytes >= UNPROTECTED_SHAREPOINT_BYTES) issues.push({ level: 'amber', what: 'SharePoint', text: `${gb(m365.unprotectedBytes)} of SharePoint isn’t backed up: check Site collections in Acronis` });
    else if (m365.unprotectedBytes > 0) issues.push({ level: 'info', what: 'SharePoint', text: `${gb(m365.unprotectedBytes)} not backed up (usually system sites)` });
    else if (!m365.any && !isInternal(t.name)) issues.push({ level: 'info', what: 'Microsoft 365', text: 'No Microsoft 365 backup in Acronis' });
    return finish({ name: t.name, issues, machines, m365, alerts: e.alerts.length });
  });

  // Servers Atera knows about at a client with no Acronis customer at all.
  const orphan = new Map();
  for (const a of (ateraAgents || []).filter(a => isServer(a) && !usedAtera.has(a) && !isInternal(a.customer_name))) {
    const c = orphan.get(a.customer_name) || { name: a.customer_name, issues: [], machines: [], m365: null, alerts: 0 };
    c.issues.push({ level: 'red', what: a.machine_name, text: `${a.device_type || 'Server'} in Atera; this client has no Acronis backup at all` });
    orphan.set(a.customer_name, c);
  }
  const list = [...clients, ...[...orphan.values()].map(finish)]
    .sort((a, b) => RANK[a.level] - RANK[b.level] || b.issues.length - a.issues.length || a.name.localeCompare(b.name));
  const count = lvl => list.reduce((n, c) => n + c.issues.filter(i => i.level === lvl).length, 0);
  return {
    clients: list,
    totals: {
      clients: list.length,
      machines: clients.reduce((n, c) => n + c.machines.length, 0),
      protected: clients.reduce((n, c) => n + c.machines.filter(m => m.protected && !m.stale).length, 0),
      red: count('red'), amber: count('amber'),
      sharepoint: clients.filter(c => c.m365?.sites > 0).length
    }
  };
}

const RANK = { red: 0, amber: 1, info: 2, ok: 3 };
function finish(c) {
  c.issues.sort((a, b) => RANK[a.level] - RANK[b.level]);
  c.level = c.issues.find(i => i.level === 'red') ? 'red' : c.issues.find(i => i.level === 'amber') ? 'amber' : 'ok';
  return c;
}

export const gb = bytes => {
  const g = (Number(bytes) || 0) / 1e9;
  return g >= 10 ? `${Math.round(g)} GB` : g >= 1 ? `${g.toFixed(1)} GB` : `${Math.max(1, Math.round(g * 1000))} MB`;
};

/** This client's coverage (any spelling of the name) from coverage()'s clients. */
export function coverageFor(result, clientName) {
  return (result?.clients || []).find(c => sameAteraClient(c.name, clientName) || sameAteraClient(clientName, c.name)) || null;
}
