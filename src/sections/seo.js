/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   SEO (Operations)                                                ║
   ║                                                                   ║
   ║   The sites we look after for search: status, the fee in Xero, a ║
   ║   weekly check of what the home page tells Google (and Google's   ║
   ║   scores when a PageSpeed key is set), problems with the fix, and ║
   ║   the log of work done this month. Add a site, log work, check    ║
   ║   now. Logic: core/seo.js. Design: docs/superpowers/specs/        ║
   ║   2026-10-20-seo-design.md                                        ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { sameClient } from '../core/client.js';
import { STATUS, siteState, seoFee, searchSummary, sparkline } from '../core/seo.js';

const SE = { sites: null, checks: [], work: [], repeating: [], google: null, days: [], queries: [], error: null, busy: '', open: new Set(), adding: false };
const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const myName = () => (els('userName')?.textContent || '').trim();
const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const day = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const when = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const LEVEL = { red: 'red', amber: 'amber', info: 'blue' };

async function load() {
  SE.error = null; render();
  try {
    const sb = await connectSupabase();
    const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    [SE.sites, SE.checks, SE.work, SE.repeating] = await Promise.all([
      sb.from('seo_sites').select('*').order('status').order('client_name').then(must),
      sb.from('seo_checks').select('*').order('checked_at', { ascending: false }).limit(200).then(must),
      sb.from('seo_work').select('*').gte('done_on', since).order('done_on', { ascending: false }).then(must),
      sb.from('xero_repeating_invoices').select('contact_name,status,period,line_items').then(must)
    ]);
    // Search Console (20 Oct): before its tables exist (this update), none; the rest of the page works.
    const soft = q => q.then(({ data, error }) => (error ? null : data));
    const dayFrom = new Date(Date.now() - 130 * 86400000).toISOString().slice(0, 10);
    [SE.google, SE.days, SE.queries] = await Promise.all([
      soft(sb.from('google_status').select('*').eq('id', 1).maybeSingle()),
      soft(sb.from('seo_search_days').select('*').gte('day', dayFrom)).then(r => r || []),
      soft(sb.from('seo_search_queries').select('*').order('clicks', { ascending: false })).then(r => r || [])
    ]);
  } catch (err) {
    SE.error = err;
  }
  render();
}

const states = () => (SE.sites || []).map(s => siteState(s, { checks: SE.checks.filter(c => c.site_id === s.id), work: SE.work.filter(w => w.site_id === s.id),
  fee: seoFee(SE.repeating, sameClient, s.client_name), today: today() }));

function render() {
  const mount = els('seoWrap');
  if (!mount) return;
  if (SE.error) {
    mount.innerHTML = `<div class="state-error art art-offline"><strong>Could not load SEO.</strong><p>${escapeHtml(/seo_/.test(SE.error.message || '') ? 'The SEO tables aren’t in the database yet (they arrive with this update).' : SE.error.message || SE.error)}</p><button type="button" class="btn btn-sm" data-seo-act="reload">Retry</button></div>`;
    return;
  }
  if (!SE.sites) { mount.innerHTML = '<p class="state-empty art art-loading">Loading SEO…</p>'; return; }
  const all = states();
  const active = all.filter(x => x.site.status === 'active');
  // A client billed once however many sites: the fee counted once per client.
  const fees = new Map(active.map(x => [x.site.client_name, x.fee]));
  const figures = `<div class="kpi-panel seo-kpis">
    <div class="kpi"><span class="kpi-label">Active</span><span class="kpi-value">${active.length}</span><span class="kpi-sub">${all.filter(x => x.site.status === 'setup').length} setting up · ${all.filter(x => x.site.status === 'proposed').length} proposed</span></div>
    <div class="kpi"><span class="kpi-label">SEO a month</span><span class="kpi-value">${escapeHtml(money([...fees.values()].reduce((t, n) => t + n, 0)))}</span><span class="kpi-sub">from Xero repeating invoices</span></div>
    <div class="kpi"><span class="kpi-label">Worked on this month</span><span class="kpi-value${active.some(x => x.flags.includes('no-work')) ? ' seo-warn' : ''}">${active.filter(x => x.work.length).length} of ${active.length}</span><span class="kpi-sub">work logged since the 1st</span></div>
    <div class="kpi"><span class="kpi-label">To fix</span><span class="kpi-value${all.some(x => x.flags.includes('problem')) ? ' seo-warn' : ''}">${all.reduce((t, x) => t + x.findings.filter(f => f.level !== 'info').length, 0)}</span><span class="kpi-sub">across ${all.length} site${all.length === 1 ? '' : 's'}</span></div>
  </div>`;
  const keyNote = SE.checks.length && !SE.checks.some(c => c.pagespeed) ? `<p class="seo-note">Google’s own speed and SEO scores appear once a free PageSpeed key is added (Supabase › Edge Functions › Secrets: <code>PAGESPEED_API_KEY</code>). The checks below don’t need it.</p>` : '';
  mount.innerHTML = `<div class="app-pane">${figures}${googleLine()}${keyNote}<div class="seo-list">${all.map(card).join('')}</div>${SE.adding ? addForm() : ''}</div>`;
}

/** Search Console: connected or not, last sync, Connect / Sync now. */
function googleLine() {
  const g = SE.google;
  if (g === null) return '';
  if (!g?.connected) return `<div class="seo-gsc"><span><strong>Search Console</strong> not connected: connect it to see which searches find each site, clicks and position.</span>
    <button type="button" class="btn btn-sm btn-primary" data-seo-act="gsc-connect">Connect Search Console</button></div>`;
  const props = (g.properties || []).length;
  return `<div class="seo-gsc${g.last_sync_ok === false ? ' bad' : ''}"><span><strong>Search Console</strong> ${escapeHtml(g.google_email || 'connected')} · ${props} propert${props === 1 ? 'y' : 'ies'}${g.last_sync_at ? ` · synced ${escapeHtml(when(g.last_sync_at))}` : ''}${g.last_sync_ok === false ? ` · <em>${escapeHtml(g.last_error)}</em>` : ''}</span>
    <button type="button" class="btn btn-sm btn-ghost" data-seo-act="gsc-sync"${SE.busy ? ' disabled' : ''}>${SE.busy === 'gsc' ? 'Syncing…' : 'Sync now'}</button></div>`;
}

const pct = n => `${(n * 100).toFixed(1)}%`;
const delta = (a, b, better = 'up') => {
  if (b == null || a == null || !b) return '';
  const up = a > b, same = a === b;
  const good = same ? '' : (better === 'up') === up ? 'good' : 'bad';
  return `<em class="seo-delta ${good}">${same ? 'same' : `${up ? '▲' : '▼'} ${Math.abs(Math.round((a - b) / b * 100))}%`}</em>`;
};
/** The last 28 days from Search Console, or why there's nothing. */
function searchRow(s) {
  if (!SE.google?.connected) return '';
  const sum = searchSummary(SE.days.filter(d => d.site_id === s.id), today());
  if (!sum) return `<p class="seo-line">Search Console: ${(SE.google.properties || []).length ? `${escapeHtml(s.domain)} isn’t among the properties this Google account can see. Add it (Domain property) in Search Console, or give this account access.` : 'no figures yet.'}</p>`;
  const n = sum.now, b = sum.before;
  return `<div class="seo-search"><span class="seo-stat"><b>${n.clicks}</b>clicks ${delta(n.clicks, b.clicks)}</span><span class="seo-stat"><b>${n.impressions}</b>times shown ${delta(n.impressions, b.impressions)}</span>
    <span class="seo-stat"><b>${n.position ?? '–'}</b>average position ${delta(n.position, b.position, 'down')}</span><span class="seo-stat"><b>${pct(n.ctr)}</b>click rate</span>
    <span class="seo-sparkwrap" title="Clicks a day, last 90 days">${sparkline(sum.series)}</span><span class="seo-period">28 days to ${escapeHtml(day(sum.end))}${sum.stale ? ' · not updated lately' : ''}</span></div>`;
}

function card(x) {
  const s = x.site;
  const open = SE.open.has(s.id);
  const status = STATUS.find(([k]) => k === s.status)?.[1] || s.status;
  const badge = s.status === 'active' ? 'green' : s.status === 'setup' ? 'blue' : s.status === 'proposed' ? 'amber' : 'grey';
  const sc = x.scores;
  const scores = sc ? `<div class="seo-scores">${[['Speed', sc.performance], ['SEO', sc.seo], ['Accessibility', sc.accessibility], ['Best practice', sc.bestPractices]]
    .filter(([, v]) => v != null).map(([k, v]) => `<span class="seo-score ${v >= 90 ? 'good' : v >= 50 ? 'mid' : 'bad'}"><b>${v}</b>${k}</span>`).join('')}</div>` : '';
  const toFix = x.findings.filter(f => f.level !== 'info');
  const checkLine = x.last ? `Checked ${escapeHtml(when(x.last.checked_at))} · ${toFix.length ? `${toFix.length} to fix` : 'nothing to fix'}${x.findings.length > toFix.length ? `, ${x.findings.length - toFix.length} suggestion${x.findings.length - toFix.length === 1 ? '' : 's'}` : ''}` : 'Not checked yet';
  const workLine = s.status !== 'active' ? '' : x.work.length ? `${x.work.length} piece${x.work.length === 1 ? '' : 's'} of work this month${x.minutes ? ` (${Math.round(x.minutes / 6) / 10}h)` : ''}`
    : `<span class="seo-warn">Nothing logged this month${x.lastWork ? ` (last: ${escapeHtml(day(x.lastWork.done_on))})` : ''}</span>`;
  return `<article class="seo-card${open ? ' open' : ''}">
    <header class="seo-head">
      <button type="button" class="seo-toggle" data-seo-open="${s.id}" aria-expanded="${open}">
        <span class="seo-name">${escapeHtml(s.client_name)}</span><span class="seo-domain">${escapeHtml(s.domain)}</span></button>
      <span class="badge badge-${badge}">${escapeHtml(status)}</span>${x.fee ? `<span class="seo-fee">${escapeHtml(money(x.fee))} a month</span>` : ''}
    </header>
    <p class="seo-line">${checkLine}${workLine ? ` · ${workLine}` : ''}</p>${scores}${searchRow(s)}
    ${open ? detail(x) : ''}
  </article>`;
}

function detail(x) {
  const s = x.site;
  const p = x.last?.onpage || {};
  const facts = x.last && !x.last.error ? `<dl class="seo-facts">
      <dt>Title</dt><dd>${escapeHtml(p.title || 'none')}</dd><dt>Description</dt><dd>${escapeHtml(p.description || 'none')}</dd>
      <dt>Main heading</dt><dd>${escapeHtml((p.h1 || [])[0] || 'none')}</dd><dt>Sitemap</dt><dd>${p.sitemap ? `<a href="${escapeHtml(p.sitemap)}" target="_blank" rel="noopener">${escapeHtml(p.sitemap)}</a>` : 'none found'}</dd>
      <dt>Business details</dt><dd>${escapeHtml((p.schemaTypes || []).join(', ') || 'none')}</dd><dt>Built with</dt><dd>${p.wordpress ? `WordPress${p.rankMath ? ' + Rank Math' : ''}` : 'not WordPress'}</dd>
      <dt>Home page</dt><dd>${p.ms ? `${(p.ms / 1000).toFixed(1)}s, ${Math.round((p.bytes || 0) / 1024)} KB` : ''}</dd></dl>` : '';
  const list = x.findings.length ? `<ul class="seo-find">${x.findings.map(f => `<li><span class="badge badge-${LEVEL[f.level]}">${f.level === 'info' ? 'Suggestion' : f.level === 'red' ? 'Fix now' : 'Fix'}</span><div><strong>${escapeHtml(f.text)}</strong><p>${escapeHtml(f.fix)}</p></div></li>`).join('')}</ul>`
    : x.last ? '<p class="seo-ok">Nothing to fix on the home page.</p>' : '';
  const work = SE.work.filter(w => w.site_id === s.id).slice(0, 8);
  return `<div class="seo-detail">
    <section><h4>Last check</h4>${list}${facts}
      <div class="seo-acts"><button type="button" class="btn btn-sm" data-seo-act="check" data-id="${s.id}"${SE.busy ? ' disabled' : ''}>${SE.busy === String(s.id) ? 'Checking…' : 'Check now'}</button>
        <a class="btn btn-sm btn-ghost" href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(`https://${s.domain}/`)}" target="_blank" rel="noopener">PageSpeed Insights</a>
        <a class="btn btn-sm btn-ghost" href="https://search.google.com/search-console?resource_id=${encodeURIComponent(`sc-domain:${s.domain}`)}" target="_blank" rel="noopener">Search Console</a>
        ${clientLink(s.client_name)}</div></section>
    ${queriesHtml(s)}
    <section><h4>Work done</h4>
      ${work.length ? `<ul class="seo-work">${work.map(w => `<li><span>${escapeHtml(day(w.done_on))}</span><div>${escapeHtml(w.what)}${w.minutes ? ` <em>${Math.round(w.minutes / 6) / 10}h</em>` : ''}${w.done_by ? ` <em>· ${escapeHtml(w.done_by.split(' ')[0])}</em>` : ''}</div></li>`).join('')}</ul>` : '<p class="seo-muted">Nothing logged yet.</p>'}
      <form class="seo-log" data-seo-log="${s.id}"><input name="what" required maxlength="300" placeholder="What was done, e.g. Published a blog post on lock changes; 3 Google Business posts">
        <input name="hours" inputmode="decimal" placeholder="Hours" aria-label="Hours" class="seo-hours"><input name="done_on" type="date" value="${today()}" aria-label="Date">
        <button class="btn btn-sm btn-primary" type="submit">Log it</button></form></section>
    <section><h4>About this site</h4>
      <form class="seo-about" data-seo-about="${s.id}">
        <label>Status <select name="status">${STATUS.map(([k, l]) => `<option value="${k}"${k === s.status ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Started <input type="date" name="started_on" value="${escapeHtml(s.started_on || '')}"></label>
        <label class="seo-wide">What they want to be found for <textarea name="keywords" rows="3" placeholder="locksmith lymington&#10;emergency locksmith new forest">${escapeHtml(s.keywords || '')}</textarea></label>
        <label class="seo-wide">Notes <textarea name="notes" rows="3">${escapeHtml(s.notes || '')}</textarea></label>
        <button class="btn btn-sm" type="submit">Save</button></form></section>
  </div>`;
}

/** The searches that found the site (last 28 days, top 15), with what to aim at: page 2 (positions 11 to 20) is the quickest win. */
function queriesHtml(s) {
  const q = SE.queries.filter(r => r.site_id === s.id).slice(0, 15);
  if (!q.length) return '';
  return `<section class="seo-qwrap"><h4>Searches that found it <span class="seo-muted">last 28 days</span></h4><table class="seo-q"><thead><tr><th>Search</th><th>Clicks</th><th>Shown</th><th>Position</th></tr></thead><tbody>
    ${q.map(r => `<tr><td>${escapeHtml(r.query)}</td><td>${r.clicks}</td><td>${r.impressions}</td><td class="${Number(r.position) <= 10 ? 'good' : Number(r.position) <= 20 ? 'near' : ''}">${Number(r.position).toFixed(1)}</td></tr>`).join('')}</tbody></table>
    <p class="seo-muted">Position 1–10 is page one of Google (green). 11–20 (amber) is page two: the quickest wins.</p></section>`;
}

function addForm() {
  return `<form class="seo-card seo-add" data-seo-add><h4>Add a site</h4>
    <label>Client <input name="client_name" required maxlength="120" placeholder="As on the client page"></label>
    <label>Website <input name="domain" required maxlength="120" placeholder="example.co.uk"></label>
    <label>Status <select name="status">${STATUS.map(([k, l]) => `<option value="${k}"${k === 'setup' ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="seo-acts"><button class="btn btn-sm btn-primary" type="submit">Add</button><button class="btn btn-sm btn-ghost" type="button" data-seo-act="cancel">Cancel</button></div></form>`;
}

async function write(fn, ok) {
  try {
    const sb = await connectSupabase({ interactive: true });
    must(await fn(sb));
    if (ok) toast(ok, 'success');
    await load();
  } catch (err) {
    toast(`Couldn’t save that: ${err.message || err}`, 'error', 9000);
  }
}

async function checkNow(id) {
  SE.busy = id ? String(id) : 'all'; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('seo-check', { body: id ? { site_id: Number(id) } : {} });
    if (error) throw new Error(error.message || 'The check didn’t run');
    if (data?.ok === false) throw new Error(data.error);
    toast(`Checked ${data.checked.length} site${data.checked.length === 1 ? '' : 's'}.`, 'success');
  } catch (err) {
    toast(`The check didn’t run: ${err.message || err}`, 'error', 9000);
  } finally {
    SE.busy = ''; await load();
  }
}

async function connectGoogle() {
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('google-auth', { body: {} });
    if (error || !data?.url) throw new Error(data?.error || error?.message || 'No sign-in link came back');
    location.href = data.url;   // Google's consent screen; google-callback brings you back here (#google=…)
  } catch (err) {
    toast(`Couldn’t start the Google sign-in: ${err.message || err}`, 'error', 10000);
  }
}
async function syncGoogle() {
  SE.busy = 'gsc'; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('gsc-sync', { body: {} });
    if (error) throw new Error(error.message);
    if (data?.ok === false) throw new Error(data.error);
    toast(`Search Console synced: ${data.matched} of ${data.sites} sites found.`, 'success');
  } catch (err) {
    toast(`Search Console didn’t sync: ${err.message || err}`, 'error', 10000);
  } finally { SE.busy = ''; await load(); }
}
/** Back from Google's consent screen (#google=… on the address, saved by src/main.js). */
function googleReturn() {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem('gecko.googleResult') || 'null'); sessionStorage.removeItem('gecko.googleResult'); } catch { /* storage blocked */ }
  if (!r) return;
  if (r.result === 'connected') toast(`Search Console connected: ${r.detail}.`, 'success', 8000);
  else if (r.result === 'connected-sync-failed') toast(`Search Console connected, but the first sync failed: ${r.detail}`, 'warning', 10000);
  else toast(`Search Console wasn’t connected: ${r.detail || 'cancelled'}`, 'error', 10000);
}

/** For quick find and others: open the page with one site's card open. */
export function open(id) { if (id) SE.open.add(Number(id)); render(); }

export function init() {
  const section = els('section-seo');
  section?.addEventListener('click', e => {
    if (e.target.closest('[data-open-client]')) return;
    const o = e.target.closest('[data-seo-open]');
    if (o) { const id = Number(o.dataset.seoOpen); SE.open.has(id) ? SE.open.delete(id) : SE.open.add(id); render(); return; }
    const a = e.target.closest('[data-seo-act]')?.dataset.seoAct;
    if (a === 'reload') load();
    if (a === 'check') checkNow(e.target.closest('[data-id]').dataset.id);
    if (a === 'cancel') { SE.adding = false; render(); }
    if (a === 'gsc-connect') connectGoogle();
    if (a === 'gsc-sync') syncGoogle();
  });
  section?.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, v = Object.fromEntries(new FormData(f));
    if (f.dataset.seoLog) {
      const hours = Number(String(v.hours || '').replace(',', '.'));
      write(sb => sb.from('seo_work').insert({ site_id: Number(f.dataset.seoLog), what: v.what.trim(), done_on: v.done_on || today(), minutes: hours > 0 ? Math.round(hours * 60) : null, done_by: myName() }).select('id'), 'Logged.');
    }
    if (f.dataset.seoAbout) write(sb => sb.from('seo_sites').update({ status: v.status, started_on: v.started_on || null, keywords: v.keywords, notes: v.notes }).eq('id', Number(f.dataset.seoAbout)).select('id'), 'Saved.');
    if (f.dataset.seoAdd !== undefined && f.matches('[data-seo-add]')) {
      const domain = String(v.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      SE.adding = false;
      write(sb => sb.from('seo_sites').insert({ client_name: v.client_name.trim(), domain, status: v.status, created_by: myName() }).select('id'), `Added ${domain}. Press Check now on it for its first check.`);
    }
  });
  els('seoAdd')?.addEventListener('click', () => { SE.adding = true; render(); els('seoWrap')?.querySelector('[data-seo-add] input')?.focus(); });
  els('seoCheckAll')?.addEventListener('click', () => checkNow(null));
  googleReturn();
  load();
}
