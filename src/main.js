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
import * as cspCosts from './core/csp-costs.js';
import * as profitFeed from './core/profit-feed.js';
import * as ssaRenewal from './core/ssa-renewal.js';
import * as supabase from './core/supabase.js';

window.GeckoSections = window.GeckoSections || {};
window.GeckoSections.projects = { init: projects.init };
window.GeckoSections.backups  = { init: backups.init };
window.GeckoSections.alerts   = { init: alerts.init };

// Pure logic used by the Profitability section, which still lives in
// index.html's classic script and therefore cannot import modules itself.
window.CspCosts = cspCosts;
window.ProfitFeed = profitFeed;
// Timesheets › SSA › Renew (also classic script).
window.SsaRenewal = ssaRenewal;
// Supabase session is dropped on Microsoft sign-out (classic script calls this).
window.forgetSupabaseSession = supabase.forgetSupabaseSession;
