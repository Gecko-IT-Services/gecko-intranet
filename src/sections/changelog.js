/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   CHANGE LOG (Settings › Change log, and the dot on Settings)       ║
   ║                                                                     ║
   ║   What has been merged into the app and by whom, read from the      ║
   ║   public repository's merged pull requests. Not a page: a card on   ║
   ║   Settings (#setChangelog), drawn when Settings opens, and a dot    ║
   ║   on the sidebar's Settings link when the other person has merged   ║
   ║   something since you last looked.                                  ║
   ║   Logic: src/core/changelog.js. Design:                             ║
   ║   docs/superpowers/specs/2026-10-12-change-log-design.md            ║
   ║   NOTE: no top-level `window` access (importable under Node).       ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { escapeHtml } from '../core/ui.js';
import { PEOPLE, personOf } from '../core/tasks.js';
import { FRESH_MS, ALL_URL, fetchEntries, byDay, dayLabel, localDay, unseen } from '../core/changelog.js';

const CACHE_KEY = 'gecko.changelog';        // { at, entries }: the last answer, so a reload does not ask GitHub again
const SEEN_KEY = 'gecko.changelog.seen';    // when this browser last had the list open (ponytail: per device, not per person)

const CL = { entries: null, at: 0, error: '', who: 'everyone', since: '', loading: null };

const me = () => personOf(document.getElementById('userName')?.textContent);
const box = () => document.getElementById('setChangelog');

function readSeen() {
  try {
    let at = localStorage.getItem(SEEN_KEY);
    // First time on this device: everything up to now counts as seen, so the whole history is not "new".
    if (!at) localStorage.setItem(SEEN_KEY, at = new Date().toISOString());
    return at;
  } catch { return ''; }
}
function markSeen() { try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* storage blocked: no dot */ } }

/** The list, from this session, the browser's copy, or GitHub when that is older than FRESH_MS. Never throws. */
function load(force = false) {
  if (!CL.entries) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (Array.isArray(c?.entries)) { CL.entries = c.entries; CL.at = Number(c.at) || 0; }
    } catch { /* no copy kept */ }
  }
  if (!force && CL.entries && Date.now() - CL.at < FRESH_MS) return Promise.resolve();
  CL.loading ??= fetchEntries()
    .then(entries => {
      CL.entries = entries; CL.at = Date.now(); CL.error = '';
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: CL.at, entries })); } catch { /* storage blocked */ }
    })
    .catch(err => { console.error('Change log not read:', err); CL.error = err.message || String(err); })
    .finally(() => { CL.loading = null; });
  return CL.loading;
}

function dot() {
  const link = document.querySelector('.sb-link[data-section="settings"]');
  if (!link) return;
  const n = unseen(CL.entries || [], me(), readSeen()).length;
  link.classList.toggle('has-news', n > 0);
  if (n) link.title = `${n} change${n === 1 ? '' : 's'} by ${PEOPLE.find(p => p !== me()) || 'someone else'} since you last looked`;
  else link.removeAttribute('title');
}

/** Is there anything new for the sidebar's dot? Called at sign-in and on coming back to the tab. */
export async function check() {
  await load();
  dot();
}

function draw() {
  const el = box();
  if (!el) return;
  const filter = `<div class="chg-filter" role="group" aria-label="Whose changes">${['everyone', ...PEOPLE].map(w =>
    `<button class="set-seg-btn${CL.who === w ? ' active' : ''}" type="button" data-chg="who" data-who="${w}" aria-pressed="${CL.who === w}">${w === 'everyone' ? 'Everyone' : w}</button>`).join('')}</div>`;
  const head = `<div class="set-card-head chg-head"><h3>Change log</h3>${CL.entries?.length ? filter : ''}</div>`;

  if (!CL.entries) {
    el.innerHTML = head + (CL.error
      ? `<div class="chg-body"><div class="state-error"><strong>The change log didn’t load.</strong><p>${escapeHtml(CL.error)}</p><button type="button" class="btn btn-sm" data-chg="refresh">Try again</button></div></div>`
      : '<div class="chg-body"><p class="chg-note">Reading the change log…</p></div>');
    return;
  }
  const fresh = new Set(unseen(CL.entries, me(), CL.since).map(e => e.number));
  const shown = CL.who === 'everyone' ? CL.entries : CL.entries.filter(e => e.who === CL.who);
  const today = localDay(new Date());
  const days = byDay(shown).map(d => `<h4 class="chg-day">${escapeHtml(dayLabel(d.day, today))}</h4><ul class="chg-list">${d.entries.map(e => {
    const person = PEOPLE.includes(e.who);
    const who = `<b class="tk-who${person ? ' lp-' + e.who.toLowerCase() : ''}" title="${escapeHtml(e.who)}">${escapeHtml((e.who || '?')[0])}</b>`;
    const title = `<span class="chg-title">${escapeHtml(e.title)}</span>${fresh.has(e.number) ? '<span class="badge badge-green">New</span>' : ''}`;
    return `<li>${e.url
      ? `<a class="chg-row" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${who}${title}</a>`
      : `<span class="chg-row">${who}${title}</span>`}</li>`;
  }).join('')}</ul>`).join('');
  const none = CL.entries.length
    ? `<p class="chg-note">Nothing from ${escapeHtml(CL.who)} in the last ${CL.entries.length} changes.</p>`
    : '<p class="chg-note">Nothing has been merged yet.</p>';
  const checked = new Date(CL.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = head + `<div class="chg-body">${days || none}</div>
    <div class="chg-foot">
      <span${CL.error ? ' class="chg-stale"' : ''}>${CL.error ? `Not refreshed: ${escapeHtml(CL.error)} Showing ${checked}.` : `Checked ${checked}`}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-chg="refresh">Check now</button>
      <a class="chg-all" href="${ALL_URL}" target="_blank" rel="noopener">Every change on GitHub</a>
    </div>`;
}

/** Settings has been opened: draw what is known, refresh if it is old, and count the list as looked at. */
export async function render() {
  CL.since = readSeen();
  draw();
  await load();
  draw();
  if (CL.entries && document.getElementById('section-settings')?.classList.contains('active')) markSeen();
  dot();
}

async function onClick(e) {
  const el = e.target.closest?.('#setChangelog [data-chg]');
  if (!el) return;
  if (el.dataset.chg === 'who') { CL.who = el.dataset.who; draw(); return; }
  if (el.dataset.chg === 'refresh') {
    el.disabled = true;
    await load(true);
    draw();
    dot();
  }
}

let started = false;
export function init() {
  if (started) return;
  started = true;
  document.getElementById('app')?.addEventListener('click', onClick);
  // Left open all day, the dot would miss what the other person merged since: ask again on coming back.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  check();
}
