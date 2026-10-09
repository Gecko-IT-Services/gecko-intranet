/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   ALERTS (ATERA TRIAGE)                                           ║
   ║                                                                   ║
   ║   Atera emails every Critical alert to support@gecko-it.com —     ║
   ║   around nine a day, nearly all noise (printer SNMP, disks        ║
   ║   bouncing over 90%, laptop CPU/memory spikes). This section      ║
   ║   reads those emails, folds repeats into one issue per device and ║
   ║   problem, and shows only the ones that need a person.            ║
   ║                                                                   ║
   ║   Read-only. Uses the same Mail.Read.Shared incremental consent   ║
   ║   as Backups. The triage rules live in assess() below and are     ║
   ║   unit-tested in tests/atera-alerts.mjs — change them there.      ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access in this file.                ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { graphFetch, resolveSiteId, fetchAllLists } from '../core/graph.js';
import { toast, escapeHtml, syncTableLabels } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';

export const MAILBOX     = 'support@gecko-it.com';
export const SENDER      = 'noreply@atera.com';
export const MAIL_SCOPES = ['Mail.Read.Shared'];
export const WINDOWS     = [7, 14, 30];       // days offered in the picker
const PAGE_SIZE          = 50;
const SAFETY_LIMIT       = 2000;
const DAY_MS             = 86400000;

/** An issue with no new alert for this long is shown as "quiet". */
export const QUIET_DAYS = 3;

const ALR = {
  days: 7,
  showNoise: false,
  query: '',
  issues: null,
  stats: null,
  capped: false,
  loading: false,
  error: null,
  clients: null,     // Clients list rows, loaded on first "Email client"
  entries: [],       // parsed alert emails, kept so a resolve can re-triage without re-reading mail
  resolutions: new Map(),
  resolutionsMissing: false,
  showResolved: false,
};
export const RESOLUTIONS_LIST = 'GeckoAlertResolutions';
const CLIENTS_LIST = 'Clients';

// ─── Parsing (pure) ───────────────────────────────────────────────────

const decode = s => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");

/**
 * One Atera email → one or more alert entries. A single email can carry
 * several devices (subject "Alert; Problem"), each block starting "Device:".
 * Works on the HTML body (keeps the Atera device link) and falls back to
 * plain text when that is all there is.
 */
export function parseAteraEmail(body) {
  // Flatten each block to one line of text and parse that. The live
  // messages from Graph do NOT keep line breaks between Atera's <div>s,
  // so anything line-based reads the whole email as the device name.
  const html = String(body || '').replace(/&nbsp;/gi, ' ');
  const parts = html.split(/Device:\s*/i).slice(1);
  const out = [];
  for (const part of parts) {
    const url = part.slice(0, 800).match(/href="(https:\/\/app\.atera\.com[^"]*\/device\/[^"]*)"/i);
    const resolve = part.match(/href="(https:\/\/app\.atera\.com[^"]*\/alerts\/resolve\/[^"]*)"/i);
    const text = decode(part.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const m = text.match(/^(.*?)\s*Status:\s*(\w+)\s*(.*?)\s*(?:Created at\b.*|Mark alert as resolved.*|_{3,}.*)?$/i);
    const head = (m ? m[1] : text).trim();
    // "Karen's PC (Home) (Freeston Water Treatment)": the client is the LAST bracket.
    const dc = head.match(/^(.*)\(([^()]*)\)\s*$/);
    out.push({
      device:    (dc ? dc[1] : head).trim() || 'Unknown device',
      client:    (dc ? dc[2] : '').trim() || 'Unknown client',
      deviceUrl: url ? decode(url[1]) : '',
      resolveUrl: resolve ? decode(resolve[1]) : '',
      status:    m ? m[2] : 'Problem',
      message:   m ? m[3].trim() : '',
    });
  }
  return out;
}

/** What kind of problem an alert message describes, plus its measured value. */
export function classify(message) {
  const m = String(message || '');
  let x;
  if ((x = m.match(/Disk Usage\s*\(([A-Z]):?\)\s*([\d.]+)%/i))) return { kind: 'disk', drive: x[1].toUpperCase(), value: +x[2] };
  if ((x = m.match(/CPU Load\s*([\d.]+)%/i)))                    return { kind: 'cpu', value: +x[1] };
  if ((x = m.match(/Memory Usage\s*([\d.]+)%/i)))                return { kind: 'memory', value: +x[1] };
  if ((x = m.match(/Windows Service \((.+?)\) State is (\w+)/i))) return { kind: 'service', service: x[1], state: x[2] };
  if (/Machine status unknown|has not established communication|offline/i.test(m)) return { kind: 'offline' };
  if (/No SNMP response/i.test(m))                              return { kind: 'snmp' };
  return { kind: 'other' };
}

// ─── Triage rules (pure, unit-tested) ─────────────────────────────────

/** Servers matter whatever is wrong with them. */
export const isServer = device => /\bserver\b|\bsrv\b|\bdc\b|^dc[\s-]/i.test(device);

/** Machines a client's business stops without: accounts, files, databases. */
export const isKeyMachine = device => isServer(device) || /\bsage\b|\bfile\b|database|\baccounts?\b|\bnas\b/i.test(device);

/** Home machines go off at night; their silence is not a fault. */
export const isHomeMachine = device => /\bhome\b/i.test(device);

/**
 * The single source of truth for "does a person need to see this?".
 * Returns { level: 'critical' | 'important' | 'noise', why }.
 *
 *   critical  — act today
 *   important — act this week
 *   noise     — kept behind the "show filtered" toggle, never deleted
 */
export function assess(issue) {
  const { kind, device, days } = issue;
  // Disks are judged on the latest reading: a drive someone has since
  // cleared from 99% to 91% no longer needs anyone.
  const pct = issue.current || issue.peak || 0;
  const server = isServer(device);
  const key = isKeyMachine(device);

  if (kind === 'snmp') return { level: 'noise', why: 'Printer asleep (SNMP)' };

  if (server && kind !== 'cpu' && kind !== 'memory') {
    return { level: 'critical', why: 'Server' };
  }

  switch (kind) {
    case 'disk':
      if (pct >= 98) return { level: 'critical', why: `Drive ${issue.drive}: is full (${pct.toFixed(0)}%)` };
      if (pct >= 95) return { level: 'important', why: `Drive ${issue.drive}: nearly full (${pct.toFixed(0)}%)` };
      return { level: 'noise', why: 'Disk hovering just over 90%' };

    case 'service':
      if (key) return { level: 'important', why: 'Backup agent stopped on a key machine' };
      if (days >= 2) return { level: 'important', why: `Backup agent stopped on ${days} separate days` };
      return { level: 'noise', why: 'One-off backup agent stop' };

    case 'offline':
      if (isHomeMachine(device)) return { level: 'noise', why: 'Home PC switched off' };
      if (key) return { level: 'important', why: 'Key machine not reporting to Atera' };
      return { level: 'noise', why: 'Laptop or PC switched off' };

    case 'cpu':
    case 'memory':
      if (server && days >= 2) return { level: 'important', why: `Server ${kind} high on ${days} days` };
      return { level: 'noise', why: `${kind === 'cpu' ? 'CPU' : 'Memory'} spike on a workstation` };

    default:
      // Something Atera started alerting on that these rules don't know yet:
      // surface it rather than hide it.
      return { level: 'important', why: 'New type of alert' };
  }
}

/** Short human label for an issue, e.g. "D: drive 100% full". */
export function describe(issue) {
  switch (issue.kind) {
    case 'disk': {
      const now = (issue.current || issue.peak).toFixed(1);
      return issue.peak > issue.current + 0.5
        ? `${issue.drive}: drive at ${now}% (peaked ${issue.peak.toFixed(1)}%)`
        : `${issue.drive}: drive at ${now}%`;
    }
    case 'cpu':     return `CPU at ${issue.peak.toFixed(0)}% for 30+ min`;
    case 'memory':  return `Memory at ${issue.peak.toFixed(0)}% for 30+ min`;
    case 'service': return `${issue.service} ${issue.state.toLowerCase()}`;
    case 'offline': return 'Not reporting to Atera';
    case 'snmp':    return 'Printer not responding (SNMP)';
    default:        return issue.message || 'Alert';
  }
}

/**
 * resolutions: Map of issue key → { at: Date, by, note, id } from the
 * GeckoAlertResolutions list. An issue resolved after its last alert is
 * returned with level 'resolved'; one that alerted again afterwards comes
 * back with `reopened` set.
 *
 * Raw alert entries → triaged issues. One issue per client + device + kind
 * (+ drive / service). Repeats are counted, not listed.
 * Atera's "Resolved" emails, if switched on, close the issue.
 */
export function buildIssues(entries, now = new Date(), resolutions = new Map()) {
  const map = new Map();
  for (const e of entries || []) {
    const when = e.when instanceof Date ? e.when : new Date(e.when);
    if (Number.isNaN(when.getTime())) continue;
    const c = classify(e.message);
    const key = [e.client, e.device, c.kind, c.drive || '', c.service || ''].join('|').toLowerCase();
    let is = map.get(key);
    if (!is) {
      is = {
        key, client: e.client, device: e.device, deviceUrl: e.deviceUrl || '',
        kind: c.kind, drive: c.drive || '', service: c.service || '', state: c.state || '',
        message: e.message, count: 0, first: when, last: when, peak: 0, current: 0,
        dayset: new Set(), resolvedAt: null, link: e.link || '', resolveUrl: '',
      };
      map.set(key, is);
    }
    if (/^resolved$/i.test(e.status)) {
      if (!is.resolvedAt || when > is.resolvedAt) is.resolvedAt = when;
      continue;
    }
    is.count++;
    is.dayset.add(when.toISOString().slice(0, 10));
    if (when < is.first) is.first = when;
    if (when >= is.last) {
      is.last = when; is.message = e.message; is.link = e.link || is.link;
      if (e.resolveUrl) is.resolveUrl = e.resolveUrl;
      if (c.state) is.state = c.state;
      if (typeof c.value === 'number') is.current = c.value;
    }
    if (typeof c.value === 'number' && c.value > is.peak) is.peak = c.value;
    if (e.deviceUrl) is.deviceUrl = e.deviceUrl;
  }

  const RANK = { critical: 0, important: 1, noise: 2, resolved: 3 };
  const issues = [];
  for (const is of map.values()) {
    if (!is.count) continue;                                   // only a Resolved seen
    const resolved = !!is.resolvedAt && is.resolvedAt >= is.last;
    if (resolved) continue;
    is.days = is.dayset.size;
    delete is.dayset;
    is.quiet = (now - is.last) > QUIET_DAYS * DAY_MS;
    const a = assess(is);
    // A non-critical issue that has gone quiet has most likely sorted itself
    // out (no Resolved emails to prove it), so it drops to noise.
    is.level = (is.quiet && a.level === 'important') ? 'noise' : a.level;
    is.why = (is.quiet && a.level === 'important') ? `${a.why}; quiet for ${Math.floor((now - is.last) / DAY_MS)} days` : a.why;
    is.label = describe(is);
    const r = resolutions.get(is.key);
    if (r && r.at >= is.last) {
      is.level = 'resolved';
      is.resolution = r;
      is.why = `Resolved by ${r.by || 'someone'}${r.note ? `: ${r.note}` : ''}`;
    } else if (r) {
      // Alerted again after we said it was fixed: never stay hidden, and
      // never sit in the filtered pile either.
      is.reopened = r;
      if (is.level === 'noise') is.level = 'important';
      is.why = `Back since ${r.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}. ${a.why}`;
    }
    issues.push(is);
  }
  issues.sort((a, b) => RANK[a.level] - RANK[b.level] || b.last - a.last);
  return issues;
}

/** GeckoAlertResolutions items → Map(issue key → latest resolution). */
export function resolutionsFromItems(items) {
  const map = new Map();
  for (const it of items || []) {
    const key = String(it.fields?.Title || '').toLowerCase();
    const at = new Date(it.createdDateTime || it.fields?.Created);
    if (!key || Number.isNaN(at.getTime())) continue;
    const prev = map.get(key);
    if (prev && prev.at >= at) continue;
    map.set(key, {
      id: it.id, at, note: it.fields?.Note || '',
      by: it.createdBy?.user?.displayName || it.fields?.ResolvedBy || '',
    });
  }
  return map;
}

// ─── Client email (pure, unit-tested) ─────────────────────────────────

/** Loose client-name key: "Technix Rubber & Plastics Ltd" ≈ "technix rubber and plastics". */
export const clientKey = s => String(s || '').toLowerCase()
  .replace(/&/g, ' and ').replace(/\b(ltd|limited|plc|llp)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** Find the Clients-list row for an Atera client name. Exact key first, then containment. */
export function matchClient(name, clients) {
  const k = clientKey(name);
  if (!k) return null;
  const list = (clients || []).filter(c => c && c.name);
  return list.find(c => clientKey(c.name) === k)
      || list.find(c => { const ck = clientKey(c.name); return ck && (ck.includes(k) || k.includes(ck)); })
      || null;
}

/** "Jenny's PC" → "Jenny"; "Darren Laptop (New)" → "Darren"; "FP Server" → "". */
export function ownerFromDevice(device) {
  const d = String(device || '').trim();
  let m = d.match(/^([A-Z][a-z]+)['’]s\b/);
  if (m) return m[1];
  m = d.match(/^([A-Z][a-z]+)\s+(Laptop|PC|Desktop|Mac|Surface)\b/i);
  if (m && !/^(sage|file|database|office|spare|main|new|old|warranty|admin)$/i.test(m[1])) return m[1];
  return '';
}

const firstName = s => String(s || '').trim().split(/\s+/)[0] || '';

/**
 * The plain-English explanation and the fix we are asking permission for,
 * per kind of problem. Written for the person at the desk, not for IT.
 */
export function explain(issue) {
  const dev = issue.device;
  const pct = (issue.current || issue.peak || 0).toFixed(0);
  switch (issue.kind) {
    case 'disk': {
      const full = (issue.current || issue.peak || 0) >= 99;
      return {
        short: full ? `${dev} has run out of storage space` : `${dev} is running out of storage space`,
        what: full
          ? `Our monitoring shows that ${dev} has run out of storage space: the ${issue.drive}: drive is completely full. When a drive is full, the computer slows down, files can fail to save, and Windows updates and backups can stop working.`
          : `Our monitoring shows that ${dev} is almost out of storage space: the ${issue.drive}: drive is ${pct}% full. When a drive fills up, the computer slows down, files can fail to save, and Windows updates and backups can stop working.`,
        fix: `We'd like to connect remotely and free up space by clearing temporary files, old Windows update files and the recycle bin, and check what is taking up the room. We won't delete any of your own documents without asking you first. It takes about 20 to 30 minutes and you can carry on working while we do it.`,
      };
    }
    case 'service':
      return {
        short: `the backup software on ${dev} has stopped`,
        what: `Our monitoring shows that the backup software on ${dev} has stopped running, which means the computer may not be being backed up at the moment.`,
        fix: `We'd like to connect remotely, restart the backup service and run a test backup to make sure everything is protected again. It takes about 10 minutes and shouldn't interrupt your work.`,
      };
    case 'offline':
      return {
        short: `${dev} has stopped checking in with us`,
        what: `${dev} hasn't checked in with our monitoring since ${issue.last.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' })}. That usually means it has been switched off, disconnected or replaced, but it can also mean something has stopped working on it.`,
        fix: `If it's been retired or replaced, just let us know and we'll tidy up our records. If it should be running, we'd like to take a look remotely, or arrange a visit if we can't reach it.`,
      };
    case 'cpu':
    case 'memory':
      return {
        short: `${dev} is running slowly`,
        what: `Our monitoring shows that ${dev} has been working flat out (${issue.kind === 'cpu' ? 'processor' : 'memory'} at ${pct}%) for long periods, which will make it feel slow and can cause programs to freeze.`,
        fix: `We'd like to connect remotely, find out what is using the resources and sort it out. It takes about 20 minutes.`,
      };
    default:
      return {
        short: `our monitoring has flagged a problem with ${dev}`,
        what: `Our monitoring has flagged a problem with ${dev}: "${issue.message}".`,
        fix: `We'd like to connect remotely and look into it. It shouldn't take long.`,
      };
  }
}

/**
 * Draft for the client: what's wrong in plain English, what we'd do, and a
 * request for permission. `contact` is the Clients-list row (may be null).
 */
export function composeEmail(issue, contact, sender = '') {
  const e = explain(issue);
  const owner = ownerFromDevice(issue.device);
  const hello = owner || firstName(contact?.primaryContact);
  const server = isServer(issue.device);
  const short = e.short.charAt(0).toUpperCase() + e.short.slice(1);
  const lines = [
    `Hi ${hello || 'there'},`,
    '',
    e.what,
    '',
    e.fix,
    '',
    server
      ? `As this is a server, we'll agree a time with you first so nobody loses their work.`
      : `Are you happy for us to go ahead? If now isn't a good time, just reply with a time that suits you.`,
    '',
    'Kind regards,',
    sender || 'The Gecko IT team',
    'Gecko IT Services',
    '02381 800171 | support@gecko-it.com',
  ];
  return {
    to: contact?.email || '',
    subject: `${short}: OK for us to fix it?`,
    body: lines.join('\n'),
  };
}

/** Outlook on the web compose window, prefilled. Opens in a new tab. */
export function outlookComposeUrl({ to, subject, body }) {
  const q = new URLSearchParams({ to: to || '', subject, body });
  return `https://outlook.office.com/mail/deeplink/compose?${q.toString().replace(/\+/g, '%20')}`;
}

export function summarise(issues, alertCount) {
  const s = { critical: 0, important: 0, noise: 0, resolved: 0, alerts: alertCount, noiseAlerts: 0 };
  for (const i of issues) { s[i.level]++; if (i.level === 'noise') s.noiseAlerts += i.count; }
  return s;
}

/** Graph path for the first page of the window. */
export function messagesPath(days, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const filter = `receivedDateTime ge ${since} and from/emailAddress/address eq '${SENDER}'`;
  return `/users/${encodeURIComponent(MAILBOX)}/messages`
    + `?$filter=${encodeURIComponent(filter)}`
    + `&$orderby=${encodeURIComponent('receivedDateTime desc')}`
    + `&$select=subject,receivedDateTime,body,webLink`
    + `&$top=${PAGE_SIZE}`;
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchEntries(days, { interactive = false } = {}) {
  const entries = [];
  let messages = 0, capped = false;
  let next = messagesPath(days);
  while (next) {
    const res = await graphFetch(next, { scopes: MAIL_SCOPES, interactive });
    for (const msg of res?.value || []) {
      messages++;
      for (const e of parseAteraEmail(msg.body?.content)) {
        entries.push({ ...e, when: msg.receivedDateTime, link: msg.webLink || '' });
      }
    }
    next = res?.['@odata.nextLink'] || null;
    if (messages >= SAFETY_LIMIT) { capped = !!next; break; }
  }
  return { entries, capped };
}

let loadSeq = 0;

async function load({ interactive = false } = {}) {
  const seq = ++loadSeq;
  ALR.loading = true;
  ALR.error = null;
  setBusy(true);
  render();
  try {
    const [{ entries, capped }] = await Promise.all([
      fetchEntries(ALR.days, { interactive }),
      loadResolutions(),
    ]);
    if (seq !== loadSeq) return;
    ALR.entries = entries;
    ALR.capped = capped;
    retriage();
    const stamp = document.getElementById('alrLastSync');
    if (stamp) stamp.textContent = 'Synced ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    if (seq !== loadSeq) return;
    const msg = err?.message || 'Load failed';
    ALR.error = err?.code === 'CONSENT_REQUIRED' ? 'CONSENT'
              : /Graph 403|ErrorAccessDenied|Access is denied/i.test(msg) ? 'NO_ACCESS'
              : msg;
  } finally {
    if (seq === loadSeq) {
      ALR.loading = false;
      setBusy(false);
      render();
    }
  }
}

/**
 * The morning check (Overview › Today): issues from the last `days` that need a person (critical
 * first), triaged exactly as this section does, resolutions included. Never throws:
 * { ok, stats, needing: [{ client, device, level, label, why, last, link }] } or { ok: false, error }.
 */
export async function snapshot({ days = 2, interactive = false } = {}) {
  try {
    const [{ entries }] = await Promise.all([fetchEntries(days, { interactive }), loadResolutions()]);
    const issues = buildIssues(entries, new Date(), ALR.resolutions || new Map());
    const alerts = entries.filter(e => !/^resolved$/i.test(e.status)).length;
    return { ok: true, stats: summarise(issues, alerts),
      needing: issues.filter(i => i.level === 'critical' || i.level === 'important')
        .map(i => ({ client: i.client, device: i.device, level: i.level, label: i.label, why: i.why, last: i.last, link: i.link })) };
  } catch (err) {
    const msg = err?.message || 'Load failed';
    return { ok: false, error: err?.code === 'CONSENT_REQUIRED' ? 'CONSENT' : /Graph 403|ErrorAccessDenied|Access is denied/i.test(msg) ? 'NO_ACCESS' : msg };
  }
}

function retriage() {
  const alerts = ALR.entries.filter(e => !/^resolved$/i.test(e.status)).length;
  ALR.issues = buildIssues(ALR.entries, new Date(), ALR.resolutions);
  ALR.stats = summarise(ALR.issues, alerts);
}

const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };

/** Database rows → the item shape resolutionsFromItems reads. */
const rowsAsItems = rows => rows.map(r => ({
  id: r.id, createdDateTime: r.created_at, fields: { Title: r.issue_key, Note: r.note, ResolvedBy: r.resolved_by }
}));

/**
 * Resolutions live in the Gecko database (alert_resolutions) since 8 Oct 2026.
 * Any left in the old GeckoAlertResolutions SharePoint list are brought across
 * once (sharepoint_id keeps that idempotent). Never fails the page: without the
 * database, issues just can't be marked resolved.
 */
async function loadResolutions() {
  try {
    const sb = await connectSupabase();
    await importOldResolutions(sb);
    const rows = must(await sb.from('alert_resolutions').select('*').order('created_at'));
    ALR.resolutions = resolutionsFromItems(rowsAsItems(rows));
    ALR.resolutionsMissing = false;
  } catch (err) {
    ALR.resolutionsMissing = err?.code === 'DB_SIGNIN_REQUIRED';
    if (!ALR.resolutionsMissing) toast('Could not read resolved alerts: ' + (err?.message || 'error'), 'error');
  }
}

async function importOldResolutions(sb) {
  if (ALR.oldImported) return;
  try {
    const list = (await fetchAllLists()).find(l => l.displayName === RESOLUTIONS_LIST || l.name === RESOLUTIONS_LIST);
    if (list) {
      const siteId = await resolveSiteId();
      const items = [];
      let next = `/sites/${siteId}/lists/${list.id}/items?expand=fields($select=Title,Note)&$select=id,createdDateTime,createdBy&$top=999`;
      while (next) {
        const res = await graphFetch(next);
        items.push(...(res?.value || []));
        next = res?.['@odata.nextLink'] || null;
      }
      const rows = items.filter(it => it.fields?.Title).map(it => ({
        issue_key: String(it.fields.Title).toLowerCase(), note: it.fields?.Note || '',
        resolved_by: it.createdBy?.user?.displayName || '', sharepoint_id: String(it.id), created_at: it.createdDateTime
      }));
      if (rows.length) must(await sb.from('alert_resolutions').upsert(rows, { onConflict: 'sharepoint_id', ignoreDuplicates: true }));
    }
    ALR.oldImported = true;
  } catch (err) {
    console.warn('Old GeckoAlertResolutions list not brought across:', err);
  }
}

function setBusy(busy) {
  const btn = document.getElementById('alrRefresh');
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('spinning', busy);
  if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

// ─── Render ───────────────────────────────────────────────────────────

const fmtWhen = d => d.toLocaleString('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
});
const BADGE = { critical: 'badge-red', important: 'badge-amber', noise: 'badge-blue', resolved: 'badge-green' };
const LEVEL = { critical: 'Act today', important: 'This week', noise: 'Filtered', resolved: 'Resolved' };

const consentMessage = () => `
  <div class="bkp-error">
    <strong>No permission to read ${escapeHtml(MAILBOX)}.</strong>
    <button type="button" class="btn btn-sm btn-primary" id="alrGrant">Grant mailbox access</button>
  </div>`;

const noAccessMessage = () => `
  <div class="bkp-error">
    <strong>Your account can't open ${escapeHtml(MAILBOX)}.</strong>
    Needs Full Access in Exchange admin (can take an hour).
  </div>`;

export function renderKpis(stats) {
  const v = k => stats ? stats[k] : '–';
  const tile = (val, label, tone) => `
    <div class="bkp-kpi alr-kpi"><span class="bkp-kpi-val is-${tone}">${val}</span><span class="bkp-kpi-lbl">${label}</span></div>`;
  return tile(v('critical'), 'Act today', 'fail')
       + tile(v('important'), 'This week', 'warn')
       + tile(v('resolved'), 'Resolved', 'ok')
       + tile(v('noise'), 'Filtered', 'muted');
}

export function renderIssue(is) {
  const seen = is.count > 1
    ? `${is.count} alerts over ${is.days} day${is.days === 1 ? '' : 's'}`
    : '1 alert';
  return `
    <tr class="alr-row alr-${is.level}">
      <td><span class="badge ${BADGE[is.level]}">${LEVEL[is.level]}</span>${is.reopened ? '<span class="badge badge-purple alr-back">Back again</span>' : ''}</td>
      <td class="bkp-what"><strong>${escapeHtml(is.client)}</strong>
        <span class="bkp-sub">${is.deviceUrl
          ? `<a href="${escapeHtml(is.deviceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(is.device)}</a>`
          : escapeHtml(is.device)}</span></td>
      <td class="bkp-what"><strong>${escapeHtml(is.label)}</strong>
        <span class="bkp-sub">${escapeHtml(is.why)}</span></td>
      <td class="bkp-mono">${escapeHtml(seen)}<span class="bkp-sub">first ${escapeHtml(fmtWhen(is.first))}</span>${is.link ? `<a class="bkp-sub" href="${escapeHtml(is.link)}" target="_blank" rel="noopener noreferrer">view alert</a>` : ''}</td>
      <td class="bkp-mono">${escapeHtml(fmtWhen(is.last))}${is.quiet ? '<span class="bkp-sub">quiet since</span>' : ''}</td>
      <td class="alr-actions">${is.level === 'resolved'
        ? `<span class="bkp-sub">${escapeHtml(fmtWhen(is.resolution.at))}</span><button type="button" class="btn btn-sm" data-alr-undo="${escapeHtml(is.key)}">Undo</button>`
        : `<button type="button" class="btn btn-sm" data-alr-email="${escapeHtml(is.key)}">Email client</button><button type="button" class="btn btn-sm" data-alr-resolve="${escapeHtml(is.key)}">Resolved</button>`}</td>
    </tr>`;
}

function table(rows) {
  return `
    <div class="bkp-card alr-card">
      <div class="bkp-tbl-wrap">
        <table>
          <thead><tr><th>Priority</th><th>Client / device</th><th>Problem</th><th>Seen</th><th>Last alert</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function render() {
  const mount = document.getElementById('alrBoard');
  if (!mount) return;

  document.querySelectorAll('#section-alerts [data-alr-days]').forEach(b =>
    b.setAttribute('aria-pressed', String(+b.dataset.alrDays === ALR.days)));
  const kpis = document.getElementById('alrKpis');
  if (kpis) kpis.innerHTML = renderKpis(ALR.error ? null : ALR.stats);
  const toggle = document.getElementById('alrShowNoise');
  if (toggle) toggle.checked = ALR.showNoise;
  const rtoggle = document.getElementById('alrShowResolved');
  if (rtoggle) rtoggle.checked = ALR.showResolved;

  if (ALR.loading && !ALR.issues) { mount.innerHTML = '<p class="bkp-empty art art-loading">Loading alerts…</p>'; return; }
  if (ALR.error === 'CONSENT')   { mount.innerHTML = consentMessage(); return; }
  if (ALR.error === 'NO_ACCESS') { mount.innerHTML = noAccessMessage(); return; }
  if (ALR.error) {
    mount.innerHTML = `<div class="bkp-error art art-offline"><strong>Could not load Atera alerts.</strong>${escapeHtml(ALR.error)}<button type="button" class="btn btn-sm" id="alrRetry">Retry</button></div>`;
    return;
  }
  if (!ALR.issues) return;

  const q = ALR.query.toLowerCase();
  const match = is => !q || `${is.client} ${is.device} ${is.label}`.toLowerCase().includes(q);
  const actionable = ALR.issues.filter(i => (i.level === 'critical' || i.level === 'important') && match(i));
  const resolved = ALR.issues.filter(i => i.level === 'resolved' && match(i));
  const noise = ALR.issues.filter(i => i.level === 'noise' && match(i));

  const main = actionable.length
    ? table(actionable.map(renderIssue).join(''))
    : '<p class="bkp-empty art art-clear">Nothing needs attention.</p>';

  const noisePart = ALR.showNoise && noise.length
    ? `<h3 class="alr-h">Filtered (${noise.length} issues, ${ALR.stats.noiseAlerts} emails)</h3>${table(noise.map(renderIssue).join(''))}`
    : '';

  const resolvedPart = ALR.showResolved
    ? (resolved.length
        ? `<h3 class="alr-h">Resolved (${resolved.length})</h3>${table(resolved.map(renderIssue).join(''))}`
        : '<h3 class="alr-h">Resolved</h3><p class="bkp-empty">None in this window.</p>')
    : '';

  mount.innerHTML = `
    ${ALR.resolutionsMissing ? '<p class="bkp-note">Not connected to the database: resolved alerts can’t be shown.</p>' : ''}
    ${ALR.capped ? `<p class="bkp-note">Newest ${SAFETY_LIMIT.toLocaleString('en-GB')} emails only. Pick a shorter window.</p>` : ''}
    ${main}
    ${noisePart}
    ${resolvedPart}`;
  syncTableLabels(mount);
}

// ─── Email client (modal) ─────────────────────────────────────────────

async function loadContacts() {
  if (ALR.clients) return ALR.clients;
  try {
    const siteId = await resolveSiteId();
    const list = (await fetchAllLists()).find(l => l.displayName === CLIENTS_LIST || l.name === CLIENTS_LIST);
    // The SSA client list, from wherever it lives (database or SharePoint).
    const items = await window.ssaListItems('clients', siteId, list?.id);
    ALR.clients = items.map(i => ({
      name: i.fields?.Title || '', primaryContact: i.fields?.PrimaryContact || '', email: i.fields?.Email || '',
    })).filter(c => c.name);
  } catch {
    ALR.clients = [];   // the draft still works; the To field is just empty
  }
  return ALR.clients;
}

function senderName() {
  const n = document.getElementById('userName')?.textContent?.trim() || '';
  return /not signed in/i.test(n) ? '' : n;
}

let focusBeforeModal = null;

function closeModal() {
  document.getElementById('alrBackdrop')?.setAttribute('hidden', '');
  focusBeforeModal?.isConnected && focusBeforeModal.focus();
  focusBeforeModal = null;
}

async function openEmail(key) {
  const issue = ALR.issues?.find(i => i.key === key);
  const backdrop = document.getElementById('alrBackdrop');
  const body = document.getElementById('alrModalBody');
  if (!issue || !backdrop || !body) return;
  openModal('Email the client', '<p class="bkp-sub">Preparing…</p>');

  const contact = matchClient(issue.client, await loadContacts());
  const draft = composeEmail(issue, contact, senderName());
  const note = contact
    ? `To: ${escapeHtml(contact.primaryContact || contact.name)} (${escapeHtml(contact.name)}).`
    : `No contact found for ${escapeHtml(issue.client)}.`;

  body.innerHTML = `
    <form class="prj-form" id="alrEmailForm">
      <p class="bkp-sub">${note}</p>
      <label>To<input id="alrEmailTo" type="email" value="${escapeHtml(draft.to)}" placeholder="name@client.co.uk"></label>
      <label>Subject<input id="alrEmailSubject" value="${escapeHtml(draft.subject)}"></label>
      <label>Message<textarea id="alrEmailBody" rows="14">${escapeHtml(draft.body)}</textarea></label>
      <div class="prj-form-actions">
        <button type="button" class="btn btn-ghost" id="alrEmailCancel">Cancel</button>
        <button type="button" class="btn" id="alrEmailCopy">Copy text</button>
        <button type="submit" class="btn btn-primary">Open in Outlook</button>
      </div>
    </form>`;
  document.getElementById('alrEmailSubject')?.focus();
  document.getElementById('alrEmailCancel')?.addEventListener('click', closeModal);
  document.getElementById('alrEmailCopy')?.addEventListener('click', async () => {
    const text = `${document.getElementById('alrEmailSubject').value}\n\n${document.getElementById('alrEmailBody').value}`;
    try { await navigator.clipboard.writeText(text); toast('Email copied', 'success'); }
    catch { toast('Could not copy. Select the text and copy it instead', 'error'); }
  });
  document.getElementById('alrEmailForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const url = outlookComposeUrl({
      to: document.getElementById('alrEmailTo').value.trim(),
      subject: document.getElementById('alrEmailSubject').value,
      body: document.getElementById('alrEmailBody').value,
    });
    window.open(url, '_blank', 'noopener');
    closeModal();
  });
}

// ─── Resolve / undo ───────────────────────────────────────────────────

const setupMessage = () => `
  <div class="prj-form">
    <p><strong>Connect to the Gecko database</strong> to save resolved alerts.</p>
    <div class="prj-form-actions">
      <button type="button" class="btn btn-ghost" id="alrResolveCancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="alrRetryList">Connect</button>
    </div>
  </div>`;

function openModal(title, html) {
  const backdrop = document.getElementById('alrBackdrop');
  if (!backdrop) return false;
  focusBeforeModal = document.activeElement;
  document.getElementById('alrModalTitle').textContent = title;
  document.getElementById('alrModalBody').innerHTML = html;
  backdrop.removeAttribute('hidden');
  return true;
}

function openResolve(key) {
  const issue = ALR.issues?.find(i => i.key === key);
  if (!issue) return;
  if (ALR.resolutionsMissing) {
    openModal('Mark as resolved', setupMessage());
    document.getElementById('alrResolveCancel')?.addEventListener('click', closeModal);
    document.getElementById('alrRetryList')?.addEventListener('click', async () => {
      try { await connectSupabase({ interactive: true }); } catch (err) { toast(err?.message || 'Could not connect', 'error'); return; }
      await loadResolutions();
      if (ALR.resolutionsMissing) { toast('Still not connected to the database', 'error'); return; }
      retriage(); render(); openResolve(key);
    });
    return;
  }
  openModal('Mark as resolved', `
    <form class="prj-form" id="alrResolveForm">
      <p><strong>${escapeHtml(issue.client)}</strong> · ${escapeHtml(issue.device)}<br><span class="bkp-sub">${escapeHtml(issue.label)}</span></p>
      <label>What was done? (optional)<textarea id="alrResolveNote" rows="3" placeholder="e.g. Cleared 40 GB of temp files, D: now at 61%"></textarea></label>
      ${issue.resolveUrl ? `<p class="bkp-sub"><a href="${escapeHtml(issue.resolveUrl)}" target="_blank" rel="noopener noreferrer">Clear it in Atera too</a></p>` : ''}
      <div class="prj-form-actions">
        <button type="button" class="btn btn-ghost" id="alrResolveCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Mark resolved</button>
      </div>
    </form>`);
  document.getElementById('alrResolveNote')?.focus();
  document.getElementById('alrResolveCancel')?.addEventListener('click', closeModal);
  document.getElementById('alrResolveForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const sb = await connectSupabase({ interactive: true });
      must(await sb.from('alert_resolutions').insert({
        issue_key: issue.key, note: document.getElementById('alrResolveNote').value.trim(), resolved_by: senderName()
      }).select('id').single());
      await loadResolutions();
      retriage(); render(); closeModal();
      toast(`${issue.device} marked resolved`, 'success');
    } catch (err) {
      submit.disabled = false;
      toast(err?.message || 'Could not save', 'error');
    }
  });
}

async function undoResolve(key) {
  const r = ALR.resolutions.get(key);
  if (!r) return;
  try {
    const sb = await connectSupabase({ interactive: true });
    must(await sb.from('alert_resolutions').delete().eq('id', r.id).select('id').single());
    await loadResolutions();
    retriage(); render();
    toast('Back on the list', 'success');
  } catch (err) {
    toast(err?.message || 'Could not undo', 'error');
  }
}

// ─── Section lifecycle ────────────────────────────────────────────────

export function init() {
  try {
    const saved = Number(localStorage.getItem('gecko.alerts.days'));
    if (WINDOWS.includes(saved)) ALR.days = saved;
  } catch { /* storage blocked */ }

  document.getElementById('alrRefresh')?.addEventListener('click', refresh);
  document.querySelectorAll('#section-alerts [data-alr-days]').forEach(btn =>
    btn.addEventListener('click', () => {
      const days = Number(btn.dataset.alrDays);
      if (days === ALR.days) return;
      ALR.days = days;
      try { localStorage.setItem('gecko.alerts.days', String(days)); } catch { /* ignore */ }
      load();
    }));
  document.getElementById('alrShowNoise')?.addEventListener('change', event => {
    ALR.showNoise = event.target.checked;
    render();
  });
  document.getElementById('alrShowResolved')?.addEventListener('change', event => {
    ALR.showResolved = event.target.checked;
    render();
  });
  document.getElementById('alrSearch')?.addEventListener('input', event => {
    ALR.query = event.target.value.trim();
    render();
  });
  // The draft-email modal, added once. Reuses the Projects modal styles.
  const section = document.getElementById('section-alerts');
  if (section && !document.getElementById('alrBackdrop')) {
    section.insertAdjacentHTML('beforeend', `
      <div class="prj-backdrop" id="alrBackdrop" hidden>
        <div class="prj-modal alr-modal" role="dialog" aria-modal="true" aria-labelledby="alrModalTitle">
          <h3 id="alrModalTitle">Email the client</h3>
          <div id="alrModalBody"></div>
        </div>
      </div>`);
    document.getElementById('alrBackdrop').addEventListener('click', event => {
      if (event.target.id === 'alrBackdrop') closeModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.getElementById('alrBackdrop')?.hasAttribute('hidden')) closeModal();
    });
  }

  document.getElementById('alrBoard')?.addEventListener('click', event => {
    const emailBtn = event.target.closest?.('[data-alr-email]');
    if (emailBtn) { openEmail(emailBtn.dataset.alrEmail); return; }
    const resolveBtn = event.target.closest?.('[data-alr-resolve]');
    if (resolveBtn) { openResolve(resolveBtn.dataset.alrResolve); return; }
    const undoBtn = event.target.closest?.('[data-alr-undo]');
    if (undoBtn) { undoBtn.disabled = true; undoResolve(undoBtn.dataset.alrUndo); return; }
    if (event.target.closest?.('#alrRetry')) load();
    if (event.target.closest?.('#alrGrant')) {
      load({ interactive: true }).then(() => { if (!ALR.error) toast('Mailbox access granted', 'success'); });
    }
  });
  load();
}

export function refresh() {
  load();
}
