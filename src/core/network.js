/* A client's network, drawn (Philip, 19 Oct 2026: "could we have a network diagram per client, something visual based on what they have,
   visio style perhaps"; equipment left out for now). Sites come from Atera: machines sharing an internet address are one site (the
   office, someone's home with two PCs); a machine on its own connection is home or remote. Each machine is coloured by a lens:
   health (Windows/Office support), backup (Acronis), antivirus (Webroot). Pure: no window. Tests: tests/network.mjs.
   Design: docs/superpowers/specs/2026-10-19-client-network-design.md */

import { isServer } from './devices.js';
import { machineKey } from './coverage.js';
import { person } from './offline.js';

export const QUIET_DAYS = 30;
export const LENSES = [['health', 'Health'], ['backup', 'Backups'], ['antivirus', 'Antivirus']];
const DAY = 86400000;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const KEY_PC = /\b(sage|file|server|nas|accounts?|dc)\b|server|sage/i;

/** The internet address a site is known by: IPv4 as it is, IPv6 by its first three groups (a home or office's /48). */
export function publicKey(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  if (s.includes(':')) return s.split(':').slice(0, 3).join(':') + '::';
  return s;
}

/** The office network a machine is on ("10.0.0.x"): its first private IPv4 address, Hyper-V/WSL ranges skipped. */
export function lanOf(ips) {
  let list = ips;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = list.split(/[\s,]+/); } }
  const ip = (Array.isArray(list) ? list : []).map(String).find(x => /^(10\.|192\.168\.)/.test(x)) || (Array.isArray(list) ? list : []).map(String).find(x => /^172\.(1[6-9]|2\d|3[01])\./.test(x) && !/^172\.(1[6-9]|2\d|3[01])\.\d+\.1$/.test(x));
  return ip ? ip.split('.').slice(0, 3).join('.') + '.x' : '';
}

/** One Atera agent as a machine on the drawing. */
export function machine(a, today) {
  const raw = a.raw || {};
  const seen = a.last_seen ? new Date(a.last_seen).getTime() : 0;
  const os = String(a.os || raw.OS || '').replace(/^Microsoft\s+|\s+x64$/g, '').replace(/\s+/g, ' ').trim();
  return {
    name: a.machine_name || '', key: machineKey(a.machine_name), user: person(a.last_user || raw.LastLoginUser || ''), os,
    server: isServer(a), laptop: !!raw.BatteryInfo, mac: /mac/i.test(`${a.device_type || ''} ${os}`), online: a.online,
    lastSeen: a.last_seen || null, quiet: !seen || (new Date(today + 'T12:00:00Z').getTime() - seen) > QUIET_DAYS * DAY,
    model: [raw.Vendor, raw.VendorBrandModel].filter(Boolean).join(' '), publicIp: String(raw.ReportedFromIP || ''), lan: lanOf(raw.IpAddresses),
    url: raw.AppViewUrl || ''
  };
}

/**
 * agents (one client's atera_agents rows, raw included) → { sites: [{ key, name, named, publicIp, lan, machines }], remote: machines }.
 * A site is two or more machines on one internet address, biggest first; names: { [site key]: name } (client_sites).
 */
export function sites(agents, { names = {}, today }) {
  const by = new Map();
  for (const a of agents || []) {
    const m = machine(a, today);
    const k = publicKey(m.publicIp) || `none:${m.key}`;
    by.set(k, [...(by.get(k) || []), m]);
  }
  const order = ms => [...ms].sort((x, y) => Number(x.quiet) - Number(y.quiet) || Number(y.server) - Number(x.server)
    || Number(KEY_PC.test(y.name)) - Number(KEY_PC.test(x.name)) || x.name.localeCompare(y.name));
  const groups = [...by.entries()].filter(([k, ms]) => ms.length >= 2 && !k.startsWith('none:'))
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const out = groups.map(([key, ms], i) => {
    const lans = [...new Set(ms.map(m => m.lan).filter(Boolean))];
    return { key, name: names[key] || `Site ${i + 1}`, named: !!names[key], publicIp: key, lan: lans.join(', '), machines: order(ms) };
  });
  const remote = order([...by.entries()].filter(([k, ms]) => ms.length < 2 || k.startsWith('none:')).flatMap(([, ms]) => ms));
  return { sites: out, remote };
}

/**
 * How a machine looks through a lens → 'good' | 'warn' | 'bad' | 'none'. ctx: { findings: Map(name → upgrades findings),
 * backups: Map(machineKey → Coverage machine), av: Set(lower-case Webroot hostnames) }.
 */
export function lensOf(m, lens, ctx) {
  if (lens === 'health') {
    const f = ctx.findings?.get(m.name) || [];
    if (f.some(x => x.level === 'asap' && (x.what === 'Windows' || x.what === 'macOS'))) return 'bad';
    return f.some(x => x.level === 'asap' || x.level === 'soon') ? 'warn' : 'good';
  }
  if (lens === 'backup') {
    const b = ctx.backups?.get(m.key);
    if (!b || !b.protected) return m.server ? 'bad' : 'none';
    if (b.stale || b.state === 'critical') return 'bad';
    return b.state === 'warning' ? 'warn' : 'good';
  }
  if (lens === 'antivirus') {
    if (ctx.av?.has(m.name.toLowerCase()) || ctx.av?.has(m.key)) return 'good';
    return m.quiet || m.mac ? 'none' : 'bad';
  }
  return 'none';
}

export const LEGEND = {
  health: [['good', 'Supported'], ['warn', 'Old Office, or support ending soon'], ['bad', 'No Windows security updates']],
  backup: [['good', 'Backed up'], ['warn', 'Last backup had warnings'], ['bad', 'Failing, or a server with none'], ['none', 'Not backed up']],
  antivirus: [['good', 'Webroot on it'], ['bad', 'No Webroot found'], ['none', 'Quiet or a Mac']]
};

/**
 * The drawing as an SVG string (classes styled by the page, or by EXPORT_CSS for a download). layout: sites(); lens: a LENSES key;
 * ctx: as lensOf; cloud: lines for the cloud box; connection: the main site's connection (e.g. "1Gb ethernet"); selected: a machine name.
 */
export function drawing({ client, layout, lens = 'health', ctx = {}, cloud = [], connection = '', selected = '' }) {
  const W = 960, PAD = 18, TW_GAP = 10, TH = 42, X0 = 44, CW = W - X0 - 16;
  const cols = 4, tw = Math.floor((CW - PAD * 2 - (cols - 1) * TW_GAP) / cols);
  const parts = [];
  const groups = [...layout.sites.map((s, i) => ({ ...s, sub: [i === 0 && connection, s.publicIp && `Internet ${s.publicIp}`, s.lan].filter(Boolean).join(' · ') })),
    ...(layout.remote.length ? [{ key: 'remote', name: 'Home and remote', sub: 'each on their own connection', machines: layout.remote, remote: true }] : [])];
  // Internet and the cloud.
  const netX = 240, netW = 160;
  parts.push(`<g class="nw-net"><rect x="${netX}" y="20" width="${netW}" height="40" rx="8"/><text x="${netX + netW / 2}" y="44" text-anchor="middle" class="nw-h">Internet</text></g>`);
  if (cloud.length) {
    const ch = 30 + cloud.length * 18;
    parts.push(`<g class="nw-cloud"><rect x="${W - 376}" y="14" width="360" height="${ch}" rx="10"/><text x="${W - 360}" y="36" class="nw-h">Cloud services</text>${cloud.map((l, i) => `<text x="${W - 360}" y="${56 + i * 18}" class="nw-s">${esc(cut(l, 58))}</text>`).join('')}</g>`);
    parts.push(`<line x1="${netX + netW}" y1="40" x2="${W - 380}" y2="40" class="nw-line" marker-end="url(#nwArrow)"/>`);
  }
  let y = Math.max(110, cloud.length ? 14 + 30 + cloud.length * 18 + 24 : 110);
  const busTop = y - 26;
  parts.push(`<path d="M${netX + netW / 2} 60 V${busTop} H22" class="nw-line" fill="none"/>`);
  let busBottom = busTop;
  for (const g of groups) {
    const rows = Math.ceil(g.machines.length / cols);
    const h = 52 + rows * (TH + TW_GAP) + 6;
    parts.push(`<g class="nw-site${g.remote ? ' nw-remote' : ''}"><rect x="${X0}" y="${y}" width="${CW}" height="${h}" rx="14"/>
      <text x="${X0 + PAD}" y="${y + 24}" class="nw-h">${esc(g.name)}<tspan class="nw-s" dx="10">${esc(g.machines.length)} machine${g.machines.length === 1 ? '' : 's'}</tspan></text>
      <text x="${X0 + PAD}" y="${y + 42}" class="nw-s">${esc(cut(g.sub || '', 110))}</text></g>`);
    parts.push(`<line x1="22" y1="${y + 20}" x2="${X0 - 2}" y2="${y + 20}" class="nw-line" marker-end="url(#nwArrow)"/>`);
    busBottom = y + 20;
    g.machines.forEach((m, i) => {
      const tx = X0 + PAD + (i % cols) * (tw + TW_GAP), ty = y + 52 + Math.floor(i / cols) * (TH + TW_GAP);
      const state = lensOf(m, lens, ctx);
      const kind = m.server ? 'Server' : m.mac ? 'Mac' : m.laptop ? 'Laptop' : '';
      const line2 = [kind, m.quiet ? `quiet since ${String(m.lastSeen || '').slice(0, 10) || 'never'}` : m.user].filter(Boolean).join(' · ');
      parts.push(`<g class="nw-m nw-${state}${m.server ? ' nw-server' : ''}${m.quiet ? ' nw-quiet' : ''}${selected === m.name ? ' nw-sel' : ''}" data-nw-m="${esc(m.name)}" tabindex="0" role="button" aria-label="${esc(`${m.name}: ${state}`)}">
        <rect x="${tx}" y="${ty}" width="${tw}" height="${TH}" rx="6"/>${m.online ? `<circle cx="${tx + tw - 10}" cy="${ty + 10}" r="3.5" class="nw-on"/>` : ''}
        <text x="${tx + 10}" y="${ty + 17}" class="nw-name">${esc(cut(m.name, 24))}</text><text x="${tx + 10}" y="${ty + 33}" class="nw-s">${esc(cut(line2, 30))}</text></g>`);
    });
    y += h + 16;
  }
  parts.push(`<path d="M22 ${busTop} V${busBottom}" class="nw-line" fill="none"/>`);
  // Legend.
  const legend = LEGEND[lens] || [];
  let lx = X0;
  legend.forEach(([state, label]) => {
    parts.push(`<g class="nw-m nw-${state} nw-key"><rect x="${lx}" y="${y + 6}" width="14" height="14" rx="3"/></g><text x="${lx + 20}" y="${y + 17}" class="nw-s">${esc(label)}</text>`);
    lx += 34 + label.length * 6.4;
  });
  parts.push(`<circle cx="${lx + 7}" cy="${y + 13}" r="3.5" class="nw-on"/><text x="${lx + 16}" y="${y + 17}" class="nw-s">On now</text>`);
  const H = y + 34;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="nw-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(`Network drawing for ${client}`)}">
    <defs><marker id="nwArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>
    ${parts.join('\n')}</svg>`;
}

/** Colours for a downloaded or printed copy (no page around it): light, like a Visio page. */
export const EXPORT_CSS = `
  .nw-svg { background: #fff; font-family: Arial, Helvetica, sans-serif; }
  .nw-h { font-size: 14px; font-weight: 700; fill: #1f2933; } .nw-s { font-size: 11px; fill: #5f6b76; } .nw-name { font-size: 12px; font-weight: 700; fill: #1f2933; }
  .nw-net rect { fill: #eef2f5; stroke: #8a96a3; } .nw-cloud rect { fill: #e8f1fb; stroke: #6b9bd1; }
  .nw-site rect { fill: #f3faf6; stroke: #4f9d74; } .nw-remote rect { fill: #f7f7f5; stroke: #a3a39a; stroke-dasharray: 5 4; }
  .nw-line { stroke: #8a96a3; stroke-width: 1.2; }
  .nw-m rect { stroke-width: 1; } .nw-good rect { fill: #e6f4ea; stroke: #3c8d5a; } .nw-warn rect { fill: #fdf3dc; stroke: #c48a16; }
  .nw-bad rect { fill: #fde8e6; stroke: #c4453a; } .nw-none rect { fill: #f1f1ee; stroke: #a3a39a; }
  .nw-server rect { stroke-width: 2.2; } .nw-quiet { opacity: .55; } .nw-quiet rect { stroke-dasharray: 4 3; } .nw-on { fill: #2e9d5b; }`;
