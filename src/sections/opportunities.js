/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   OPPORTUNITIES                                                   ║
   ║                                                                   ║
   ║   Finds the gaps in each client (what they don't buy from us,     ║
   ║   how their email and website are set up, what they keep calling  ║
   ║   us about) and turns any gap into a tracked opportunity and an   ║
   ║   Outlook draft. Design: docs/superpowers/specs/                  ║
   ║   2026-10-08-opportunities-design.md. Logic: core/opportunities.  ║
   ║                                                                   ║
   ║   Reads: gecko_clients / gecko_services (clientList* helpers),    ║
   ║   the profitability feed (Xero, TD SYNNEX, Exclaimer, Clook), the ║
   ║   SSA Clients and Timesheets lists (SharePoint, read only).       ║
   ║   Writes: Supabase opportunities, client_product_status,          ║
   ║   client_domains, client_signals, opportunity_products.           ║
   ║   Public checks: Cloudflare DNS-over-HTTPS, Google PageSpeed.     ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { graphFetch, resolveSiteId, fetchAllLists } from '../core/graph.js';
import { toast, escapeHtml, syncTableLabels } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import {
  summariseDns, summarisePageSpeed, clientGaps, withoutOpen, pipelineTotals, fillTemplate,
  emailDomain, THRESHOLDS
} from '../core/opportunities.js';

const STATUSES = [['idea', 'Idea'], ['proposed', 'Proposed'], ['won', 'Won'], ['lost', 'Lost']];
const SIGNAL_MAX_AGE_DAYS = 30;   // re-check a domain after this long

const OPP = {
  tab: 'gaps',
  showAll: false,          // include "not bought, no evidence yet" gaps
  open: new Set(),         // expanded client cards
  loading: false,
  error: null,
  checking: null,          // { done, total, label } while checks run
  products: [], statuses: {}, manualDomains: [], signals: new Map(), opps: [],
  clients: [], latestMonth: '', feedNote: ''
};

const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(ltd|limited|plc)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const els = id => document.getElementById(id);

// ─── Data ─────────────────────────────────────────────────────────────

async function readFeed() {
  const F = window.ProfitFeed;
  try {
    const siteId = await resolveSiteId();
    const item = `/sites/${siteId}/drive/root:/${encodeURI(F.FEED_PATH)}:`;
    const meta = await graphFetch(item);
    const url = meta && meta['@microsoft.graph.downloadUrl'];
    const data = url ? await (await fetch(url, { cache: 'no-store' })).json() : await graphFetch(`${item}/content`);
    const check = F.validateFeed(data);
    if (!check.ok) { OPP.feedNote = 'The profitability feed failed its checks, so Xero and supplier data are left out.'; return null; }
    return data;
  } catch (err) {
    OPP.feedNote = 'The profitability feed could not be read (' + (err.message || err) + '), so Xero and supplier data are left out.';
    return null;
  }
}

/** Every item of a SharePoint list by name, following paging. Missing list → []. */
async function spList(name, lists, siteId) {
  const list = lists.find(l => l.displayName === name || l.name === name);
  if (!list) return [];
  let items = [], next = `/sites/${siteId}/lists/${list.id}/items?$expand=fields&$top=999`;
  while (next) {
    const res = await graphFetch(next);
    items = items.concat(res.value || []);
    next = res['@odata.nextLink'] || null;
    if (items.length > 5000) break;   // ponytail: 5000 timesheet rows is years of work; widen if ever hit
  }
  return items;
}

async function load() {
  OPP.loading = true; OPP.error = null; OPP.feedNote = '';
  render();
  try {
    const sb = await connectSupabase();
    const siteId = await resolveSiteId();
    const lists = await fetchAllLists();
    const listId = n => lists.find(l => l.displayName === n || l.name === n)?.id;

    const [products, statuses, domains, signals, opps, gClients, gServices, feed, ssaItems, tsItems] = await Promise.all([
      sb.from('opportunity_products').select('*').order('sort').then(must),
      sb.from('client_product_status').select('*').then(must),
      sb.from('client_domains').select('*').then(must),
      sb.from('client_signals').select('*').then(must),
      sb.from('opportunities').select('*').order('modified_at', { ascending: false }).then(must),
      window.clientListItems('gecko_clients', siteId, listId('GeckoClients'), 500),
      window.clientListItems('gecko_services', siteId, listId('GeckoServices'), 2000),
      readFeed(),
      spList('Clients', lists, siteId),
      spList('Timesheets', lists, siteId)
    ]);

    OPP.products = products;
    OPP.statuses = {};
    for (const s of statuses) (OPP.statuses[s.client_name] ||= {})[s.product_key] = s.status;
    OPP.manualDomains = domains;
    OPP.signals = new Map(signals.map(s => [`${s.kind}:${s.domain}`, s]));
    OPP.opps = opps;
    OPP.clients = buildClients({ gClients, gServices, feed, ssaItems, tsItems, domains });
  } catch (err) {
    OPP.error = err;
  } finally {
    OPP.loading = false;
    render();
  }
}

/**
 * One record per client: what they buy, what the feed knows about them, their
 * domains and contact, and their timesheets. Names are matched with the same
 * matcher Profitability uses (prfXeroMatchName), so a client is the same
 * client everywhere.
 */
function buildClients({ gClients, gServices, feed, ssaItems, tsItems, domains }) {
  const byKey = new Map();
  const add = (name, extra) => {
    const k = norm(name);
    if (!k) return null;
    if (!byKey.has(k)) byKey.set(k, { name, key: k, services: [], tickets: [], hostedDomains: [], mrr: 0, ssa: false, contact: '', contactName: '', status: '' });
    return Object.assign(byKey.get(k), extra || {});
  };
  for (const it of gClients) {
    const f = it.fields || {};
    if (f.Title) add(f.Title, { status: f.Status || 'Active' });
  }
  const ssaById = new Map();
  for (const it of ssaItems) {
    const f = it.fields || {};
    if (!f.Title) continue;
    const archived = f.Archived === true || f.Archived === 'Yes';
    ssaById.set(String(it.id), f.Title);
    if (archived) continue;
    const c = add(f.Title);
    c.ssa = true;
    c.contact = c.contact || f.Email || '';
    c.contactName = c.contactName || f.PrimaryContact || '';
  }
  const list = [...byKey.values()].filter(c => !/lost|former|archiv|ceased/i.test(c.status));
  const asPortal = list.map(c => ({ name: c.name, ref: c }));
  const match = name => (name ? window.prfXeroMatchName(name, asPortal)?.ref || null : null);

  for (const it of gServices) {
    const f = it.fields || {};
    const c = byKey.get(norm(f.ClientName)) || match(f.ClientName);
    if (c) c.services.push({ title: f.Title || '', category: String(f.Category || '').toLowerCase(), notes: f.Notes || '' });
  }

  if (feed) {
    const months = Object.keys(feed.xero?.recurring || {}).filter(m => Object.keys(feed.xero.recurring[m]).length).sort();
    OPP.latestMonth = months.at(-1) || '';
    for (const [xName, net] of Object.entries(feed.xero?.recurring?.[OPP.latestMonth] || {})) {
      const c = match(xName); if (c) c.mrr += Number(net) || 0;
    }
    for (const inv of (feed.cspInvoices || []).slice(0, 2)) {
      for (const r of inv.customers || []) { const c = match(r.client || r.customer); if (c) c.cspClient = true; }
    }
    for (const s of feed.exclaimer?.subscriptions || []) {
      if (s.shared) continue;
      const c = match(s.endUser); if (c) c.exclaimer = true;
    }
    for (const inv of feed.clook?.invoices || []) {
      for (const l of inv.lines || []) {
        if (!l.client || !l.domain) continue;
        const c = match(l.client);
        if (c && !c.hostedDomains.includes(l.domain)) c.hostedDomains.push(l.domain);
      }
    }
  }

  for (const it of tsItems) {
    const f = it.fields || {};
    const name = ssaById.get(String(f.ClientLookupId ?? ''));
    const c = name && (byKey.get(norm(name)) || match(name));
    if (!c || /system/i.test(f.Engineer || '')) continue;   // System rows are SSA credits, not work
    const text = [f.WorkDescription, f.Work_x0020_Description, f.Title, f.InternalNotes, f.Internal_x0020_Notes].filter(Boolean).join(' — ');
    const hours = Number(f.HoursSpent ?? f.Hours) || 0;
    if (hours <= 0) continue;
    const raw = f.Date || it.createdDateTime || '';
    const date = window.spDateToLocalDateKey ? window.spDateToLocalDateKey(raw) : String(raw).slice(0, 10);   // UK date, like Leave/Mileage
    c.tickets.push({ date, text, hours });
  }

  for (const c of list) {
    const manual = domains.filter(d => d.client_name === c.name).map(d => d.domain);
    c.emailDomain = emailDomain(c.contact) || manual[0] || c.hostedDomains[0] || '';
    c.webDomain = manual[0] || c.hostedDomains[0] || c.emailDomain || '';
    c.domains = [...new Set([...manual, c.emailDomain, ...c.hostedDomains].filter(Boolean))];
    c.mrr = Math.round(c.mrr * 100) / 100;
  }
  return list;
}

/** Attach the cached checks to each client, then work out its gaps. */
function analyse(c) {
  const dnsRow = c.emailDomain && OPP.signals.get(`dns:${c.emailDomain}`);
  const psRow = c.webDomain && OPP.signals.get(`pagespeed:${c.webDomain}`);
  const client = { ...c, dns: dnsRow?.data && !dnsRow.data.error ? dnsRow.data : null, pagespeed: psRow?.data || null };
  const all = clientGaps(client, OPP.products, OPP.statuses[c.name] || {});
  const gaps = withoutOpen(all, OPP.opps, c.name).filter(g => OPP.showAll || g.strength > 0);
  return { client, gaps, dnsRow, psRow };
}

// ─── Public checks (no keys) ──────────────────────────────────────────

const DNS_TYPE = { MX: 15, TXT: 16, CNAME: 5 };
async function doh(name, type) {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { accept: 'application/dns-json' } });
  if (!res.ok) throw new Error(`DNS ${res.status}`);
  const json = await res.json();
  return (json.Answer || []).filter(a => a.type === DNS_TYPE[type]).map(a => String(a.data));
}

async function checkDns(domain) {
  try {
    const [mx, txt, dmarc, dk1, dk2] = await Promise.all([
      doh(domain, 'MX'), doh(domain, 'TXT'), doh(`_dmarc.${domain}`, 'TXT'),
      doh(`selector1._domainkey.${domain}`, 'CNAME'), doh(`selector2._domainkey.${domain}`, 'CNAME')
    ]);
    return summariseDns({ mx: mx.map(m => m.split(/\s+/).pop()), txt, dmarc, dkim: dk1.length > 0 || dk2.length > 0 });
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

async function checkPageSpeed(domain) {
  const run = async scheme => {
    const q = new URLSearchParams({ url: `${scheme}://${domain}`, strategy: 'mobile' });
    for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) q.append('category', c);
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `PageSpeed ${res.status}`);
    return summarisePageSpeed(json);
  };
  try {
    return await run('https');
  } catch (err) {
    if (/quota|rate|429/i.test(err.message)) return { error: 'Google’s daily limit for free checks was reached; try again tomorrow.' };
    try { const r = await run('http'); return { ...r, https: false }; }
    catch (err2) { return { error: err2.message || String(err2) }; }
  }
}

async function saveSignal(sb, domain, kind, data) {
  const row = { domain, kind, data, checked_at: new Date().toISOString() };
  must(await sb.from('client_signals').upsert(row, { onConflict: 'domain,kind' }));
  OPP.signals.set(`${kind}:${domain}`, row);
}

const stale = row => !row || (Date.now() - Date.parse(row.checked_at)) / 86400000 > SIGNAL_MAX_AGE_DAYS;

/** Check email (DNS) and website (PageSpeed) for the given clients. `force` re-checks fresh results too. */
async function runChecks(clients, { force = false } = {}) {
  if (OPP.checking) return;
  const sb = await connectSupabase({ interactive: true });
  const jobs = [];
  for (const c of clients) {
    if (c.emailDomain && (force || stale(OPP.signals.get(`dns:${c.emailDomain}`)))) jobs.push(['dns', c.emailDomain]);
    if (c.webDomain && (force || stale(OPP.signals.get(`pagespeed:${c.webDomain}`)))) jobs.push(['pagespeed', c.webDomain]);
  }
  const unique = [...new Map(jobs.map(j => [j.join(':'), j])).values()];
  if (!unique.length) { toast('Everything was checked within the last 30 days', 'info'); return; }
  OPP.checking = { done: 0, total: unique.length, label: '' };
  render();
  let failed = 0;
  try {
    // DNS is quick: four at a time. PageSpeed takes 10–30 s a site: one at a time.
    const dns = unique.filter(j => j[0] === 'dns'), ps = unique.filter(j => j[0] === 'pagespeed');
    for (let i = 0; i < dns.length; i += 4) {
      await Promise.all(dns.slice(i, i + 4).map(async ([, d]) => {
        const data = await checkDns(d);
        if (data.error) failed++;
        await saveSignal(sb, d, 'dns', data);
        OPP.checking.done++; OPP.checking.label = `email: ${d}`; renderProgress();
      }));
    }
    for (const [, d] of ps) {
      OPP.checking.label = `website: ${d}`; renderProgress();
      const data = await checkPageSpeed(d);
      if (data.error) failed++;
      await saveSignal(sb, d, 'pagespeed', data);
      OPP.checking.done++; renderProgress();
    }
    toast(failed ? `Checks finished; ${failed} could not be completed (shown on the client)` : 'Checks finished', failed ? 'warning' : 'success', 5000);
  } catch (err) {
    toast('Checks stopped: ' + (err.message || err), 'error', 7000);
  } finally {
    OPP.checking = null;
    render();
  }
}

// ─── Actions ──────────────────────────────────────────────────────────

const findClient = name => OPP.clients.find(c => c.name === name);
const findProduct = key => OPP.products.find(p => p.key === key);

async function addOpportunity(clientName, productKey, { draft = false } = {}) {
  const c = findClient(clientName), p = findProduct(productKey);
  if (!c || !p) return;
  const gap = analyse(c).gaps.find(g => g.product.key === productKey);
  const evidence = gap ? gap.reasons.join('\n') : '';
  try {
    const sb = await connectSupabase({ interactive: true });
    const row = must(await sb.from('opportunities').insert({
      client_name: c.name, product_key: p.key, title: `${p.name} — ${c.name}`,
      status: 'idea', mrr: Number(p.default_mrr) || 0, one_off: Number(p.default_one_off) || 0,
      evidence, owner: myName()
    }).select('*').single());
    OPP.opps.unshift(row);
    toast('Added to the pipeline', 'success');
    if (draft) await draftEmail(row.id);
    else render();
  } catch (err) {
    toast('Could not add: ' + (err.message || err), 'error', 7000);
  }
}

async function setStatus(clientName, productKey, status) {
  try {
    const sb = await connectSupabase({ interactive: true });
    must(await sb.from('client_product_status').upsert({ client_name: clientName, product_key: productKey, status }, { onConflict: 'client_name,product_key' }));
    (OPP.statuses[clientName] ||= {})[productKey] = status;
    toast(status === 'has' ? 'Marked as already has it' : status === 'not_interested' ? 'Marked as not interested' : 'Hidden', 'success');
    render();
  } catch (err) { toast('Could not save: ' + (err.message || err), 'error', 7000); }
}

async function patchOpp(id, patch) {
  const sb = await connectSupabase({ interactive: true });
  if (patch.status === 'won' || patch.status === 'lost') patch.closed_at = new Date().toISOString();
  if (patch.status === 'idea' || patch.status === 'proposed') patch.closed_at = null;
  const row = must(await sb.from('opportunities').update(patch).eq('id', id).select('*').single());
  OPP.opps = OPP.opps.map(o => (o.id === id ? row : o));
  return row;
}

function myName() {
  return (els('userName')?.textContent || '').trim();
}

/** Outlook draft (never sent) to the client's contact; the opportunity moves to Proposed. */
async function draftEmail(id) {
  const o = OPP.opps.find(x => x.id === id);
  if (!o) return;
  const p = findProduct(o.product_key) || { name: o.title, email_subject: o.title, email_body: 'Hi {{first_name}},\n\n{{evidence}}\n\n{{price}}\n\n{{sender}}' };
  const c = findClient(o.client_name) || {};
  const mail = fillTemplate(p, {
    client: o.client_name,
    firstName: String(c.contactName || '').split(/\s+/)[0],
    evidence: String(o.evidence || '').split('\n').filter(Boolean),
    mrr: o.mrr, oneOff: o.one_off,
    sender: myName() ? `Kind regards,\n${myName()}\nGecko IT Services` : 'Kind regards,\nGecko IT Services'
  });
  try {
    await graphFetch('/me/messages', {
      method: 'POST', scopes: ['Mail.ReadWrite'], interactive: true,
      body: JSON.stringify({
        subject: mail.subject,
        body: { contentType: 'HTML', content: mail.html },
        toRecipients: c.contact ? [{ emailAddress: { address: c.contact } }] : []
      })
    });
    await patchOpp(id, { status: o.status === 'idea' ? 'proposed' : o.status, next_step: 'Draft in Outlook: check, then send' });
    toast(c.contact ? `Draft to ${c.contact} saved in your Outlook Drafts` : 'Draft saved in your Outlook Drafts (no contact email on file: add the recipient)', 'success', 6000);
  } catch (err) {
    toast('Could not create the draft: ' + (err.message || err), 'error', 8000);
  } finally {
    render();
  }
}

async function addDomain(clientName, raw) {
  const domain = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) { toast('That doesn’t look like a domain (e.g. example.co.uk)', 'warning'); return; }
  try {
    const sb = await connectSupabase({ interactive: true });
    const row = must(await sb.from('client_domains').insert({ client_name: clientName, domain }).select('*').single());
    OPP.manualDomains.push(row);
    const c = findClient(clientName);
    if (c) {
      c.domains = [...new Set([domain, ...c.domains])];
      c.webDomain = domain;
      if (!c.emailDomain) c.emailDomain = domain;
      await runChecks([c]);
    }
  } catch (err) { toast('Could not add the domain: ' + (err.message || err), 'error', 7000); }
}

async function saveProduct(key, form) {
  const num = v => (String(v).trim() === '' ? null : Number(v));
  const patch = {
    default_mrr: num(form.mrr.value), default_one_off: num(form.oneoff.value),
    active: form.active.checked,
    email_subject: form.subject.value, email_body: form.body.value
  };
  if ([patch.default_mrr, patch.default_one_off].some(v => v != null && !(v >= 0))) { toast('Prices must be numbers', 'warning'); return; }
  try {
    const sb = await connectSupabase({ interactive: true });
    const row = must(await sb.from('opportunity_products').update(patch).eq('key', key).select('*').single());
    OPP.products = OPP.products.map(p => (p.key === key ? row : p));
    toast('Saved', 'success');
    render();
  } catch (err) { toast('Could not save: ' + (err.message || err), 'error', 7000); }
}

// ─── Render ───────────────────────────────────────────────────────────

function render() {
  const mount = els('oppWrap');
  if (!mount) return;
  renderKpis();
  document.querySelectorAll('#section-opportunities [data-opp-tab]').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.oppTab === OPP.tab)));

  if (OPP.loading && !OPP.clients.length) { mount.innerHTML = '<p class="opp-empty">Gathering clients, invoices and timesheets…</p>'; return; }
  if (OPP.error) {
    const e = OPP.error;
    mount.innerHTML = e.code === 'DB_SIGNIN_REQUIRED'
      ? `<div class="opp-error"><strong>Connect to the Gecko database</strong>Opportunities are kept in the database. Connect once with your Microsoft account.<button type="button" data-opp-act="connect">Connect</button></div>`
      : `<div class="opp-error"><strong>Could not load opportunities.</strong>${escapeHtml(e.message || e)}<button type="button" data-opp-act="reload">Retry</button></div>`;
    return;
  }
  mount.innerHTML = (OPP.feedNote ? `<p class="opp-note">${escapeHtml(OPP.feedNote)}</p>` : '') + progressHtml() +
    (OPP.tab === 'gaps' ? gapsHtml() : OPP.tab === 'pipeline' ? pipelineHtml() : productsHtml());
  syncTableLabels(mount);
}

function renderKpis() {
  const k = els('oppKpis');
  if (!k) return;
  const t = pipelineTotals(OPP.opps);
  const current = OPP.clients.reduce((s, c) => s + (c.mrr || 0), 0);
  const month = OPP.latestMonth ? new Date(OPP.latestMonth + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
  k.innerHTML = [
    ['Recurring revenue', money(current), month ? `Xero, ${month}` : 'Xero'],
    ['Open pipeline', money(t.openMrr) + '/mo', `${t.openCount} open · ${money(t.openOneOff)} one-off`],
    ['Won this month', money(t.wonMrrThisMonth) + '/mo', `${t.wonCountThisMonth} won`],
    ['Won to date', money(t.wonMrr) + '/mo', 'added recurring revenue']
  ].map(([l, v, s]) => `<div class="opp-kpi"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v)}</strong><small>${escapeHtml(s)}</small></div>`).join('');
}

function progressHtml() {
  if (!OPP.checking) return '';
  const { done, total, label } = OPP.checking;
  return `<div class="opp-progress" role="status"><div style="width:${Math.round(done / total * 100)}%"></div><span>Checking ${done}/${total} · ${escapeHtml(label)}</span></div>`;
}
function renderProgress() {
  const el = document.querySelector('#section-opportunities .opp-progress');
  if (el) el.outerHTML = progressHtml(); else render();
}

const STRENGTH = ['Not bought from us', 'Evidence', 'Strong evidence'];

function signalLine(c, dnsRow, psRow) {
  const parts = [];
  if (!c.domains.length) parts.push('No domain known yet: add one to check their email and website.');
  if (dnsRow) {
    const d = dnsRow.data;
    parts.push(d.error ? `Email check failed (${d.error})`
      : `Email ${c.emailDomain}: ${({ microsoft: 'Microsoft 365', google: 'Google', filtered: 'filtered', other: 'other provider', none: 'no mail' })[d.provider] || d.provider}${d.filter ? ' via ' + d.filter : ''} · SPF ${d.spf} · DMARC ${d.dmarc}${d.provider === 'microsoft' ? ' · DKIM ' + (d.dkim ? 'on' : 'off') : ''}`);
  } else if (c.emailDomain) parts.push(`Email ${c.emailDomain}: not checked yet`);
  if (psRow) {
    const p = psRow.data;
    parts.push(p.error ? `Website check failed (${p.error})`
      : `Website ${c.webDomain}: speed ${p.performance ?? '—'} · SEO ${p.seo ?? '—'} · accessibility ${p.accessibility ?? '—'}${p.https === false ? ' · no HTTPS' : ''}`);
  } else if (c.webDomain) parts.push(`Website ${c.webDomain}: not checked yet`);
  const when = [dnsRow, psRow].filter(Boolean).map(r => r.checked_at).sort().at(0);
  return parts.map(p => `<span>${escapeHtml(p)}</span>`).join('') + (when ? `<span class="opp-muted">checked ${escapeHtml(new Date(when).toLocaleDateString('en-GB'))}</span>` : '');
}

function gapsHtml() {
  const rows = OPP.clients.map(c => ({ c, ...analyse(c) }))
    .sort((a, b) => (b.gaps.filter(g => g.strength).length - a.gaps.filter(g => g.strength).length) || (b.c.mrr - a.c.mrr));
  const strong = rows.reduce((t, r) => t + r.gaps.filter(g => g.strength).length, 0);
  const unchecked = OPP.clients.filter(c => (c.emailDomain && !OPP.signals.get(`dns:${c.emailDomain}`)) || (c.webDomain && !OPP.signals.get(`pagespeed:${c.webDomain}`))).length;
  const head = `<div class="opp-toolbar">
      <span><strong>${strong}</strong> gaps with evidence across <strong>${rows.length}</strong> clients${unchecked ? ` · ${unchecked} not checked yet` : ''}</span>
      <label class="opp-check"><input type="checkbox" data-opp-act="showall" ${OPP.showAll ? 'checked' : ''}> Also show products they simply don’t buy yet</label>
      <button type="button" class="opp-btn" data-opp-act="checkall" ${OPP.checking ? 'disabled' : ''}>Check email &amp; websites</button>
    </div>`;
  if (!rows.length) return head + '<p class="opp-empty">No clients found in the client list.</p>';
  return head + rows.map(({ c, gaps, dnsRow, psRow }) => {
    const isOpen = OPP.open.has(c.name);
    const chips = gaps.slice(0, 6).map(g => `<span class="opp-chip s${g.strength}">${escapeHtml(g.product.name)}</span>`).join('') + (gaps.length > 6 ? `<span class="opp-chip">+${gaps.length - 6}</span>` : '');
    const body = !isOpen ? '' : `<div class="opp-card-body">
        <div class="opp-signals">${signalLine(c, dnsRow, psRow)}</div>
        <div class="opp-domain"><input type="text" placeholder="Add a domain, e.g. ${escapeHtml(norm(c.name).split(' ')[0] || 'client')}.co.uk" data-opp-domain="${escapeHtml(c.name)}" aria-label="Add a domain for ${escapeHtml(c.name)}">
          <button type="button" class="opp-btn ghost" data-opp-act="adddomain" data-client="${escapeHtml(c.name)}">Add &amp; check</button>
          ${c.domains.length ? `<button type="button" class="opp-btn ghost" data-opp-act="checkone" data-client="${escapeHtml(c.name)}" ${OPP.checking ? 'disabled' : ''}>Re-check now</button>` : ''}</div>
        ${gaps.length ? gaps.map(g => `<div class="opp-gap">
            <div class="opp-gap-head"><strong>${escapeHtml(g.product.name)}</strong><span class="opp-chip s${g.strength}">${STRENGTH[g.strength]}</span>
              <span class="opp-muted">${g.mrr != null ? escapeHtml(money(g.mrr)) + '/mo' : 'price not set'}${g.oneOff ? ' · ' + escapeHtml(money(g.oneOff)) + ' one-off' : ''}</span></div>
            <ul>${g.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
            <div class="opp-gap-actions">
              <button type="button" class="opp-btn" data-opp-act="draft" data-client="${escapeHtml(c.name)}" data-product="${escapeHtml(g.product.key)}">Add &amp; draft email</button>
              <button type="button" class="opp-btn ghost" data-opp-act="add" data-client="${escapeHtml(c.name)}" data-product="${escapeHtml(g.product.key)}">Add to pipeline</button>
              <button type="button" class="opp-btn ghost" data-opp-act="has" data-client="${escapeHtml(c.name)}" data-product="${escapeHtml(g.product.key)}">Already has it</button>
              <button type="button" class="opp-btn ghost" data-opp-act="notint" data-client="${escapeHtml(c.name)}" data-product="${escapeHtml(g.product.key)}">Not interested</button>
            </div></div>`).join('') : '<p class="opp-muted">No gaps found for this client.</p>'}
      </div>`;
    return `<section class="opp-card${isOpen ? ' open' : ''}">
      <button type="button" class="opp-card-head" data-opp-act="toggle" data-client="${escapeHtml(c.name)}" aria-expanded="${isOpen}">
        <span class="opp-name">${escapeHtml(c.name)}</span>
        <span class="opp-chips">${chips || '<span class="opp-muted">no gaps</span>'}</span>
        <span class="opp-mrr">${c.mrr ? escapeHtml(money(c.mrr)) + '/mo' : '—'}</span>
      </button>${body}</section>`;
  }).join('');
}

function pipelineHtml() {
  if (!OPP.opps.length) return '<p class="opp-empty">Nothing in the pipeline yet. Open a client on the Gaps tab and choose “Add to pipeline”.</p>';
  return `<div class="opp-board">${STATUSES.map(([key, label]) => {
    const items = OPP.opps.filter(o => o.status === key);
    const total = items.reduce((t, o) => t + (Number(o.mrr) || 0), 0);
    return `<div class="opp-col"><div class="opp-col-head"><strong>${label}</strong><span>${items.length} · ${escapeHtml(money(total))}/mo</span></div>
      ${items.map(o => `<article class="opp-item">
        <div class="opp-item-client">${escapeHtml(o.client_name)}</div>
        <div class="opp-item-title">${escapeHtml(findProduct(o.product_key)?.name || o.title)}</div>
        <form class="opp-item-form" data-opp-form="${o.id}">
          <label>£/month <input name="mrr" type="number" step="0.01" min="0" value="${escapeHtml(o.mrr)}"></label>
          <label>£ one-off <input name="one_off" type="number" step="0.01" min="0" value="${escapeHtml(o.one_off)}"></label>
          <label class="wide">Next step <input name="next_step" type="text" value="${escapeHtml(o.next_step)}"></label>
          <label>Status <select name="status">${STATUSES.map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <button type="submit" class="opp-btn ghost">Save</button>
        </form>
        ${o.evidence ? `<details><summary>Why</summary><p>${escapeHtml(o.evidence).replace(/\n/g, '<br>')}</p></details>` : ''}
        <div class="opp-gap-actions">
          <button type="button" class="opp-btn" data-opp-act="emailopp" data-id="${o.id}">Draft email</button>
          <button type="button" class="opp-btn ghost" data-opp-act="delopp" data-id="${o.id}">Delete</button>
        </div></article>`).join('') || '<p class="opp-muted">None</p>'}
    </div>`;
  }).join('')}</div>`;
}

function productsHtml() {
  return `<p class="opp-note">Set a monthly price to see pipeline value. The email text is what “Draft email” starts from: {{first_name}}, {{client}}, {{evidence}}, {{price}} and {{sender}} are filled in. Windows 11 switches on once Atera device data is in the feed.</p>
    <div class="opp-products">${OPP.products.map(p => `<form class="opp-product" data-opp-product="${escapeHtml(p.key)}">
      <div class="opp-product-head"><strong>${escapeHtml(p.name)}</strong><span class="opp-muted">${escapeHtml([p.family, p.unit_note].filter(Boolean).join(' · '))}</span>
        <label class="opp-check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> In use</label></div>
      <p class="opp-muted">${escapeHtml(p.pitch)}</p>
      <div class="opp-product-prices">
        <label>£/month <input name="mrr" type="number" step="0.01" min="0" value="${p.default_mrr ?? ''}" placeholder="not set"></label>
        <label>£ one-off <input name="oneoff" type="number" step="0.01" min="0" value="${p.default_one_off ?? ''}" placeholder="none"></label>
      </div>
      <details><summary>Email text</summary>
        <label>Subject <input name="subject" type="text" value="${escapeHtml(p.email_subject)}"></label>
        <label>Body <textarea name="body" rows="10">${escapeHtml(p.email_body)}</textarea></label>
      </details>
      <button type="submit" class="opp-btn ghost">Save</button>
    </form>`).join('')}</div>`;
}

// ─── Events ───────────────────────────────────────────────────────────

async function onClick(event) {
  const tab = event.target.closest('[data-opp-tab]');
  if (tab) { OPP.tab = tab.dataset.oppTab; render(); return; }
  const btn = event.target.closest('[data-opp-act]');
  if (!btn || btn.disabled) return;
  const { oppAct: act, client, product, id } = btn.dataset;
  if (act === 'toggle') { OPP.open.has(client) ? OPP.open.delete(client) : OPP.open.add(client); render(); return; }
  if (act === 'reload') { load(); return; }
  if (act === 'connect') { try { await connectSupabase({ interactive: true }); load(); } catch (err) { toast(err.message || 'Could not connect', 'error'); } return; }
  if (act === 'checkall') { runChecks(OPP.clients); return; }
  if (act === 'checkone') { runChecks([findClient(client)], { force: true }); return; }
  if (act === 'adddomain') { addDomain(client, document.querySelector(`[data-opp-domain="${CSS.escape(client)}"]`)?.value); return; }
  if (act === 'add') { addOpportunity(client, product); return; }
  if (act === 'draft') { btn.disabled = true; addOpportunity(client, product, { draft: true }); return; }
  if (act === 'has') { setStatus(client, product, 'has'); return; }
  if (act === 'notint') { setStatus(client, product, 'not_interested'); return; }
  if (act === 'emailopp') { btn.disabled = true; draftEmail(Number(id)); return; }
  if (act === 'delopp') {
    if (!window.confirm('Delete this opportunity?')) return;
    try {
      const sb = await connectSupabase({ interactive: true });
      must(await sb.from('opportunities').delete().eq('id', Number(id)).select('id').single());
      OPP.opps = OPP.opps.filter(o => o.id !== Number(id));
      render();
    } catch (err) { toast('Could not delete: ' + (err.message || err), 'error'); }
  }
}

function onChange(event) {
  if (event.target.matches?.('[data-opp-act="showall"]')) { OPP.showAll = event.target.checked; render(); }
}

async function onSubmit(event) {
  const form = event.target;
  if (form.dataset.oppProduct) { event.preventDefault(); saveProduct(form.dataset.oppProduct, form.elements); return; }
  if (form.dataset.oppForm) {
    event.preventDefault();
    const f = form.elements;
    const patch = { mrr: Number(f.mrr.value) || 0, one_off: Number(f.one_off.value) || 0, next_step: f.next_step.value.trim(), status: f.status.value };
    try { await patchOpp(Number(form.dataset.oppForm), patch); toast(patch.status === 'won' ? `Won: +${money(patch.mrr)}/mo` : 'Saved', 'success'); render(); }
    catch (err) { toast('Could not save: ' + (err.message || err), 'error', 7000); }
  }
}

function onKeydown(event) {
  if (event.key === 'Enter' && event.target.matches?.('[data-opp-domain]')) {
    event.preventDefault();
    addDomain(event.target.dataset.oppDomain, event.target.value);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────

export function init() {
  const section = els('section-opportunities');
  section?.addEventListener('click', onClick);
  section?.addEventListener('change', onChange);
  section?.addEventListener('submit', onSubmit);
  section?.addEventListener('keydown', onKeydown);
  els('oppRefresh')?.addEventListener('click', load);
  load();
}

/** Exposed for tests: the thresholds the gap rules use. */
export { THRESHOLDS };
