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
import { toast, escapeHtml, syncTableLabels, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import {
  summariseDns, summarisePageSpeed, clientGaps, withoutOpen, pipelineTotals, fillTemplate,
  emailDomain, serviceLabel, renewalsDue, evaluate, THRESHOLDS, unitValue, dealState, jobFromDeal, boardColumns
} from '../core/opportunities.js';
import { followUpChoices, dueText } from '../core/activity.js';

const STATUSES = [['idea', 'Idea'], ['proposed', 'Proposed'], ['won', 'Won'], ['lost', 'Lost']];
const DEALER_SERVICES = ['voxone', 'voip_exchange', 'ethernet', 'leased_line', 'fttp', 'fttc', 'sogea', 'pstn', 'mobile', 'unknown'];
// What a product's client price is per (opportunity_products.price_unit); the first four multiply by a quantity.
const PRICE_UNITS = [['user', 'per user / month'], ['seat', 'per seat / month'], ['device', 'per device / month'], ['site', 'per site / month'],
  ['month', 'a month'], ['year', 'a year'], ['one-off', 'one-off']];
const PER_UNIT = { user: 'Users', seat: 'Seats', device: 'Devices', site: 'Sites' };
const optLabel = k => { const l = serviceLabel(k); return l[0].toUpperCase() + l.slice(1); };
const CONTRACTS = [['in_contract', 'In contract'], ['out_of_contract', 'Out of contract'], ['expiring', 'Expiring'], ['unknown', 'Unknown']];
const SIGNAL_MAX_AGE_DAYS = 30;   // re-check a domain after this long

const OPP = {
  tab: 'gaps',
  showAll: false,          // include "not bought, no evidence yet" gaps
  open: new Set(),         // expanded client cards
  stage: 'open',           // pipeline filter: open (idea + proposed) | idea | proposed | won | lost
  editing: new Set(),      // pipeline deals with the edit form showing
  loading: false,
  error: null,
  checking: null,          // { done, total, label } while checks run
  products: [], statuses: {}, manualDomains: [], signals: new Map(), opps: [], dealer: [],
  clients: [], latestMonth: '', feedNote: '', commission: null,
  view: (() => { try { return localStorage.getItem('gecko.opp.view') === 'board' ? 'board' : 'list'; } catch { return 'list'; } })()   // pipeline: list or board
};
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shortDate = k => new Date(String(k).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(ltd|limited|plc)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const els = id => document.getElementById(id);

// ─── Data ─────────────────────────────────────────────────────────────

async function readFeed() {
  const F = window.ProfitFeed;
  try {
    // The shell's loader: file or Supabase row, per CONFIG.DATA_BACKEND.feed.
    const data = await window.fetchProfitFeed();
    if (data == null) { OPP.feedNote = 'There is no profitability feed yet, so Xero and supplier data are left out.'; return null; }
    const check = F.validateFeed(data);
    if (!check.ok) { OPP.feedNote = 'The profitability feed failed its checks, so Xero and supplier data are left out.'; return null; }
    return data;
  } catch (err) {
    OPP.feedNote = 'The profitability feed could not be read (' + (err.message || err) + '), so Xero and supplier data are left out.';
    return null;
  }
}

/** The Refresh button: busy while it reloads, then says so (it gave no sign before). */
async function refresh() {
  const btn = els('oppRefresh');
  if (!btn || btn.disabled || OPP.loading) return;
  btn.disabled = true; btn.textContent = 'Refreshing…';
  try {
    await load();
    if (OPP.error) toast('Could not reload opportunities: ' + (OPP.error.message || OPP.error), 'error', 8000);
    else toast('Opportunities refreshed', 'success', 3000);
  } finally {
    btn.disabled = false; btn.textContent = 'Refresh';
  }
}

async function load() {
  OPP.loading = true; OPP.error = null; OPP.feedNote = '';
  render();
  try {
    const sb = await connectSupabase();
    const siteId = await resolveSiteId();
    const lists = await fetchAllLists();
    const listId = n => lists.find(l => l.displayName === n || l.name === n)?.id;

    const [products, statuses, domains, signals, opps, dealer, gClients, gServices, feed, ssaItems, tsItems] = await Promise.all([
      sb.from('opportunity_products').select('*').order('sort').then(must),
      sb.from('client_product_status').select('*').then(must),
      sb.from('client_domains').select('*').then(must),
      sb.from('client_signals').select('*').then(must),
      sb.from('opportunities').select('*').order('modified_at', { ascending: false }).then(must),
      sb.from('voip_dealer_services').select('*').order('client_name').then(must),
      window.clientListItems('gecko_clients', siteId, listId('GeckoClients'), 500),
      window.clientListItems('gecko_services', siteId, listId('GeckoServices'), 2000),
      readFeed(),
      // SSA list and Timesheets from wherever they live (database or SharePoint).
      window.ssaListItems('clients', siteId, listId('Clients')),
      window.ssaListItems('entries', siteId, listId('Timesheets'))
    ]);

    OPP.products = products;
    OPP.statuses = {};
    for (const s of statuses) (OPP.statuses[s.client_name] ||= {})[s.product_key] = s.status;
    OPP.manualDomains = domains;
    OPP.signals = new Map(signals.map(s => [`${s.kind}:${s.domain}`, s]));
    OPP.opps = opps;
    OPP.dealer = dealer;
    OPP.clients = buildClients({ gClients, gServices, feed, ssaItems, tsItems, domains, dealer });
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
function buildClients({ gClients, gServices, feed, ssaItems, tsItems, domains, dealer = [] }) {
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
      if (/voip\s*unlimited/i.test(xName)) continue;   // dealer commission, not a client
      const c = match(xName); if (c) c.mrr += Number(net) || 0;
    }
    // Dealer commission: VoIP Unlimited is invoiced each month in Xero for the
    // previous month's statement. Latest month that has it.
    OPP.commission = null;
    for (const m of Object.keys(feed.xero?.months || {}).sort().reverse()) {
      const hit = Object.entries(feed.xero.months[m]).find(([n]) => /voip\s*unlimited/i.test(n));
      if (hit) { OPP.commission = { month: m, net: Number(hit[1]) || 0 }; break; }
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

  // VoIP Unlimited dealer services; customers who aren't IT clients become prospects.
  for (const d of dealer) {
    let c = byKey.get(norm(d.client_name)) || match(d.client_name) || match(d.vu_name);
    if (!c) {
      c = add(d.client_name, { status: 'Prospect', dealerOnly: true });
      list.push(c);
      asPortal.push({ name: c.name, ref: c });
    }
    (c.dealer ||= []).push(d);
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
  const p = findProduct(o.product_key) || { name: o.title, email_subject: o.title, email_body: 'Hi {{first_name}},\n\n{{findings}}\n\n{{price}}\n\n{{sender}}' };
  const c = findClient(o.client_name) || {};
  // Client-facing findings, worked out afresh; o.evidence is our own notes and never goes out.
  const found = c.name && findProduct(o.product_key) ? evaluate(analyse(c).client, findProduct(o.product_key)) : null;
  const mail = fillTemplate(p, {
    client: o.client_name,
    firstName: String(c.contactName || '').split(/\s+/)[0],
    findings: found?.findings || [],
    mrr: o.mrr, oneOff: o.one_off, quantity: o.quantity,
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
    unit_price: num(form.unit_price.value), price_unit: form.price_unit.value,
    active: form.active.checked,
    email_subject: form.subject.value, email_body: form.body.value
  };
  if ([patch.default_mrr, patch.default_one_off, patch.unit_price].some(v => v != null && !(v >= 0))) { toast('Prices must be numbers', 'warning'); return; }
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
    (OPP.tab === 'gaps' ? gapsHtml() : OPP.tab === 'pipeline' ? pipelineHtml() : OPP.tab === 'voip' ? dealerHtml() : productsHtml());
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
    ['Won to date', money(t.wonMrr) + '/mo', 'added recurring revenue'],
    ['Dealer commission', OPP.commission ? money(OPP.commission.net) : '—',
      OPP.commission ? `VoIP Unlimited, invoiced ${new Date(OPP.commission.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : 'not in Xero yet']
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
  if (c.dealer?.length) {
    parts.push('VoIP Unlimited (dealer): ' + c.dealer.map(d => `${d.quantity > 1 ? d.quantity + ' × ' : ''}${serviceLabel(d.service)}`).join(', '));
  }
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
        <p class="opp-client-page">${clientLink(c.name)} <span class="opp-muted">· everything about this client</span></p>
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
        <span class="opp-name">${escapeHtml(c.name)}${c.dealerOnly ? ' <span class="opp-chip">VoIP Unlimited only</span>' : ''}</span>
        <span class="opp-chips">${chips || '<span class="opp-muted">no gaps</span>'}</span>
        <span class="opp-mrr">${c.mrr ? escapeHtml(money(c.mrr)) + '/mo' : '—'}</span>
      </button>${body}</section>`;
  }).join('');
}

function ago(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days)) return '';
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`;
}

function pipelineHtml() {
  if (!OPP.opps.length) return '<p class="opp-empty">Nothing in the pipeline yet. Open a client on the Gaps tab and choose “Add to pipeline”.</p>';
  const sum = list => list.reduce((t, o) => t + (Number(o.mrr) || 0), 0);
  const all = sum(OPP.opps) || 1;
  const stages = STATUSES.map(([key, label]) => {
    const items = OPP.opps.filter(o => o.status === key);
    const total = sum(items);
    const on = OPP.stage === key || (OPP.stage === 'open' && (key === 'idea' || key === 'proposed'));
    return `<button type="button" class="opp-stage st-${key}${on ? ' on' : ''}" data-opp-act="stage" data-stage="${key}" aria-pressed="${on}">
        <span class="opp-stage-label">${label}</span>
        <span class="opp-stage-value">${escapeHtml(money(total))}<small>/mo</small></span>
        <span class="opp-stage-count">${items.length} ${items.length === 1 ? 'deal' : 'deals'}</span>
        <span class="opp-stage-bar"><i style="width:${Math.round((total / all) * 100)}%"></i></span>
      </button>`;
  }).join('');
  const shown = OPP.opps
    .filter(o => (OPP.stage === 'open' ? o.status === 'idea' || o.status === 'proposed' : o.status === OPP.stage))
    .sort((a, b) => (Number(b.mrr) || 0) - (Number(a.mrr) || 0) || String(b.modified_at).localeCompare(String(a.modified_at)));
  const heading = OPP.stage === 'open' ? 'Open deals, biggest first' : `${STATUSES.find(([k]) => k === OPP.stage)[1]} deals`;
  const label = Object.fromEntries(STATUSES);
  const quick = o => (o.status === 'won' || o.status === 'lost'
    ? `<button type="button" class="opp-btn ghost" data-opp-act="move" data-status="proposed" data-id="${o.id}">Reopen</button>`
    : `${o.status === 'idea' ? `<button type="button" class="opp-btn ghost" data-opp-act="move" data-status="proposed" data-id="${o.id}">Mark proposed</button>` : ''}
       <button type="button" class="opp-btn win" data-opp-act="move" data-status="won" data-id="${o.id}">Won</button>
       <button type="button" class="opp-btn ghost" data-opp-act="move" data-status="lost" data-id="${o.id}">Lost</button>`);
  const t = todayKey();
  const flags = o => {
    const st = dealState(o, t);
    return [
      st.followUpDue ? `<span class="opp-flag ${st.followUpLate > 7 ? 'red' : 'amber'}">Follow up ${escapeHtml(dueText(o.follow_up_on, t))}</span>` : '',
      st.followUpSoon != null ? `<span class="opp-flag">Follow up ${escapeHtml(shortDate(o.follow_up_on))}</span>` : '',
      st.stale ? `<span class="opp-flag muted" title="Nothing changed on this deal for ${st.stale} days">Quiet ${st.stale} days</span>` : ''
    ].join('');
  };
  const nextSteps = o => {
    const st = dealState(o, t);
    if (!st.needsJob && !st.needsBilling && !(o.status === 'won' && (o.job_id || o.billing_set_up_at))) return '';
    return `<div class="opp-won-steps"><strong>Won: next steps</strong><ul>
      ${Number(o.one_off) > 0 ? `<li class="${o.job_id ? 'done' : ''}">${o.job_id ? '✓ Job created for the one-off part' : `Create the job for the one-off part (${escapeHtml(money(o.one_off))})`}
        ${o.job_id ? '<button type="button" class="opp-linkbtn" data-opp-act="openjobs">Open Jobs →</button>' : `<button type="button" class="opp-btn" data-opp-act="mkjob" data-id="${o.id}">Create job</button>`}</li>` : ''}
      ${Number(o.mrr) > 0 ? `<li class="${o.billing_set_up_at ? 'done' : ''}">${o.billing_set_up_at ? `✓ Monthly billing set up${o.billing_set_up_by ? ' by ' + escapeHtml(o.billing_set_up_by) : ''}` : `Set up the monthly billing: a repeating invoice in Xero for ${escapeHtml(money(o.mrr))}/mo + VAT, and the service line in Profitability`}
        ${o.billing_set_up_at ? '' : `<button type="button" class="opp-btn ghost" data-opp-act="billingdone" data-id="${o.id}">Mark done</button>`}</li>` : ''}
    </ul></div>`;
  };
  const deal = o => {
    const editing = OPP.editing.has(o.id);
    return `<article class="opp-deal st-${escapeHtml(o.status)}">
      <div class="opp-deal-main">
        <div class="opp-deal-client">${clientLink(o.client_name)}</div>
        <div class="opp-deal-product">${escapeHtml(findProduct(o.product_key)?.name || o.title)}</div>
        ${o.next_step ? `<div class="opp-deal-next"><span>Next</span> ${escapeHtml(o.next_step)}</div>` : ''}
        <div class="opp-flags">${flags(o)}</div>
      </div>
      <div class="opp-deal-value">
        <strong>${escapeHtml(money(o.mrr))}<small>/mo</small></strong>
        ${Number(o.one_off) ? `<span>+ ${escapeHtml(money(o.one_off))} one-off</span>` : ''}
        ${dealUnits(o)}
        <span class="opp-deal-meta"><b class="opp-dot"></b>${label[o.status] || escapeHtml(o.status)} · ${escapeHtml(ago(o.closed_at || o.modified_at))}</span>
      </div>
      <div class="opp-deal-actions">
        ${o.status !== 'won' && o.status !== 'lost' ? `<button type="button" class="opp-btn" data-opp-act="emailopp" data-id="${o.id}">Draft email</button>` : ''}
        ${quick(o)}
        <button type="button" class="opp-btn ghost" data-opp-act="editopp" data-id="${o.id}" aria-expanded="${editing}">${editing ? 'Close' : 'Edit'}</button>
      </div>
      ${editing ? `<form class="opp-item-form opp-deal-edit" data-opp-form="${o.id}">
          <label>£/month <input name="mrr" type="number" step="0.01" min="0" value="${escapeHtml(o.mrr)}"></label>
          <label>£ one-off <input name="one_off" type="number" step="0.01" min="0" value="${escapeHtml(o.one_off)}"></label>
          ${PER_UNIT[findProduct(o.product_key)?.price_unit] ? `<label>${PER_UNIT[findProduct(o.product_key).price_unit]} <input name="quantity" type="number" step="1" min="0" value="${escapeHtml(o.quantity ?? '')}" placeholder="how many"></label>` : ''}
          <label>Stage <select name="status">${STATUSES.map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wide">Next step <input name="next_step" type="text" value="${escapeHtml(o.next_step)}" placeholder="e.g. Call Chris on Tuesday"></label>
          <div class="opp-fu wide"><span>Follow up</span>
            <button type="button" class="opp-chip-btn" data-opp-fu="">None</button>
            ${followUpChoices(t).map(([l, d]) => `<button type="button" class="opp-chip-btn" data-opp-fu="${d}" title="${escapeHtml(shortDate(d))}">${l}</button>`).join('')}
            <input name="follow_up_on" type="date" value="${escapeHtml(String(o.follow_up_on || '').slice(0, 10))}" aria-label="Follow-up date">
          </div>
          <div class="opp-gap-actions wide">
            <button type="submit" class="opp-btn">Save</button>
            <button type="button" class="opp-btn ghost" data-opp-act="delopp" data-id="${o.id}">Delete</button>
          </div>
        </form>` : ''}
      ${nextSteps(o)}
      ${o.evidence ? `<details class="opp-deal-why"><summary>Why this opportunity</summary><p>${escapeHtml(o.evidence).replace(/\n/g, '<br>')}</p></details>` : ''}
    </article>`;
  };
  const states = OPP.opps.map(o => dealState(o, t));
  const dueN = states.filter(x => x.followUpDue).length, quietN = states.filter(x => x.stale).length;
  const setupN = states.filter(x => x.needsJob || x.needsBilling).length;
  const summary = [dueN && `<span class="opp-flag amber">${dueN} follow-up${dueN === 1 ? '' : 's'} due</span>`,
    quietN && `<span class="opp-flag muted">${quietN} quiet for ${14}+ days</span>`,
    setupN && `<span class="opp-flag green">${setupN} won deal${setupN === 1 ? '' : 's'} to set up</span>`].filter(Boolean).join('');
  const toggle = `<div class="opp-view" role="group" aria-label="Pipeline view">
      <button type="button" data-opp-act="view" data-view="list" aria-pressed="${OPP.view === 'list'}">List</button>
      <button type="button" data-opp-act="view" data-view="board" aria-pressed="${OPP.view === 'board'}">Board</button></div>`;
  if (OPP.view === 'board') {
    const card = o => `<div class="opp-card st-${escapeHtml(o.status)}">
        <div class="opp-card-top">${clientLink(o.client_name)}<strong>${escapeHtml(money(o.mrr))}<small>/mo</small></strong></div>
        <div class="opp-card-title">${escapeHtml(findProduct(o.product_key)?.name || o.title)}${Number(o.one_off) ? ` <span>+ ${escapeHtml(money(o.one_off))}</span>` : ''}</div>
        ${o.next_step ? `<div class="opp-card-next">${escapeHtml(o.next_step)}</div>` : ''}
        <div class="opp-flags">${flags(o)}${o.status === 'won' && (dealState(o, t).needsJob || dealState(o, t).needsBilling) ? '<span class="opp-flag green">To set up</span>' : ''}</div>
        <div class="opp-card-acts">${o.status === 'idea' ? `<button type="button" class="opp-linkbtn" data-opp-act="move" data-status="proposed" data-id="${o.id}">Proposed →</button>` : ''}
          ${o.status === 'idea' || o.status === 'proposed' ? `<button type="button" class="opp-linkbtn win" data-opp-act="move" data-status="won" data-id="${o.id}">Won</button><button type="button" class="opp-linkbtn" data-opp-act="move" data-status="lost" data-id="${o.id}">Lost</button>` : ''}
          <button type="button" class="opp-linkbtn" data-opp-act="openlist" data-id="${o.id}">Details</button></div>
      </div>`;
    const cols = boardColumns(OPP.opps, t).map(c => {
      const total = c.items.reduce((a, o) => a + (Number(o.mrr) || 0), 0);
      return `<section class="opp-col st-${c.key}"><header><strong>${label[c.key]}</strong><span>${c.items.length} · ${escapeHtml(money(total))}/mo</span></header>
        ${c.items.map(card).join('') || '<p class="opp-muted">None</p>'}</section>`;
    }).join('');
    return `<div class="opp-pipe-head">${toggle}<div class="opp-flags">${summary}</div></div>
      <div class="opp-board">${cols}</div><p class="opp-muted">Won and lost show the last 90 days.</p>`;
  }
  return `<div class="opp-pipe-head">${toggle}<div class="opp-flags">${summary}</div></div>
    <div class="opp-stages">${stages}</div>
    <div class="opp-deals-head"><strong>${heading}</strong>
      ${OPP.stage !== 'open' ? '<button type="button" class="opp-linkbtn" data-opp-act="stage" data-stage="open">Back to open deals</button>' : ''}</div>
    <div class="opp-deals">${shown.map(deal).join('') || '<p class="opp-muted">None at this stage.</p>'}</div>`;
}

/** A won deal's one-off part becomes a Job (once: jobs.source_ref = 'opp:<id>'), linked back to the deal. */
async function makeJob(id) {
  const o = OPP.opps.find(x => x.id === id);
  if (!o || o.job_id) return;
  try {
    const sb = await connectSupabase({ interactive: true });
    let job = must(await sb.from('jobs').select('id').eq('source_ref', `opp:${id}`).maybeSingle());
    if (!job) job = must(await sb.from('jobs').insert(jobFromDeal(o, myName())).select('id').single());
    await patchOpp(id, { job_id: job.id });
    toast(`Job created: ${o.title} (${money(o.one_off)}), Agreed. It's on the Jobs board.`, 'success', 6000);
  } catch (err) {
    toast('Could not create the job: ' + (err.message || err), 'error', 8000);
  } finally { render(); }
}

function dealerHtml() {
  const due = renewalsDue(OPP.dealer).length;
  const names = [...new Set(OPP.clients.map(c => c.name))].sort();
  const row = d => `<form class="opp-dealer-row" data-opp-dealer="${d.id}">
      <strong class="opp-dealer-client">${escapeHtml(d.client_name)}${d.vu_name && d.vu_name !== d.client_name ? `<small class="opp-muted"> · ${escapeHtml(d.vu_name)}</small>` : ''}</strong>
      <label>Service <select name="service">${DEALER_SERVICES.map(k => `<option value="${k}" ${k === d.service ? 'selected' : ''}>${escapeHtml(optLabel(k))}</option>`).join('')}</select></label>
      <label>Qty <input name="quantity" type="number" min="0" step="1" value="${escapeHtml(d.quantity)}"></label>
      <label>Contract <select name="contract">${CONTRACTS.map(([k, l]) => `<option value="${k}" ${k === d.contract ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Ends <input name="contract_end" type="date" value="${escapeHtml(d.contract_end || '')}"></label>
      <label>£ commission/mo <input name="commission" type="number" min="0" step="0.01" value="${d.commission ?? ''}" placeholder="?"></label>
      <label class="wide">Details <input name="extras" type="text" value="${escapeHtml(d.extras || '')}" placeholder="e.g. 100MB/100MB, 12 x maintenance"></label>
      <label class="wide">Notes <input name="notes" type="text" value="${escapeHtml(d.notes || '')}"></label>
      <div class="opp-gap-actions"><button type="submit" class="opp-btn ghost">Save</button><button type="button" class="opp-btn ghost" data-opp-act="deldealer" data-id="${d.id}">Remove</button></div>
    </form>`;
  return `<p class="opp-note">Customers on your VoIP Unlimited <strong>dealer</strong> account (they buy direct; you earn commission). They are not offered VoxOne or connectivity; out-of-contract lines and VoIP Exchange seats become opportunities instead.${due ? ` <strong>${due}</strong> out of contract or ending within 90 days.` : ''} Services you resell yourself stay as service lines on Profitability.</p>
    <form class="opp-dealer-row opp-dealer-add" data-opp-dealer="new">
      <strong class="opp-dealer-client">Add a dealer service</strong>
      <label class="wide">Client <input name="client_name" type="text" list="oppClientNames" required placeholder="Client name"></label>
      <datalist id="oppClientNames">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
      <label>Service <select name="service">${DEALER_SERVICES.map(k => `<option value="${k}">${escapeHtml(optLabel(k))}</option>`).join('')}</select></label>
      <label>Qty <input name="quantity" type="number" min="0" step="1" value="1"></label>
      <label>Contract <select name="contract">${CONTRACTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <div class="opp-gap-actions"><button type="submit" class="opp-btn">Add</button></div>
    </form>
    ${[...OPP.dealer].sort((a, b) => a.client_name.localeCompare(b.client_name)).map(row).join('') || '<p class="opp-muted">No dealer services recorded.</p>'}`;
}

async function saveDealer(id, f) {
  const patch = {
    service: f.service.value, quantity: Math.max(0, parseInt(f.quantity.value, 10) || 0), contract: f.contract.value
  };
  if (id === 'new') {
    patch.client_name = f.client_name.value.trim();
    if (!patch.client_name) { toast('Enter the client name', 'warning'); return; }
  } else {
    patch.contract_end = f.contract_end.value || null;
    patch.commission = f.commission.value === '' ? null : Number(f.commission.value);
    patch.extras = f.extras.value.trim();
    patch.notes = f.notes.value.trim();
  }
  try {
    const sb = await connectSupabase({ interactive: true });
    if (id === 'new') OPP.dealer.push(must(await sb.from('voip_dealer_services').insert(patch).select('*').single()));
    else {
      const row = must(await sb.from('voip_dealer_services').update(patch).eq('id', Number(id)).select('*').single());
      OPP.dealer = OPP.dealer.map(d => (d.id === row.id ? row : d));
    }
    toast('Saved', 'success');
    load();   // gaps depend on the dealer list
  } catch (err) { toast('Could not save: ' + (err.message || err), 'error', 7000); }
}

function dealUnits(o) {
  const p = findProduct(o.product_key);
  if (!p || p.unit_price == null || !PER_UNIT[p.price_unit] || !Number(o.quantity)) return '';
  const unit = PER_UNIT[p.price_unit].toLowerCase();
  return `<span>${escapeHtml(String(o.quantity))} ${escapeHtml(Number(o.quantity) === 1 ? unit.slice(0, -1) : unit)} × ${escapeHtml(money(p.unit_price))}</span>`;
}

function productsHtml() {
  return `<p class="opp-note"><strong>Client price</strong> is what the email quotes (“Hornetsecurity is £7.50 per user a month, plus VAT”); give an opportunity its number of users and the email adds the total. <strong>Pipeline £/month</strong> is the value a new opportunity starts with (for dealer products, your commission; never quoted). The email text is what “Draft email” starts from: {{first_name}}, {{client}}, {{evidence}}, {{price}} and {{sender}} are filled in. Windows 11 switches on once Atera device data is in the feed.</p>
    <div class="opp-products">${OPP.products.map(p => `<form class="opp-product" data-opp-product="${escapeHtml(p.key)}">
      <div class="opp-product-head"><strong>${escapeHtml(p.name)}</strong><span class="opp-muted">${escapeHtml([p.family, p.unit_note].filter(Boolean).join(' · '))}</span>
        <label class="opp-check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> In use</label></div>
      <p class="opp-muted">${escapeHtml(p.pitch)}</p>
      <div class="opp-product-prices">
        <label>Client price £ <input name="unit_price" type="number" step="0.01" min="0" value="${p.unit_price ?? ''}" placeholder="not set"></label>
        <label>per <select name="price_unit">${PRICE_UNITS.map(([k, l]) => `<option value="${k}" ${k === (p.price_unit || 'user') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Pipeline £/month <input name="mrr" type="number" step="0.01" min="0" value="${p.default_mrr ?? ''}" placeholder="not set"></label>
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
  const fu = event.target.closest('[data-opp-fu]');
  if (fu) { const input = fu.closest('form')?.elements.follow_up_on; if (input) input.value = fu.dataset.oppFu; return; }
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
  if (act === 'stage') { OPP.stage = OPP.stage === btn.dataset.stage ? 'open' : btn.dataset.stage; render(); return; }
  if (act === 'editopp') { const n = Number(id); OPP.editing.has(n) ? OPP.editing.delete(n) : OPP.editing.add(n); render(); return; }
  if (act === 'move') {
    btn.disabled = true;
    const o = OPP.opps.find(x => x.id === Number(id));
    try {
      await patchOpp(Number(id), { status: btn.dataset.status });
      const st = btn.dataset.status === 'won' ? dealState({ ...o, status: 'won' }, todayKey()) : null;
      toast(btn.dataset.status === 'won'
        ? `Won: +${money(o?.mrr)}/mo${st?.needsJob || st?.needsBilling ? `. Next: ${[st.needsJob && 'create the job', st.needsBilling && 'set up the monthly billing'].filter(Boolean).join(' and ')}.` : ''}`
        : `Moved to ${btn.dataset.status === 'lost' ? 'Lost' : 'Proposed'}`, 'success', 6000);
      if (btn.dataset.status === 'won') { OPP.stage = 'won'; OPP.view = 'list'; }
      render();
    } catch (err) { btn.disabled = false; toast('Could not update: ' + (err.message || err), 'error', 7000); }
    return;
  }
  if (act === 'emailopp') { btn.disabled = true; draftEmail(Number(id)); return; }
  if (act === 'view') { OPP.view = btn.dataset.view; try { localStorage.setItem('gecko.opp.view', OPP.view); } catch { /* per-browser only */ } render(); return; }
  if (act === 'openlist') {
    const o = OPP.opps.find(x => x.id === Number(id));
    OPP.view = 'list'; OPP.stage = o && (o.status === 'won' || o.status === 'lost') ? o.status : 'open'; OPP.editing.add(Number(id)); render();
    document.querySelector(`#section-opportunities [data-opp-form="${Number(id)}"]`)?.scrollIntoView({ block: 'center' });
    return;
  }
  if (act === 'mkjob') { btn.disabled = true; makeJob(Number(id)); return; }
  if (act === 'openjobs') { window.geckoGo?.('jobs', 'jobs'); return; }
  if (act === 'billingdone') {
    btn.disabled = true;
    try { await patchOpp(Number(id), { billing_set_up_at: new Date().toISOString(), billing_set_up_by: myName() }); toast('Monthly billing marked as set up', 'success'); }
    catch (err) { toast('Could not save: ' + (err.message || err), 'error', 7000); }
    render(); return;
  }
  if (act === 'deldealer') {
    if (!window.confirm('Remove this dealer service?')) return;
    try {
      const sb = await connectSupabase({ interactive: true });
      must(await sb.from('voip_dealer_services').delete().eq('id', Number(id)).select('id').single());
      OPP.dealer = OPP.dealer.filter(d => d.id !== Number(id));
      load();
    } catch (err) { toast('Could not remove: ' + (err.message || err), 'error'); }
    return;
  }
  if (act === 'delopp') {
    if (!window.confirm('Delete this opportunity?')) return;
    try {
      const sb = await connectSupabase({ interactive: true });
      must(await sb.from('opportunities').delete().eq('id', Number(id)).select('id').single());
      OPP.opps = OPP.opps.filter(o => o.id !== Number(id));
      OPP.editing.delete(Number(id));
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
  if (form.dataset.oppDealer) { event.preventDefault(); saveDealer(form.dataset.oppDealer, form.elements); return; }
  if (form.dataset.oppForm) {
    event.preventDefault();
    const f = form.elements;
    const patch = { mrr: Number(f.mrr.value) || 0, one_off: Number(f.one_off.value) || 0, next_step: f.next_step.value.trim(), status: f.status.value,
      follow_up_on: f.follow_up_on?.value || null };
    if (f.quantity) {
      const o = OPP.opps.find(x => x.id === Number(form.dataset.oppForm));
      patch.quantity = f.quantity.value.trim() === '' ? null : Math.max(0, Number(f.quantity.value) || 0);
      // A new quantity re-works the monthly value from the client price, unless £/month was changed by hand too.
      const auto = unitValue(findProduct(o?.product_key), patch.quantity);
      if (auto != null && patch.quantity !== (o?.quantity ?? null) && String(f.mrr.value) === String(o?.mrr ?? '')) patch.mrr = auto;
    }
    try { await patchOpp(Number(form.dataset.oppForm), patch); OPP.editing.delete(Number(form.dataset.oppForm)); toast(patch.status === 'won' ? `Won: +${money(patch.mrr)}/mo` : 'Saved', 'success'); render(); }
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

/** Open a tab from elsewhere (client page, Overview): 'gaps', 'pipeline', 'voip', 'products'. */
export function show(tab) {
  if (!tab || !['gaps', 'pipeline', 'voip', 'products'].includes(tab)) return;
  OPP.tab = tab;
  if (!OPP.loading) render();
}

/** Something added elsewhere (a client page's New opportunity): reload if this section has been opened. */
export function reload() {
  if (OPP.started && !OPP.loading) load();
}

export function init() {
  OPP.started = true;
  const section = els('section-opportunities');
  section?.addEventListener('click', onClick);
  section?.addEventListener('change', onChange);
  section?.addEventListener('submit', onSubmit);
  section?.addEventListener('keydown', onKeydown);
  els('oppRefresh')?.addEventListener('click', refresh);
  load();
}

/** Exposed for tests: the thresholds the gap rules use. */
export { THRESHOLDS };
