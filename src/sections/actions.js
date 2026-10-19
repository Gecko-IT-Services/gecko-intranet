/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   DO NEXT (Overview › Today): the next best actions               ║
   ║                                                                   ║
   ║   One ranked list of what to do now to make or protect money:     ║
   ║   protect first, then money by value, each with one Open button.  ║
   ║   Reads Reconcile's leaks, Xero's overdue invoices, the pipeline, ║
   ║   "What we keep fixing", Windows 10 PCs; Overview hands over the  ║
   ║   SSA balances and Monitoring's results it already has. No AI.   ║
   ║   Logic: core/actions.js. Design: docs/superpowers/specs/         ║
   ║   2026-10-19-next-best-action-design.md                           ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { escapeHtml, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { upgrades } from '../core/upgrades.js';
import { nextActions, valueText } from '../core/actions.js';
import { comingUp } from '../core/dates.js';
import { siteState, seoFee } from '../core/seo.js';
import { sameClient } from '../core/client.js';
import { snapshot as reconcileSnapshot } from './reconcile.js';

const NA = { raw: null, missing: [], loading: false, at: 0, ext: {}, all: false, waiting: [] };
const FRESH_MS = 10 * 60 * 1000;   // re-read at most every ten minutes (Overview redraws often)
const SHOWN = 6;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };

/** Every source at once; one that fails is named, the rest still count. */
async function load() {
  NA.loading = true;
  try {
    const sb = await connectSupabase();
    const tries = await Promise.allSettled([
      reconcileSnapshot().then(r => { if (r?.error) throw new Error(r.error); return r; }),
      sb.from('xero_invoices').select('contact_name,status,amount_due,due_date').eq('status', 'AUTHORISED').gt('amount_due', 0).then(must),
      sb.from('opportunities').select('id,client_name,product_key,title,status,mrr,one_off,modified_at,follow_up_on').in('status', ['idea', 'proposed', 'won']).then(must),
      sb.from('client_insights').select('client_name,data,created_at').eq('kind', 'evidence').order('created_at', { ascending: false }).then(must),
      sb.from('opportunity_products').select('key,name,active,default_mrr,default_one_off').then(must),
      sb.from('atera_agents').select('customer_name,machine_name,device_type,os,last_seen,last_user,model,raw').then(must),
      sb.from('xero_repeating_invoices').select('repeating_invoice_id,contact_name,status,period,next_date,line_items').gte('period', 11).then(must),
      sb.from('domain_dates').select('*').then(must),
      sb.from('voip_dealer_services').select('id,client_name,service,quantity,contract_end').then(must),
      Promise.all([sb.from('seo_sites').select('*').neq('status', 'paused').then(must),
        sb.from('seo_checks').select('site_id,checked_at,onpage,pagespeed,error').order('checked_at', { ascending: false }).limit(100).then(must),
        sb.from('seo_work').select('site_id,done_on,minutes').gte('done_on', new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)).then(must),
        sb.from('xero_repeating_invoices').select('contact_name,status,period,line_items').eq('period', 1).then(must)])
    ]);
    const [rec, inv, opps, ins, products, agents, annual, domains, dealer, seoRaw] = tries.map(t => (t.status === 'fulfilled' ? t.value : null));
    const names = ['the reconcile', 'Xero invoices', 'the pipeline', 'What we keep fixing', 'the catalogue', 'Atera devices', 'annual renewals', 'domain dates', 'VoIP contracts', 'SEO'];
    NA.missing = tries.map((t, i) => (t.status === 'rejected' ? `${names[i]} (${t.reason?.message || t.reason})` : null)).filter(Boolean);
    const latest = [];
    for (const i of ins || []) if (!latest.some(x => x.client_name === i.client_name)) latest.push(i);
    const up = agents ? upgrades(agents, today()).clients : [];
    // Dates that come round (core/dates.js): into the list, and kept whole for the Monday brief's Coming up.
    NA.dates = comingUp({ annual: annual || [], domains: domains || [], dealer: dealer || [], upgrades: up, today: today() });
    const [seoSites, seoChecks, seoWork, monthly] = seoRaw || [[], [], [], []];
    const seo = seoSites.map(s => siteState(s, { checks: seoChecks.filter(c => c.site_id === s.id), work: seoWork.filter(w => w.site_id === s.id),
      fee: seoFee(monthly, sameClient, s.client_name), today: today() }));
    NA.raw = { reconcile: rec, overdue: inv || [], opps: opps || [], insights: latest, products: products || [], upgrades: up, dates: NA.dates, seo };
    NA.at = Date.now();
  } catch (err) {
    NA.raw = null; NA.missing = [`everything (${err.message || err})`];
  } finally {
    NA.loading = false;
    NA.waiting.splice(0).forEach(r => r());
    const mount = document.getElementById('ovwActions');
    if (mount) mount.innerHTML = card();
  }
}

function card() {
  const list = NA.raw ? nextActions({ ...NA.raw, ...NA.ext, today: today() }) : [];
  const shown = NA.all ? list : list.slice(0, SHOWN);
  const protect = list.filter(a => a.group === 'protect').length;
  const head = `<div class="ovw-card-head"><h3>Do next</h3><span class="ovw-sub">protect first, then money by value</span>
    <span class="ovw-count ${protect ? 'red' : list.length ? '' : 'good'}">${!NA.raw && NA.loading ? '…' : list.length || (NA.missing.length ? '—' : 'Nothing')}</span></div>`;
  const rows = shown.map(a => `<li class="${a.group === 'protect' ? 'red' : 'money'}"><span class="dot" aria-hidden="true"></span>
      <div><strong>${escapeHtml(a.title)}</strong><p>${[a.client ? clientLink(a.client) : '', escapeHtml(a.why)].filter(Boolean).join(' · ')}</p></div>
      <span class="na-row-end">${a.value ? `<span class="na-val">${escapeHtml(valueText(a.value))}</span>` : ''}
        <button type="button" data-ovw-go="${escapeHtml(a.go)}" aria-label="${escapeHtml('Open: ' + a.title)}">Open →</button></span></li>`).join('');
  const more = list.length > SHOWN ? `<button type="button" class="ovw-card-link na-more" data-na-all>${NA.all ? 'Show the top six' : `Show all ${list.length}`}</button>` : '';
  const body = !NA.raw && NA.loading ? '<p class="ovw-clear">Working out what’s worth doing…</p>'
    : list.length ? `<ul class="ovw-attn na-list">${rows}</ul>${more}`
    : NA.missing.length ? '<div class="ovw-clear">Nothing found in what was checked.</div>'
    : '<div class="ovw-clear art art-clear">Nothing to chase, bill or protect right now.</div>';
  const warn = NA.missing.length ? `<p class="ovw-warn-line">Not checked: ${escapeHtml(NA.missing.join(', '))}.</p>` : '';
  return `<div class="ovw-card na-card">${head}${body}${warn}</div>`;
}

/**
 * The card for Overview › Today. ext: what Overview already has: { ssa: [{ name, remaining, archived }], devices: GeckoMonitor.devices()
 * items, coverage: GeckoMonitor.coverage() red }. Reads its own sources on first use and every ten minutes after.
 */
export function html(ext = {}) {
  NA.ext = ext;
  if (!NA.loading && (!NA.raw || Date.now() - NA.at > FRESH_MS)) load();
  return `<div id="ovwActions">${card()}</div>`;
}

/** The list as it stands, for the Monday brief: { list, missing }, or null before the first read. */
export function current() {
  return NA.raw || NA.missing.length ? { list: NA.raw ? nextActions({ ...NA.raw, ...NA.ext, today: today() }) : [], dates: NA.dates || [], missing: NA.missing } : null;
}
/** Resolves once the first read has finished (at once if it has). */
export const whenReady = () => (NA.raw || (!NA.loading && NA.missing.length) ? Promise.resolve() : new Promise(r => NA.waiting.push(r)));

export function init() {
  document.addEventListener('click', e => {
    if (!e.target.closest?.('#ovwActions [data-na-all]')) return;
    NA.all = !NA.all;
    const mount = document.getElementById('ovwActions');
    if (mount) mount.innerHTML = card();
  });
}
