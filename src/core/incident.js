/* Help with this (Philip, 19 Oct 2026: "1-3 i like very much"; after Kelly's PC at Daron: "this dashboard should be telling me this").
   What the AI is told about one machine's problem: the machine as Atera last saw it, the problem (an alert, or not on this morning),
   and recent timesheet notes that mention the machine or its user. Pure: no window. Tests: tests/incident.mjs.
   Design: docs/superpowers/specs/2026-10-19-incident-help-design.md */

import { person } from './offline.js';

const day = iso => (iso ? String(new Date(iso).toISOString()).slice(0, 10) : '');
const gb = mb => Math.round((Number(mb) || 0) / 1024);

/** The machine as the AI sees it, from an atera_agents row (raw included). Unknowns are left out, never guessed. */
export function machineFacts(a) {
  if (!a) return null;
  const raw = a.raw || {};
  const disks = (Array.isArray(raw.HardwareDisks) ? raw.HardwareDisks : []).map(d => ({ drive: String(d.Drive || ''), freeGb: gb(d.Free), totalGb: gb(d.Total) }));
  const bios = Number(String(raw.BiosReleaseDate || '').slice(0, 4)) || null;
  const out = {
    name: a.machine_name || '', type: /server|domain controller/i.test(`${a.device_type || ''} ${a.os || ''}`) ? 'server' : raw.BatteryInfo ? 'laptop' : 'desktop',
    user: person(a.last_user || raw.LastLoginUser || ''), os: String(a.os || raw.OS || '').replace(/^Microsoft\s+|\s+x64$/g, '').trim(),
    osBuild: String(raw.OSBuild || a.os_version || ''), model: [raw.Vendor, raw.VendorBrandModel].filter(Boolean).join(' '),
    processor: String(raw.Processor || ''), memoryGb: raw.Memory ? Math.round(Number(raw.Memory) / 1024) : null,
    disks, madeAbout: bios, online: a.online, lastSeen: a.last_seen || null, lastRestart: raw.LastRebootTime || null,
    batteryHealth: raw.BatteryInfo?.BatteryHealth ?? null
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
}

/** Recent timesheet notes that mention this machine or its user (newest first, at most 12): what's been done to it before. */
export function relatedWork(entries, { device = '', user = '' } = {}) {
  const words = [device, user.split(/\s+/)[0]].map(w => String(w || '').trim()).filter(w => w.length >= 3);
  if (!words.length) return [];
  const re = new RegExp(`\\b(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  return (entries || []).filter(e => re.test(`${e.title || ''} ${e.work_description || ''}`))
    .sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date))).slice(0, 12)
    .map(e => ({ date: day(e.entry_date), note: [e.title, e.work_description].filter((v, i, xs) => v && xs.indexOf(v) === i).join(': ').slice(0, 300) }));
}

/** Everything the AI gets for one incident. problem: a sentence; details: what the alert or check says. */
export function incidentFacts({ client, machine = null, problem, details = {}, related = [], today }) {
  return { client, today, problem, details, machine: machine || 'not found in Atera', recentWorkOnIt: related };
}
