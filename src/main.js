/**
 * Module entry point.
 *
 * Sections built as ES modules register themselves here; navTo() in
 * index.html dispatches to them. This is the only file that touches
 * `window` at module scope, which keeps every section module importable
 * under Node for testing.
 *
 * The contract is `{ init }` — nothing more. navTo() calls init() once, on
 * first visit; everything else a section needs (its Refresh button, its
 * modal) it wires up itself from inside init().
 *
 * Adding an extracted section later is two lines: import it, register it.
 */
import * as projects from './sections/projects.js';
import * as backups from './sections/backups.js';
import * as alerts from './sections/alerts.js';
import * as opportunities from './sections/opportunities.js';
import * as jobs from './sections/jobs.js';
import * as overview from './sections/overview.js';
import * as client from './sections/client.js';
import * as team from './sections/team.js';
import { sameClient } from './core/client.js';
import * as tabs from './core/tabs.js';
import * as overviewCore from './core/overview.js';
import * as review from './core/review.js';
import * as cspCosts from './core/csp-costs.js';
import * as profitFeed from './core/profit-feed.js';
import * as ssaRenewal from './core/ssa-renewal.js';
import * as supabase from './core/supabase.js';
import * as store from './core/store.js';
import * as timesheets from './core/timesheets.js';
import * as timelog from './core/timelog.js';
import * as ssa from './core/ssa.js';
import * as weekly from './core/weekly.js';

window.GeckoSections = window.GeckoSections || {};
window.GeckoSections.projects = { init: projects.init };
window.GeckoSections.backups  = { init: backups.init };
window.GeckoSections.alerts   = { init: alerts.init };
window.GeckoSections.opportunities = { init: opportunities.init, show: opportunities.show, reload: opportunities.reload };
window.GeckoSections.jobs = { init: jobs.init, show: jobs.show };
window.GeckoSections.team = { init: team.init };
window.GeckoSections.client = { init: client.init, open: client.open, current: client.current };
// Overview › Today reads the last day of backups and alerts through these (support@ mailbox).
window.GeckoMonitor = { backups: backups.snapshot, alerts: alerts.snapshot };
// Same client under different names (Xero, Clients, SSA): Timesheets' Log time from a client page.
window.GeckoClientMatch = sameClient;
// The shared tab strip (the shell's hub strip uses it too).
window.GeckoTabs = tabs;

// Pure logic used by the Profitability section, which still lives in
// index.html's classic script and therefore cannot import modules itself.
window.CspCosts = cspCosts;
window.ProfitFeed = profitFeed;
// Timesheets › SSA › Renew (also classic script).
window.SsaRenewal = ssaRenewal;
// Supabase session is dropped on Microsoft sign-out (classic script calls this).
window.forgetSupabaseSession = supabase.forgetSupabaseSession;
// Database store for classic-script sections moving off SharePoint (Leave first).
window.GeckoStore = { ...store, connect: supabase.connectSupabase, completeRedirect: supabase.completeRedirect };
// Overview (classic script): database reads and the pure logic behind its tiles and list.
window.GeckoOverview = { ...overviewCore, loadDb: overview.loadDb, tick: overview.tick, review };
// Timesheets + SSA balances on the database, SharePoint kept as the backup (classic script).
window.GeckoTimesheets = timesheets;
// Timesheets › Log Time: reading typed time, the SSA preview and the checks before saving.
window.GeckoTimelog = timelog;
// Timesheets › SSA Dashboard: use per month, run-out dates and what needs renewing.
window.GeckoSsa = ssa;
// Timesheets › Weekly Summary: one week of work, by day, client and type, with an eight-week trend.
window.GeckoWeekly = weekly;

// Back from Xero's consent screen (supabase/functions/xero-callback): keep the result for the
// Jobs section, tidy the address bar, and open Jobs once the portal is signed in.
if (location.hash.startsWith('#xero=')) {
  const p = new URLSearchParams(location.hash.slice(1));
  try { sessionStorage.setItem('gecko.xeroResult', JSON.stringify({ result: p.get('xero'), detail: p.get('detail') || '' })); } catch { /* storage blocked */ }
  history.replaceState(null, '', location.pathname + location.search);
  let tries = 0;
  const open = setInterval(() => {
    const name = (document.getElementById('userName')?.textContent || '').trim();
    const signedIn = name && name !== 'Not signed in';
    if ((signedIn && typeof window.navTo === 'function') || ++tries > 120) {
      clearInterval(open);
      if (signedIn) window.navTo('jobs');
    }
  }, 500);
}

// Data arriving: whatever replaces a "Loading…"/"Checking…" placeholder fades and lifts in (first few
// staggered), so a page settles rather than snapping. Re-renders (filters, typing) aren't touched.
const isPlaceholder = n => (n.nodeType === 1 || n.nodeType === 3) && /^(Loading|Checking)\b/.test(n.textContent.trim());
const arrive = (el, i = 0) => el.animate(
  [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
  { duration: 260, delay: Math.min(i, 8) * 30, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'backwards' });
new MutationObserver(muts => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const m of muts) {
    if (![...m.removedNodes].some(isPlaceholder)) continue;
    const added = [...m.addedNodes].filter(n => n.nodeType === 1 && !isPlaceholder(n));
    if (added.length > 40) arrive(m.target);
    else added.forEach(arrive);
  }
}).observe(document.getElementById('app'), { childList: true, subtree: true });
