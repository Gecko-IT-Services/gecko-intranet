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

import { graphFetch } from '../core/graph.js';
import { toast, escapeHtml, syncTableLabels } from '../core/ui.js';

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
};

// ─── Parsing (pure) ───────────────────────────────────────────────────

const decode = s => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");

const htmlToLines = html => decode(String(html || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(div|p|tr|td|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ''))
  .split(/\r?\n/).map(l => l.trim()).filter(Boolean);

/**
 * One Atera email → one or more alert entries. A single email can carry
 * several devices (subject "Alert; Problem"), each block starting "Device:".
 * Works on the HTML body (keeps the Atera device link) and falls back to
 * plain text when that is all there is.
 */
export function parseAteraEmail(body) {
  const html = String(body || '');
  const parts = html.split(/Device:\s*/).slice(1);
  const out = [];
  for (const part of parts) {
    let device = '', client = '', deviceUrl = '';
    const linked = part.match(/^<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*\(([^<\n]*)\)/i);
    if (linked) {
      deviceUrl = decode(linked[1]);
      device = decode(linked[2].replace(/<[^>]+>/g, '')).trim();
      client = decode(linked[3]).trim();
    } else {
      // Plain text: "Karen's PC (Home) (Freeston Water Treatment)" — the client is the LAST bracket.
      const firstLine = decode(part.replace(/<[^>]+>/g, '')).split(/\r?\n/)[0].trim();
      const m = firstLine.match(/^(.*)\(([^()]*)\)\s*$/);
      if (m) { device = m[1].trim(); client = m[2].trim(); } else { device = firstLine; }
    }
    const lines = htmlToLines(part);
    const statusIdx = lines.findIndex(l => /^Status:/i.test(l));
    const status = statusIdx >= 0 ? lines[statusIdx].replace(/^Status:\s*/i, '').trim() : 'Problem';
    const message = (statusIdx >= 0 ? lines.slice(statusIdx + 1) : lines.slice(1))
      .find(l => !/^(Created at|Mark alert as resolved|_{3,})/i.test(l)) || '';
    out.push({ device: device || 'Unknown device', client: client || 'Unknown client', deviceUrl, status, message });
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

  if (kind === 'snmp') return { level: 'noise', why: 'Printer not answering SNMP; it is usually asleep' };

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
      return { level: 'noise', why: 'One-off backup agent stop, usually an Acronis update' };

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
      return { level: 'important', why: 'New type of alert, check it' };
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
 * Raw alert entries → triaged issues. One issue per client + device + kind
 * (+ drive / service). Repeats are counted, not listed.
 * Atera's "Resolved" emails, if switched on, close the issue.
 */
export function buildIssues(entries, now = new Date()) {
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
        dayset: new Set(), resolvedAt: null, link: e.link || '',
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
      if (c.state) is.state = c.state;
      if (typeof c.value === 'number') is.current = c.value;
    }
    if (typeof c.value === 'number' && c.value > is.peak) is.peak = c.value;
    if (e.deviceUrl) is.deviceUrl = e.deviceUrl;
  }

  const RANK = { critical: 0, important: 1, noise: 2 };
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
    issues.push(is);
  }
  issues.sort((a, b) => RANK[a.level] - RANK[b.level] || b.last - a.last);
  return issues;
}

export function summarise(issues, alertCount) {
  const s = { critical: 0, important: 0, noise: 0, alerts: alertCount, noiseAlerts: 0 };
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
    const { entries, capped } = await fetchEntries(ALR.days, { interactive });
    if (seq !== loadSeq) return;
    const alerts = entries.filter(e => !/^resolved$/i.test(e.status)).length;
    ALR.issues = buildIssues(entries);
    ALR.stats = summarise(ALR.issues, alerts);
    ALR.capped = capped;
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

function setBusy(busy) {
  const btn = document.getElementById('alrRefresh');
  if (btn) { btn.disabled = busy; btn.classList.toggle('spinning', busy); }
}

// ─── Render ───────────────────────────────────────────────────────────

const fmtWhen = d => d.toLocaleString('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
});
const BADGE = { critical: 'badge-red', important: 'badge-amber', noise: 'badge-blue' };
const LEVEL = { critical: 'Act today', important: 'This week', noise: 'Filtered' };

const consentMessage = () => `
  <div class="bkp-error">
    <strong>The portal needs permission to read the support mailbox.</strong>
    This section reads Atera alert emails in ${escapeHtml(MAILBOX)}.
    <button type="button" id="alrGrant">Grant mailbox access</button>
  </div>`;

const noAccessMessage = () => `
  <div class="bkp-error">
    <strong>Your account can't open ${escapeHtml(MAILBOX)}.</strong>
    Give your user Full Access to the support mailbox in the Exchange admin
    centre, then press Refresh.
  </div>`;

export function renderKpis(stats) {
  const v = k => stats ? stats[k] : '–';
  const tile = (val, label, color) => `
    <div class="bkp-kpi alr-kpi"><span class="bkp-kpi-val" style="color:var(${color})">${val}</span><span class="bkp-kpi-lbl">${label}</span></div>`;
  return tile(v('critical'), 'Act today', '--red')
       + tile(v('important'), 'This week', '--amber')
       + tile(v('noise'), 'Filtered issues', '--muted')
       + tile(v('alerts'), 'Alert emails read', '--white');
}

export function renderIssue(is) {
  const seen = is.count > 1
    ? `${is.count} alerts over ${is.days} day${is.days === 1 ? '' : 's'}`
    : '1 alert';
  return `
    <tr class="alr-row alr-${is.level}">
      <td><span class="badge ${BADGE[is.level]}">${LEVEL[is.level]}</span></td>
      <td class="bkp-what"><strong>${escapeHtml(is.client)}</strong>
        <span class="bkp-sub">${is.deviceUrl
          ? `<a href="${escapeHtml(is.deviceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(is.device)}</a>`
          : escapeHtml(is.device)}</span></td>
      <td class="bkp-what"><strong>${escapeHtml(is.label)}</strong>
        <span class="bkp-sub">${escapeHtml(is.why)}</span></td>
      <td class="bkp-mono">${escapeHtml(seen)}<span class="bkp-sub">first ${escapeHtml(fmtWhen(is.first))}</span></td>
      <td class="bkp-mono">${escapeHtml(fmtWhen(is.last))}${is.quiet ? '<span class="bkp-sub">quiet since</span>' : ''}</td>
      <td>${is.link ? `<a href="${escapeHtml(is.link)}" target="_blank" rel="noopener noreferrer">Email</a>` : ''}</td>
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

  if (ALR.loading && !ALR.issues) { mount.innerHTML = '<p class="bkp-empty">Reading Atera alerts from the support mailbox…</p>'; return; }
  if (ALR.error === 'CONSENT')   { mount.innerHTML = consentMessage(); return; }
  if (ALR.error === 'NO_ACCESS') { mount.innerHTML = noAccessMessage(); return; }
  if (ALR.error) {
    mount.innerHTML = `<div class="bkp-error"><strong>Could not load Atera alerts.</strong>${escapeHtml(ALR.error)}<button type="button" id="alrRetry">Retry</button></div>`;
    return;
  }
  if (!ALR.issues) return;

  const q = ALR.query.toLowerCase();
  const match = is => !q || `${is.client} ${is.device} ${is.label}`.toLowerCase().includes(q);
  const actionable = ALR.issues.filter(i => i.level !== 'noise' && match(i));
  const noise = ALR.issues.filter(i => i.level === 'noise' && match(i));

  const main = actionable.length
    ? table(actionable.map(renderIssue).join(''))
    : `<p class="bkp-empty"><strong>Nothing needs attention.</strong> ${ALR.stats.alerts} alert emails in the last ${ALR.days} days, all filtered as noise.</p>`;

  const noisePart = ALR.showNoise && noise.length
    ? `<h3 class="alr-h">Filtered (${noise.length} issues, ${ALR.stats.noiseAlerts} emails)</h3>${table(noise.map(renderIssue).join(''))}`
    : '';

  mount.innerHTML = `
    ${ALR.capped ? `<p class="bkp-note">Showing the newest ${SAFETY_LIMIT.toLocaleString('en-GB')} emails. Pick a shorter window for the full picture.</p>` : ''}
    ${main}
    ${noisePart}
    <p class="bkp-foot">Repeats are folded into one row per device and problem. Atera doesn't email when an alert clears, so anything quiet for ${QUIET_DAYS}+ days drops to Filtered unless it's critical. Turn on "Resolved" emails in Atera to close issues for certain.</p>`;
  syncTableLabels(mount);
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
  document.getElementById('alrSearch')?.addEventListener('input', event => {
    ALR.query = event.target.value.trim();
    render();
  });
  document.getElementById('alrBoard')?.addEventListener('click', event => {
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
