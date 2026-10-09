/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   BACKUPS BOARD                                                   ║
   ║                                                                   ║
   ║   Reads the Acronis job emails that land in the shared            ║
   ║   support@gecko-it.com mailbox and shows the latest result for    ║
   ║   every backup job: succeeded, succeeded with warnings, failed.   ║
   ║                                                                   ║
   ║   Read-only. Nothing is written to the mailbox or to SharePoint.  ║
   ║                                                                   ║
   ║   Data source: Graph /users/{mailbox}/messages, filtered to the   ║
   ║   Acronis sender. Needs the delegated Mail.Read.Shared scope,     ║
   ║   requested by this section alone (incremental consent) so the   ║
   ║   rest of the portal's sign-in is untouched. See                  ║
   ║   docs/superpowers/specs/2026-10-06-backups-board-design.md.      ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access in this file. tests/         ║
   ║   backups-board.mjs imports it under Node. Registration into      ║
   ║   window.GeckoSections lives in src/main.js.                      ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { graphFetch } from '../core/graph.js';
import { toast, escapeHtml, syncTableLabels } from '../core/ui.js';

export const MAILBOX       = 'support@gecko-it.com';
export const SENDER        = 'noreply-abc@cloud.acronis.com';
export const MAIL_SCOPES   = ['Mail.Read.Shared'];
export const WINDOWS       = [24, 48, 168];     // hours offered in the picker
const PAGE_SIZE            = 100;
const SAFETY_LIMIT         = 3000;              // ~4 weeks of Acronis mail at today's volume

/** Module state. Populated by load(), read by render(). */
const BKP = {
  hours:   24,
  filter:  'all',      // 'all' | 'ok' | 'warn' | 'fail'
  query:   '',
  board:   null,       // result of buildBoard()
  capped:  false,
  loading: false,
  error:   null,       // null | 'CONSENT' | 'NO_ACCESS' | string
  syncedAt: null,
};

// ─── Pure helpers (unit-tested in tests/backups-board.mjs) ────────────

export const STATUS_LABEL = { ok: 'Succeeded', warn: 'Warnings', fail: 'Failed' };
const RANK = { ok: 0, warn: 1, fail: 2 };

/** "Gecko IT Services (#0191292) > Daron Ford Motors" → "Daron Ford Motors". */
export function cleanGroup(group) {
  const g = String(group || '').trim();
  return (g.includes('>') ? g.slice(g.lastIndexOf('>') + 1) : g).trim() || 'Unknown';
}

// One level of nested brackets is enough: plan names look like
// "SharePoint sites to Cloud storage (4)" or "Bobs Backup (14/04/26)".
const PART_RE = /\((group|resource|machine|plan|backup account): ((?:[^()]|\([^()]*\))*)\)/gi;

/**
 * Turn an Acronis job subject into a job result, or null if it is not one.
 *   BACKUP SUCCEEDED (group: X)(resource: Y)(plan: Z)
 *   BACKUP SUCCEEDED WITH WARNINGS  (group: X)(resource: Y)(plan: Z)
 *   BACKUP FAILED (group: A > X)(backup account: a)(machine: M)(plan: P)
 * Anything that says BACKUP but is neither success nor failure counts as a
 * warning, so an unfamiliar subject is surfaced rather than dropped.
 */
export function parseJobSubject(subject) {
  const s = String(subject || '').trim();
  const head = s.match(/^BACKUP ([A-Z ]+?)\s*\(/i);
  if (!head) return null;
  const word = head[1].toUpperCase();
  const status = word.includes('FAIL') ? 'fail'
               : word.includes('WARN') ? 'warn'
               : word.includes('SUCCEED') ? 'ok'
               : 'warn';
  const parts = {};
  for (const m of s.matchAll(PART_RE)) parts[m[1].toLowerCase()] = m[2].trim();
  return {
    status,
    group:     cleanGroup(parts.group),
    what:      parts.resource || parts.machine || 'Unknown',
    isMachine: !parts.resource && !!parts.machine,
    plan:      parts.plan || '',
  };
}

/** DAILY STATUS REPORT ON … (group: X) (Critical: n, Error: n, Warning: n, Information: n) */
export function parseReportSubject(subject) {
  const m = String(subject || '').match(
    /^DAILY STATUS REPORT ON .+? \(group: ((?:[^()]|\([^()]*\))*)\) \(Critical: (\d+), Error: (\d+), Warning: (\d+), Information: (\d+)\)/i
  );
  if (!m) return null;
  return { group: cleanGroup(m[1]), critical: +m[2], error: +m[3], warning: +m[4] };
}

/** First useful line after "Backup failed" / "succeeded with warnings" in the preview. */
export function failureReason(preview, what) {
  const lines = String(preview || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const i = lines.findIndex(l => /^Backup (failed|succeeded with warnings)/i.test(l));
  if (i < 0) return '';
  for (let k = i + 1; k < lines.length && k <= i + 3; k++) {
    const l = lines[k];
    if (l && l !== what && l !== '.' && !/^show details$/i.test(l)) return l;
  }
  return '';
}

/** Headline of the first alert in a daily report preview, e.g. "Machine is offline for more than 30 days". */
export function reportHeadline(preview) {
  const lines = String(preview || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const i = lines.findIndex(l => /^(Critical|Error|Warning)$/.test(l));
  if (i < 0) return { title: '', detail: '' };
  const detail = lines[i + 3] && !/^Device$/.test(lines[i + 3]) ? lines[i + 3] : '';
  return { title: lines[i + 1] || '', detail };
}

/**
 * Messages → board. Each job (client + resource/machine + plan) shows its
 * latest result in the window; earlier runs are tallied. Daily reports keep
 * only the latest per client, and only when something is still active.
 */
export function buildBoard(messages) {
  const jobs = new Map();
  const reports = new Map();
  for (const msg of messages || []) {
    const when = new Date(msg.receivedDateTime);
    if (Number.isNaN(when.getTime())) continue;
    const report = parseReportSubject(msg.subject);
    if (report) {
      const prev = reports.get(report.group);
      if (!prev || when > prev.when) {
        reports.set(report.group, { ...report, when, ...reportHeadline(msg.bodyPreview), link: msg.webLink || '' });
      }
      continue;
    }
    const job = parseJobSubject(msg.subject);
    if (!job) continue;
    const run = { status: job.status, when, reason: job.status === 'ok' ? '' : failureReason(msg.bodyPreview, job.what), link: msg.webLink || '' };
    const key = `${job.group}|${job.what}|${job.plan}`;
    let entry = jobs.get(key);
    if (!entry) {
      entry = { group: job.group, what: job.what, isMachine: job.isMachine, plan: job.plan, latest: run, runs: { ok: 0, warn: 0, fail: 0 } };
      jobs.set(key, entry);
    }
    entry.runs[job.status]++;
    if (when > entry.latest.when) entry.latest = run;
  }

  const clients = new Map();
  for (const job of jobs.values()) {
    let c = clients.get(job.group);
    if (!c) { c = { name: job.group, jobs: [], counts: { ok: 0, warn: 0, fail: 0 }, last: null }; clients.set(job.group, c); }
    c.jobs.push(job);
    c.counts[job.latest.status]++;
    if (!c.last || job.latest.when > c.last) c.last = job.latest.when;
  }
  for (const c of clients.values()) {
    c.worst = c.counts.fail ? 'fail' : c.counts.warn ? 'warn' : 'ok';
    c.jobs.sort((a, b) => RANK[b.latest.status] - RANK[a.latest.status] || a.what.localeCompare(b.what));
  }

  const totals = { ok: 0, warn: 0, fail: 0 };
  for (const job of jobs.values()) totals[job.latest.status]++;

  return {
    totals,
    jobCount: jobs.size,
    clients: [...clients.values()].sort((a, b) => RANK[b.worst] - RANK[a.worst] || a.name.localeCompare(b.name)),
    alerts: [...reports.values()]
      .filter(r => r.critical + r.error + r.warning > 0)
      .sort((a, b) => (b.critical * 100 + b.error * 10 + b.warning) - (a.critical * 100 + a.error * 10 + a.warning)),
  };
}

/** Graph path for the first page of the window. */
export function messagesPath(hours, now = new Date()) {
  const since = new Date(now.getTime() - hours * 3600000).toISOString();
  // receivedDateTime leads both $filter and $orderby, which Graph requires
  // when the two are combined on /messages.
  const filter = `receivedDateTime ge ${since} and from/emailAddress/address eq '${SENDER}'`;
  return `/users/${encodeURIComponent(MAILBOX)}/messages`
    + `?$filter=${encodeURIComponent(filter)}`
    + `&$orderby=${encodeURIComponent('receivedDateTime desc')}`
    + `&$select=subject,receivedDateTime,bodyPreview,webLink`
    + `&$top=${PAGE_SIZE}`;
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchMessages(hours, { interactive = false } = {}) {
  const out = [];
  let next = messagesPath(hours);
  let capped = false;
  while (next) {
    const res = await graphFetch(next, { scopes: MAIL_SCOPES, interactive });
    out.push(...(res?.value || []));
    next = res?.['@odata.nextLink'] || null;
    if (out.length >= SAFETY_LIMIT) { capped = !!next; break; }
  }
  return { messages: out, capped };
}

let loadSeq = 0;   // a later load always wins; an older one must not clobber it

/** Load and render. Sets BKP.error rather than throwing. */
async function load({ interactive = false } = {}) {
  const seq = ++loadSeq;
  BKP.loading = true;
  BKP.error = null;
  setBusy(true);
  render();
  try {
    const { messages, capped } = await fetchMessages(BKP.hours, { interactive });
    if (seq !== loadSeq) return;
    BKP.board = buildBoard(messages);
    BKP.capped = capped;
    BKP.syncedAt = new Date();
    const stamp = document.getElementById('bkpLastSync');
    if (stamp) stamp.textContent = 'Synced ' + BKP.syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    if (seq !== loadSeq) return;
    const msg = err?.message || 'Load failed';
    BKP.error = err?.code === 'CONSENT_REQUIRED' ? 'CONSENT'
              : /Graph 403|ErrorAccessDenied|Access is denied/i.test(msg) ? 'NO_ACCESS'
              : msg;
  } finally {
    if (seq === loadSeq) {
      BKP.loading = false;
      setBusy(false);
      render();
    }
  }
}

function setBusy(busy) {
  const btn = document.getElementById('bkpRefresh');
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('spinning', busy);
  if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

// ─── Render ───────────────────────────────────────────────────────────

const fmtWhen = d => d.toLocaleString('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
});
const BADGE = { ok: 'badge-green', warn: 'badge-amber', fail: 'badge-red' };

// Functions, not constants: escapeHtml resolves through window, which does
// not exist when this module is evaluated under Node.
const consentMessage = () => `
  <div class="bkp-error">
    <strong>No permission to read ${escapeHtml(MAILBOX)}.</strong>
    Needs Mail.Read.Shared on the app in Entra.
    <button type="button" class="btn btn-sm btn-primary" id="bkpGrant">Grant mailbox access</button>
  </div>`;

const noAccessMessage = () => `
  <div class="bkp-error">
    <strong>Your account can't open ${escapeHtml(MAILBOX)}.</strong>
    Needs Full Access in Exchange admin (can take an hour).
  </div>`;

export function renderKpis(board, filter) {
  const t = board ? board.totals : { ok: '–', warn: '–', fail: '–' };
  const tile = (key, val, label, tone) => `
    <button type="button" class="bkp-kpi" data-bkp-filter="${key}" aria-pressed="${String(filter === key)}">
      <span class="bkp-kpi-val${tone ? ` is-${tone}` : ''}">${val}</span><span class="bkp-kpi-lbl">${label}</span>
    </button>`;
  return tile('all', board ? board.jobCount : '–', 'Jobs reporting', '')
       + tile('ok', t.ok, 'Succeeded', 'ok')
       + tile('warn', t.warn, 'With warnings', 'warn')
       + tile('fail', t.fail, 'Failed', 'fail');
}

export function renderAlerts(alerts) {
  if (!alerts?.length) return '';
  const rows = alerts.map(a => {
    const counts = [a.critical && `${a.critical} critical`, a.error && `${a.error} error`, a.warning && `${a.warning} warning`]
      .filter(Boolean).join(', ');
    const cls = a.critical || a.error ? 'badge-red' : 'badge-amber';
    return `
      <li class="bkp-alert">
        <span class="badge ${cls}">${escapeHtml(counts)}</span>
        <div class="bkp-alert-body">
          <strong>${escapeHtml(a.group)}</strong> · ${escapeHtml(a.title || 'See report')}
          ${a.detail ? `<span class="bkp-alert-detail">${escapeHtml(a.detail)}</span>` : ''}
          <span class="bkp-sub">${escapeHtml(fmtWhen(a.when))}${a.link ? ` · <a href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer">Open report</a>` : ''}</span>
        </div>
      </li>`;
  }).join('');
  return `
    <section class="bkp-card bkp-alerts">
      <h3>Active alerts</h3>
      <ul>${rows}</ul>
    </section>`;
}

export function renderClient(client, { filter = 'all', query = '' } = {}) {
  const q = query.toLowerCase();
  const jobs = client.jobs.filter(j =>
    (filter === 'all' || j.latest.status === filter) &&
    (!q || `${client.name} ${j.what} ${j.plan}`.toLowerCase().includes(q))
  );
  if (!jobs.length) return '';
  const open = client.worst !== 'ok' || !!q || filter !== 'all';
  const count = k => `<span class="bkp-count bkp-count-${k}${client.counts[k] ? '' : ' is-zero'}" title="${STATUS_LABEL[k]}">${client.counts[k]}</span>`;
  const rows = jobs.map(j => {
    const total = j.runs.ok + j.runs.warn + j.runs.fail;
    const hist = total > 1
      ? `${total} runs · ${j.runs.ok} ok${j.runs.warn ? ` · ${j.runs.warn} warn` : ''}${j.runs.fail ? ` · ${j.runs.fail} failed` : ''}`
      : '1 run';
    return `
      <tr>
        <td><span class="badge ${BADGE[j.latest.status]}">${STATUS_LABEL[j.latest.status]}</span></td>
        <td class="bkp-what"><strong>${escapeHtml(j.what)}</strong>
          <span class="bkp-sub">${escapeHtml(j.plan)}${j.isMachine ? ' · device' : ''}</span>
          ${j.latest.reason ? `<span class="bkp-reason">${escapeHtml(j.latest.reason)}</span>` : ''}</td>
        <td class="bkp-mono">${escapeHtml(fmtWhen(j.latest.when))}</td>
        <td class="bkp-mono">${escapeHtml(hist)}</td>
        <td>${j.latest.link ? `<a href="${escapeHtml(j.latest.link)}" target="_blank" rel="noopener noreferrer">Email</a>` : ''}</td>
      </tr>`;
  }).join('');
  return `
    <details class="bkp-client bkp-client-${client.worst}"${open ? ' open' : ''}>
      <summary>
        <span class="bkp-dot" role="img" aria-label="${STATUS_LABEL[client.worst]}"></span>
        <span class="bkp-client-name">${escapeHtml(client.name)}
          <span class="bkp-sub">${client.jobs.length} job${client.jobs.length === 1 ? '' : 's'} · last email ${escapeHtml(fmtWhen(client.last))}</span></span>
        <span class="bkp-counts">${count('ok')}${count('warn')}${count('fail')}</span>
      </summary>
      <div class="bkp-tbl-wrap">
        <table>
          <thead><tr><th>Status</th><th>Backup</th><th>Latest</th><th>In window</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
}

function render() {
  const mount = document.getElementById('bkpBoard');
  if (!mount) return;

  document.querySelectorAll('#section-backups [data-bkp-hours]').forEach(b =>
    b.setAttribute('aria-pressed', String(+b.dataset.bkpHours === BKP.hours)));
  const kpis = document.getElementById('bkpKpis');
  if (kpis) kpis.innerHTML = renderKpis(BKP.error ? null : BKP.board, BKP.filter);

  if (BKP.loading && !BKP.board) {
    mount.innerHTML = '<p class="bkp-empty art art-loading">Loading backups…</p>';
    return;
  }
  if (BKP.error === 'CONSENT') { mount.innerHTML = consentMessage(); return; }
  if (BKP.error === 'NO_ACCESS') { mount.innerHTML = noAccessMessage(); return; }
  if (BKP.error) {
    mount.innerHTML = `
      <div class="bkp-error art art-offline">
        <strong>Could not load backup emails.</strong>
        ${escapeHtml(BKP.error)}
        <button type="button" class="btn btn-sm" id="bkpRetry">Retry</button>
      </div>`;
    return;
  }
  if (!BKP.board) return;

  const clients = BKP.board.clients
    .map(c => renderClient(c, { filter: BKP.filter, query: BKP.query }))
    .join('');
  const empty = BKP.board.jobCount
    ? '<p class="bkp-empty art art-none">No matches.</p>'
    : '<p class="bkp-empty art art-empty">No backup emails in this window.</p>';

  mount.innerHTML = `
    ${BKP.capped ? `<p class="bkp-note">Newest ${SAFETY_LIMIT.toLocaleString('en-GB')} emails only. Pick a shorter window.</p>` : ''}
    ${renderAlerts(BKP.board.alerts)}
    <div class="bkp-clients">${clients || empty}</div>`;
  syncTableLabels(mount);
}

// ─── Section lifecycle ────────────────────────────────────────────────

/** Called once, by navTo, on first visit to the section. */
export function init() {
  try {
    const saved = Number(localStorage.getItem('gecko.backups.hours'));
    if (WINDOWS.includes(saved)) BKP.hours = saved;
  } catch { /* storage blocked: keep the default */ }

  document.getElementById('bkpRefresh')?.addEventListener('click', refresh);
  document.querySelectorAll('#section-backups [data-bkp-hours]').forEach(btn =>
    btn.addEventListener('click', () => {
      const hours = Number(btn.dataset.bkpHours);
      if (hours === BKP.hours) return;
      BKP.hours = hours;
      try { localStorage.setItem('gecko.backups.hours', String(hours)); } catch { /* ignore */ }
      load();
    }));
  document.getElementById('bkpKpis')?.addEventListener('click', event => {
    const tile = event.target.closest?.('[data-bkp-filter]');
    if (!tile) return;
    BKP.filter = tile.dataset.bkpFilter;
    render();
  });
  document.getElementById('bkpSearch')?.addEventListener('input', event => {
    BKP.query = event.target.value.trim();
    render();
  });
  // Delegated once: #bkpBoard survives every render.
  document.getElementById('bkpBoard')?.addEventListener('click', event => {
    if (event.target.closest?.('#bkpRetry')) load();
    if (event.target.closest?.('#bkpGrant')) {
      // A user tap, so the consent popup is allowed to open.
      load({ interactive: true }).then(() => {
        if (!BKP.error) toast('Mailbox access granted', 'success');
      });
    }
  });
  load();
}

const mailError = err => {
  const msg = err?.message || 'Load failed';
  return err?.code === 'CONSENT_REQUIRED' ? 'CONSENT' : /Graph 403|ErrorAccessDenied|Access is denied/i.test(msg) ? 'NO_ACCESS' : msg;
};

/**
 * The morning check (Overview › Today): every backup job's latest result in the last `hours`,
 * read the same way as this section, without touching its state. Never throws:
 * { ok, totals, jobCount, failing, warnings, capped } or { ok: false, error: 'CONSENT' | 'NO_ACCESS' | message }.
 */
export async function snapshot({ hours = 24, interactive = false } = {}) {
  try {
    const { messages, capped } = await fetchMessages(hours, { interactive });
    const board = buildBoard(messages);
    const jobs = board.clients.flatMap(c => c.jobs.map(j => ({
      client: c.name, what: j.what, plan: j.plan, status: j.latest.status, reason: j.latest.reason, when: j.latest.when, link: j.latest.link
    })));
    return { ok: true, totals: board.totals, jobCount: board.jobCount, capped,
      failing: jobs.filter(j => j.status === 'fail'), warnings: jobs.filter(j => j.status === 'warn') };
  } catch (err) {
    return { ok: false, error: mailError(err) };
  }
}

/** Called by the section's Refresh button. */
export function refresh() {
  load();
}
