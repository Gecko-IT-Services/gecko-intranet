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
import { STATUS, siteState, seoFee } from '../core/seo.js';

const SE = { sites: null, checks: [], work: [], repeating: [], error: null, busy: '', open: new Set(), adding: false };
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
  mount.innerHTML = `<div class="app-pane">${figures}${keyNote}<div class="seo-list">${all.map(card).join('')}</div>${SE.adding ? addForm() : ''}</div>`;
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
    <p class="seo-line">${checkLine}${workLine ? ` · ${workLine}` : ''}</p>${scores}
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
  load();
}
