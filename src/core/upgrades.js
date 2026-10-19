/* Upgrades: what in each client's estate needs upgrading, and how soon. Pure logic (no window); tests/upgrades.mjs.
   Design: docs/superpowers/specs/2026-10-18-upgrades-design.md

   From Atera's device records (atera_agents.raw): Windows version and build, Office, processor, memory, disks, BIOS date.
   Only devices Atera has seen in the last 30 days count; older ones are listed apart as probably gone.
   Support dates are Microsoft's published end-of-support dates (Home/Pro editions), checked 18 Oct 2026. */

import { isInternal } from './devices.js';

export const SEEN_DAYS = 30;
const DAY = 86400000;

/** Windows and Office versions, newest rule first. `ends`: end of support (YYYY-MM-DD). */
export const SUPPORT = {
  windows: [
    [/windows\s*(xp|vista)\b/i, 'Windows XP/Vista', '2014-04-08'],
    [/windows\s*7\b/i, 'Windows 7', '2020-01-14'],
    [/windows\s*8(\.1)?\b/i, 'Windows 8.1', '2023-01-10'],
    [/server\s*20(08|03)/i, 'Windows Server 2008', '2020-01-14'],
    [/server\s*2012/i, 'Windows Server 2012', '2023-10-10'],
    [/server\s*2016/i, 'Windows Server 2016', '2027-01-12'],
    [/server\s*2019/i, 'Windows Server 2019', '2029-01-09'],
    [/windows\s*10\b.*ltsc|ltsc.*windows\s*10\b/i, 'Windows 10 LTSC', '2032-01-13'],
    [/windows\s*10(?![.\d])/i, 'Windows 10', '2025-10-14']
  ],
  // Windows 11 Home/Pro by build: each yearly version gets 24 months of updates.
  win11: [[22000, '21H2', '2023-10-10'], [22621, '22H2', '2024-10-08'], [22631, '23H2', '2025-11-11'], [26100, '24H2', '2026-10-13'], [26200, '25H2', '2027-10-12']],
  office: [
    [/\b(2003|2007)\b/, 'Office 2003/2007', '2017-10-10'],
    [/\b2010\b/, 'Office 2010', '2020-10-13'],
    [/\b2013\b/, 'Office 2013', '2023-04-11'],
    [/\b2016\b/, 'Office 2016', '2025-10-14'],
    [/\b2019\b/, 'Office 2019', '2025-10-14'],
    [/\b2021\b/, 'Office 2021', '2026-10-13'],
    [/\b2024\b/, 'Office 2024', '2029-10-09']
  ]
};

const days = (from, to) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY);
const longDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Can this processor run Windows 11? true / false / null (can't tell from the name).
 * Intel Core 8th generation and later (and Core Ultra); AMD Ryzen 2000 and later. Older ones need a new PC.
 */
export function win11Cpu(cpu) {
  const s = String(cpu || '');
  if (/core\(tm\)\s*ultra|core ultra/i.test(s)) return true;
  const intel = s.match(/\bi[3579]-(\d{4,5})/i);
  // i5-8500 → 8th gen; i7-14700T → 14th; laptop chips i7-1065G7 / i5-1135G7 / i7-1255U are 10th, 11th, 12th (four digits starting "1").
  if (intel) { const n = intel[1]; const gen = n.length === 5 || n[0] === '1' ? Number(n.slice(0, 2)) : Number(n[0]); return gen >= 8; }
  if (/\bcore\(tm\)\s*[3579]\s+\d{3}/i.test(s)) return true;           // Core 5 120U and the like (2023+)
  const ryzen = s.match(/ryzen\s*(?:\d|threadripper)\s*(?:pro\s*)?(\d)\d{2,3}/i);
  if (ryzen) return Number(ryzen[1]) >= 2;
  if (/\b(celeron|pentium|atom|core\(tm\)2|amd a\d|athlon|phenom|fx-)/i.test(s) && !/\b(n100|n200|n97|n95|silver n[56]\d{3}|gold 7\d{3})\b/i.test(s)) return false;
  return null;
}

/** One device's findings: [{ level: 'asap' | 'soon', what, text, fix }], from Atera's raw record. */
export function deviceFindings(a, today) {
  const raw = a.raw || {};
  const os = String(a.os || raw.OS || '');
  const out = [];
  const add = (level, what, text, fix) => out.push({ level, what, text, fix });
  const due = (ends, label) => {
    const left = days(today, ends);
    return left < 0 ? ['asap', `${label}: no security updates since ${longDate(ends)}`] : left <= 183 ? ['soon', `${label}: support ends ${longDate(ends)}`] : null;
  };
  // Windows
  const win = SUPPORT.windows.find(([re]) => re.test(os));
  const cpuOk = win11Cpu(raw.Processor);
  if (win) {
    const d = due(win[2], win[1]);
    if (d) {
      const server = /server/i.test(`${os} ${a.device_type || ''} ${a.machine_name || ''}`);
      const fix = server ? 'Plan a new server or a supported Windows Server'
        : cpuOk === true ? 'Upgrade to Windows 11 (free on this PC)'
        : cpuOk === false ? 'Replace: the processor can’t run Windows 11' : 'Check the processor, then upgrade or replace';
      add(d[0], 'Windows', d[1], fix);
    }
  } else if (/windows\s*11/i.test(os)) {
    const build = Number(String(raw.OSBuild || '').split('.')[0]) || 0;
    const enterprise = /enterprise|education/i.test(os);
    const v = [...SUPPORT.win11].reverse().find(([b]) => build >= b);
    if (v && !enterprise) {
      const d = due(v[2], `Windows 11 ${v[1]}`);
      // Windows 11 put on a processor Microsoft doesn't support can't be moved to the current version: replace it (Cowans' Sage PC, 18 Oct).
      if (d) add(d[0], 'Windows', d[1], cpuOk === false ? 'Replace: Windows 11 on a processor it doesn’t support can’t take the current version'
        : 'Install the latest Windows 11 update (free, through Windows Update or Atera)');
    }
  } else if (/macos\s*(?:\d+\s*)?(catalina|big sur|monterey|mojave|high sierra)/i.test(os)) {
    add('asap', 'macOS', `${os.replace(/\s*x64$/, '')}: Apple no longer sends security updates`, 'Update macOS, or replace the Mac if it can’t');
  }
  // Office (by name; the version number says 2013 and older for certain: 15.x and below)
  const office = String(raw.Office || '');
  const major = Number(String(raw.OfficeFullVersion || '').split('.')[0]) || 0;
  if (office && !/365|onenote|one note/i.test(office)) {
    const o = SUPPORT.office.find(([re]) => re.test(office));
    // Atera's name can be stale: one that says 2013 or older but runs version 16 is a newer Office (usually Microsoft 365).
    const stale = o && /2003|2007|2010|2013/.test(o[1]) && major >= 16;
    if (o && !stale) {
      const d = due(o[2], o[1]);
      if (d) add(d[0], 'Office', d[1], 'Move to Microsoft 365 apps (or Office LTSC 2024)');
    }
  }
  // Hardware
  const mem = Number(raw.Memory) || 0;
  if (mem && mem < 7600) add('soon', 'Memory', `${Math.round(mem / 1024)} GB of memory: slow for business use`, 'Add memory to 8 GB or more, or replace');
  const disks = Array.isArray(raw.HardwareDisks) ? raw.HardwareDisks : (() => { try { return JSON.parse(raw.HardwareDisks || '[]'); } catch { return []; } })();
  const c = disks.find(d => /^c:?$/i.test(String(d.Drive || '').trim()));
  const free = c ? Number(c.Free) : 0;
  if (c && Number(c.Total) > 0 && (free < 15000 || (free / Number(c.Total) < 0.08 && free < 40000))) add('soon', 'Disk', `C: drive nearly full (${Math.round(Number(c.Free) / 1024)} GB free)`, 'Clear space or fit a bigger drive');
  const bios = raw.BiosReleaseDate ? String(raw.BiosReleaseDate).slice(0, 10) : '';
  const age = bios ? days(bios, today) / 365.25 : 0;
  if (age >= 6 && !out.some(f => /Replace/.test(f.fix))) add('soon', 'Age', `About ${Math.floor(age)} years old (${bios.slice(0, 4)})`, 'Budget to replace in the next year');
  return out;
}

/**
 * Per client, worst first. agents: atera_agents rows (with raw); today: YYYY-MM-DD.
 * → { clients: [{ name, own, devices: [{ name, user, os, model, lastSeen, url, findings, level, plan }], asap, soon, replace, upgrade, office }],
 *     gone: [{ client, name, lastSeen }], totals }
 */
export function upgrades(agents, today) {
  const by = new Map();
  const gone = [];
  for (const a of agents || []) {
    const seen = a.last_seen ? days(String(a.last_seen).slice(0, 10), today) : Infinity;
    if (seen > SEEN_DAYS) { gone.push({ client: a.customer_name, name: a.machine_name, lastSeen: a.last_seen }); continue; }
    const findings = deviceFindings(a, today);
    if (!findings.length) continue;
    const level = findings.some(f => f.level === 'asap') ? 'asap' : 'soon';
    const plan = findings.find(f => /^Replace/.test(f.fix)) ? 'replace' : findings.find(f => /Windows 11 \(free/.test(f.fix)) ? 'upgrade'
      : findings.find(f => /server/i.test(f.fix)) ? 'server' : findings.find(f => /latest Windows 11 update/.test(f.fix)) ? 'update'
      : findings.find(f => f.what === 'Office' && f.level === 'asap') ? 'office' : 'other';
    const e = by.get(a.customer_name) || { name: a.customer_name, own: isInternal(a.customer_name), devices: [] };
    e.devices.push({ name: a.machine_name, user: String(a.last_user || a.raw?.LastLoginUser || '').split(/[\\/]/).pop().replace(/\s*\(.*$/, '').trim()
        .replace(/([a-z])([A-Z])/g, '$1 $2'),   // "AzureAD\\ChrisWyeth" → "Chris Wyeth"
      os: String(a.os || '').replace(/^Microsoft\s+|\s+x64$/g, ''),
      model: a.model || a.raw?.VendorBrandModel || '', lastSeen: a.last_seen, url: a.raw?.AppViewUrl || '', findings, level, plan,
      office: findings.some(f => f.what === 'Office' && f.level === 'asap') });
    by.set(a.customer_name, e);
  }
  const clients = [...by.values()].map(c => {
    c.devices.sort((x, y) => (x.level === 'asap' ? 0 : 1) - (y.level === 'asap' ? 0 : 1) || x.name.localeCompare(y.name));
    const n = f => c.devices.filter(f).length;
    return Object.assign(c, { asap: n(d => d.level === 'asap'), soon: n(d => d.level === 'soon'), replace: n(d => d.plan === 'replace'),
      upgrade: n(d => d.plan === 'upgrade'), server: n(d => d.plan === 'server'), update: n(d => d.findings.some(f => /latest Windows 11 update/.test(f.fix))), office: n(d => d.office) });
  }).sort((a, b) => Number(a.own) - Number(b.own) || b.asap - a.asap || b.soon - a.soon || a.name.localeCompare(b.name));
  const sum = k => clients.filter(c => !c.own).reduce((t, c) => t + c[k], 0);
  return {
    clients, gone: gone.sort((a, b) => String(a.client).localeCompare(String(b.client))),
    totals: { asap: sum('asap'), soon: sum('soon'), replace: sum('replace'), upgrade: sum('upgrade'), server: sum('server'), update: sum('update'), office: sum('office'),
      clients: clients.filter(c => !c.own && c.asap).length }
  };
}

/** A task title and note for one client's upgrade work (Add task, pre-filled). */
export function taskFor(c) {
  const parts = [c.replace && `replace ${c.replace} PC${c.replace === 1 ? '' : 's'}`, c.upgrade && `upgrade ${c.upgrade} to Windows 11`, c.update && `update ${c.update} Windows 11`,
    c.server && `plan ${c.server} server${c.server === 1 ? '' : 's'}`, c.office && `move ${c.office} off old Office`].filter(Boolean);
  const title = `Upgrades for ${c.name}: ${parts.join(', ') || 'see Monitoring › Upgrades'}`.slice(0, 140);
  const note = c.devices.filter(d => d.level === 'asap').map(d => `${d.name}${d.user ? ` (${d.user})` : ''}: ${d.findings.filter(f => f.level === 'asap').map(f => f.fix).join(', ')}`).join('; ').slice(0, 500);   // tasks hold a one-line note of 500 characters
  return { title, note };
}
