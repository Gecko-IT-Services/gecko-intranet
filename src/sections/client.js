/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   CLIENT PAGE                                                     ║
   ║                                                                   ║
   ║   One client, everything about them, from every section: what     ║
   ║   they're billed in Xero and owe, their service lines and margin, ║
   ║   SSA hours and the work logged, jobs, opportunities, phones      ║
   ║   and lines with VoIP Unlimited. Opened from any client name      ║
   ║   (window.openClient). Part of the Clients hub. Read only: each   ║
   ║   tab links to the section where things are changed.              ║
   ║   Logic: core/client.js. Design: docs/superpowers/specs/          ║
   ║   2026-10-09-gecko-hq-structure-design.md                         ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, syncTableLabels } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { balances } from '../core/timesheets.js';
import { clientProfile, sameClient } from '../core/client.js';
import { previousMonth, stageLabel } from '../core/jobs.js';
import { tabsHtml, moveInk, keyNav, direction } from '../core/tabs.js';
import { newOpportunity } from '../core/opportunities.js';
import { ROLES, cleanContact, contactsFor, mainContact, duplicateEmail } from '../core/contacts.js';

// adding: the New opportunity form is open (with what's been picked so far); saving: one insert at a time.
// contactEdit: null, 'new' or the id of the contact being edited.
const CL = { name: '', tab: 'summary', data: null, loading: false, error: null, dir: '', seq: 0, adding: null, saving: false, contactEdit: null };
const TABS = ['summary', 'contacts', 'invoices', 'services', 'support', 'jobs', 'opportunities'];

const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const settle = p => p.then(v => ({ v }), e => ({ e }));
const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const whole = n => '£' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const hours = h => (Number(h) || 0).toFixed(2).replace(/\.?0+$/, '') + 'h';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = d => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const shortMonth = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' });
const longMonth = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const XERO_VIEW = 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=';
const go = (section, tab, label, cls = 'cl-btn ghost') => `<button type="button" class="${cls}" data-cl-go="${escapeHtml(section + (tab ? ':' + tab : ''))}">${escapeHtml(label)}</button>`;

/** The client open now ('' = none): the Clients hub shows it as a tab. */
export const current = () => CL.name;

/** Open a client's page (from any client name in the app). */
export function open(name, tab = 'summary') {
  name = String(name || '').trim();
  if (!name) return;
  const same = sameClient(name, CL.name) && CL.data;
  CL.name = name;
  CL.dir = '';
  CL.tab = TABS.includes(tab) ? tab : 'summary';
  if (!same) { CL.data = null; CL.adding = null; CL.contactEdit = null; load(); }
  render();
}

// ─── Data ─────────────────────────────────────────────────────────────

const XERO_COLS = 'invoice_id,invoice_number,contact_id,contact_name,invoice_date,due_date,status,reference,sub_total,total,amount_due,repeating_invoice_id';

async function load() {
  const seq = ++CL.seq;
  const name = CL.name;
  CL.loading = true; CL.error = null; render();
  try {
    const sb = await connectSupabase();
    let from = today().slice(0, 7);
    for (let i = 0; i < 12; i++) from = previousMonth(from);
    const q = (table, cols = '*') => settle(sb.from(table).select(cols).then(must));
    const [gecko, services, ssaClients, recent, unpaid, jobs, opps, dealer, domains, products, contacts] = await Promise.all([
      q('gecko_clients', 'title,status,contract_start,notes'),
      q('gecko_services', 'title,client_name,category,cost_per_month,sell_per_month'),
      q('ssa_clients'),
      settle(sb.from('xero_invoices').select(XERO_COLS).gte('invoice_date', from + '-01').then(must)),
      settle(sb.from('xero_invoices').select(XERO_COLS).eq('status', 'AUTHORISED').gt('amount_due', 0).then(must)),
      q('jobs', 'id,client_name,title,status,value,target_date,invoice_ref,next_step,owner,modified_at'),
      q('opportunities', 'id,client_name,product_key,title,status,mrr,one_off,quantity,next_step,modified_at'),
      q('voip_dealer_services', 'client_name,vu_name,service,quantity,contract,contract_end,extras'),
      q('client_domains', 'client_name,domain'),
      q('opportunity_products', 'key,family,name,unit_price,price_unit,default_mrr,default_one_off,unit_note,active,sort'),
      q('client_contacts')
    ]);
    // SSA: this client's balance (opening + changes, as Timesheets has it) and its entries
    const ssaRow = ssaClients.v?.find(c => sameClient(c.name, name)) || null;
    let ssa = null, entries = null, ssaError = ssaClients.e;
    if (ssaRow) {
      const r = await settle(sb.from('timesheet_entries').select('id,client_id,engineer,entry_date,hours,title,work_description,deleted_at,opening_hours').eq('client_id', ssaRow.id).then(must));
      if (r.e) ssaError = r.e;
      else {
        entries = r.v;
        const b = balances([ssaRow], entries).get(String(ssaRow.id));
        ssa = { id: ssaRow.id, purchased: b.purchased, used: b.used, remaining: b.remaining, archived: ssaRow.archived, contact: ssaRow.primary_contact, email: ssaRow.email, folder: ssaRow.client_folder };
      }
    }
    const invoices = recent.v && unpaid.v ? [...new Map([...recent.v, ...unpaid.v].map(i => [i.invoice_id, i])).values()] : null;
    if (seq !== CL.seq) return;
    const g = gecko.v?.find(c => sameClient(c.title, name)) || null;
    CL.data = {
      profile: clientProfile({
        name, gecko: g, invoices,
        services: services.v || null, ssa, entries,
        jobs: jobs.v || null, opps: opps.v || null, dealer: dealer.v || null, domains: domains.v || null
      }, today()),
      hasSsa: !!ssaRow,
      contacts: contacts.v ? contactsFor(contacts.v, name) : null,
      products: (products.v || []).filter(x => x.active !== false).sort((a, b) => String(a.family).localeCompare(String(b.family)) || (a.sort ?? 0) - (b.sort ?? 0)),
      errors: {
        xero: recent.e?.message || unpaid.e?.message || '', services: services.e?.message || '', ssa: ssaError?.message || '',
        jobs: jobs.e?.message || '', opps: opps.e?.message || '', dealer: dealer.e?.message || '',
        contacts: contacts.e ? (/client_contacts/.test(contacts.e.message || '') ? 'the contacts table isn’t in the database yet (it arrives with this update)' : contacts.e.message) : ''
      }
    };
  } catch (err) {
    if (seq === CL.seq) CL.error = err;
  } finally {
    if (seq === CL.seq) { CL.loading = false; render(); }
  }
}

// ─── Render ───────────────────────────────────────────────────────────

function render() {
  const head = els('clHead'), mount = els('clWrap');
  if (!mount) return;
  if (!CL.name) {
    if (head) head.innerHTML = '';
    mount.innerHTML = '<p class="cl-empty">Choose a client from the Directory, or click any client name in Gecko HQ.</p>';
    return;
  }
  const p = CL.data?.profile;
  if (head) head.innerHTML = headHtml(p);
  const strip = head?.querySelector('.app-tabs');
  if (strip) moveInk(strip);
  if (CL.error) {
    mount.innerHTML = CL.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="cl-error"><strong>Connect to the Gecko database</strong>Client pages read the database. <button type="button" class="cl-btn" data-cl-act="connect">Connect</button></div>'
      : `<div class="cl-error"><strong>Could not load ${escapeHtml(CL.name)}.</strong>${escapeHtml(CL.error.message || CL.error)} <button type="button" class="cl-btn" data-cl-act="reload">Retry</button></div>`;
    return;
  }
  if (!p) { mount.innerHTML = `<p class="cl-empty">Loading ${escapeHtml(CL.name)}…</p>`; return; }
  const pane = { summary: summaryHtml, contacts: contactsHtml, invoices: invoicesHtml, services: servicesHtml, support: supportHtml, jobs: jobsHtml, opportunities: oppsHtml }[CL.tab] || summaryHtml;
  mount.innerHTML = `<div class="app-pane ${CL.dir}">${pane(p, CL.data.errors)}</div>`;
  CL.dir = '';
  syncTableLabels(mount);
}

function headHtml(p) {
  const x = p?.xero, s = p?.support;
  const status = p?.gecko?.status || (p ? 'Not on Profitability' : '');
  const main = mainContact(CL.data?.contacts, { name: s?.contact || '', email: s?.email || '' });
  const contact = main ? [main.name, main.role && `(${main.role})`].filter(Boolean).join(' ') : '', email = main?.email || '', phone = main?.phone || '';
  const kpi = (label, value, sub, cls = '') => `<div class="cl-kpi ${cls}"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${sub}</small></div>`;
  const tabs = [
    { key: 'summary', label: 'Summary', badge: p?.flags.filter(f => f.level !== 'info').length || '' , warn: p?.flags.some(f => f.level === 'red') },
    { key: 'contacts', label: 'Contacts', badge: CL.data?.contacts?.length || '' },
    { key: 'invoices', label: 'Invoices', badge: x?.overdue > 0 ? 'overdue' : '', warn: x?.overdue > 0 },
    { key: 'services', label: 'Services & profit' },
    { key: 'support', label: 'Support hours', badge: s && s.remaining < 2 ? hours(s.remaining) : '', warn: s && s.remaining <= 0 },
    { key: 'jobs', label: 'Jobs', badge: p?.openJobs?.length || '' },
    { key: 'opportunities', label: 'Opportunities', badge: p?.openOpps?.length || '' }
  ];
  return `
    <div class="cl-id">
      <div class="cl-av" aria-hidden="true">${escapeHtml(initials(CL.name))}</div>
      <div class="cl-id-text">
        <h1>${escapeHtml(CL.name)}</h1>
        <p>${[status && `<span class="cl-chip">${escapeHtml(status)}</span>`,
              contact && escapeHtml(contact),
              email && `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`,
              phone && `<a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a>`,
              p?.domains?.length ? escapeHtml(p.domains.join(', ')) : '',
              p?.gecko?.contract_start ? `client since ${escapeHtml(fmtDate(p.gecko.contract_start))}` : ''].filter(Boolean).join(' · ')}</p>
      </div>
      <div class="cl-id-actions">
        ${go('timesheets', 'log', 'Log time', 'cl-btn')}
        <button type="button" class="cl-btn ghost" data-cl-act="new-opp">+ Opportunity</button>
        <button type="button" class="cl-btn ghost" data-cl-act="reload" title="Reload this client">Refresh</button>
      </div>
    </div>
    ${p ? `<div class="cl-kpis">
      ${kpi('Recurring', x ? whole(x.recurringMonthly) + '<em>/mo</em>' : '—', x ? `billed in ${escapeHtml(longMonth(x.lastMonth.month))}` : 'Xero not loaded')}
      ${kpi('Last 12 months', x ? whole(x.year) : '—', x ? 'invoiced, net of VAT' : '')}
      ${kpi('Owed', x ? whole(x.owed) : '—', x ? (x.overdue > 0 ? `<b class="bad">${escapeHtml(money(x.overdue))} overdue</b>` : 'nothing overdue') : '', x?.overdue > 0 ? 'warn' : '')}
      ${s ? kpi('Support hours left', hours(s.remaining), `of ${hours(s.purchased)} prepaid${s.monthsLeft != null ? ` · ~${s.monthsLeft} months at current use` : ''}`, s.remaining < 2 ? 'warn' : '')
          : p.services ? kpi('Service margin', p.services.sell ? whole(p.services.margin) + '<em>/mo</em>' : '—', p.services.pct != null ? `${Math.round(p.services.pct * 100)}% on ${escapeHtml(whole(p.services.sell))}/mo` : 'no service lines') : kpi('Support', '—', '')}
    </div>` : ''}
    ${tabsHtml(tabs, CL.tab, { attr: 'data-cl-tab', controls: 'clWrap', label: 'Client views' })}`;
}

const panel = (title, body, aside = '') => `<div class="cl-panel"><div class="cl-panel-head"><strong>${title}</strong>${aside}</div>${body}</div>`;
const note = msg => `<p class="cl-muted">${escapeHtml(msg)}</p>`;
const failed = (what, err) => `<p class="cl-warn">${escapeHtml(what)} didn’t load: ${escapeHtml(err)}</p>`;

function summaryHtml(p, errors) {
  const flags = p.flags.length
    ? `<ul class="cl-flags">${p.flags.map(f => `<li class="${f.level}"><span class="dot" aria-hidden="true"></span><span>${escapeHtml(f.text)}</span><button type="button" class="cl-btn ghost" data-cl-tab="${f.tab}">View</button></li>`).join('')}</ul>`
    : '<p class="cl-ok">✓ Nothing needs doing for this client.</p>';
  const missing = Object.entries(errors).filter(([, e]) => e).map(([k]) => k);
  const jobs = p.openJobs?.length
    ? `<ul class="cl-mini">${p.openJobs.slice(0, 4).map(j => `<li><span>${escapeHtml(j.title)}</span><span>${escapeHtml(stageLabel(j.status))}${j.value != null ? ' · ' + escapeHtml(whole(j.value)) : ''}</span></li>`).join('')}</ul>` : note('No open jobs.');
  const opps = p.openOpps?.length
    ? `<ul class="cl-mini">${p.openOpps.slice(0, 4).map(o => `<li><span>${escapeHtml(o.title)}</span><span>${o.status === 'proposed' ? 'proposed' : 'idea'}${Number(o.mrr) ? ' · +' + escapeHtml(whole(o.mrr)) + '/mo' : ''}</span></li>`).join('')}</ul>` : note('No open opportunities.');
  return `<div class="cl-grid">
      ${panel('Needs attention', flags + (missing.length ? `<p class="cl-warn">Not checked: ${escapeHtml(missing.join(', '))}.</p>` : ''))}
      ${panel('Billed, last 12 months', p.xero ? histHtml(p.xero.history) : failed('Xero', errors.xero || 'not connected'), go('client', 'invoices', 'Invoices →', 'cl-link'))}
    </div>
    <div class="cl-grid even">
      ${panel('Open jobs', jobs, go('client', 'jobs', 'All jobs →', 'cl-link'))}
      ${panel('Opportunities', opps, go('client', 'opportunities', 'All →', 'cl-link'))}
    </div>
    ${p.dealer?.length ? panel('With VoIP Unlimited (dealer)', `<ul class="cl-mini">${p.dealer.map(d => `<li><span>${escapeHtml(`${d.quantity > 1 ? d.quantity + ' × ' : ''}${d.service.replace(/_/g, ' ')}`)}</span><span>${escapeHtml(d.contract.replace(/_/g, ' '))}${d.contract_end ? ' · ends ' + escapeHtml(fmtDate(d.contract_end)) : ''}</span></li>`).join('')}</ul>`, go('opportunities', 'voip', 'VoIP Unlimited →', 'cl-link')) : ''}`;
}

function histHtml(history) {
  const max = Math.max(1, ...history.map(h => h.total));
  const pct = v => (v / max * 100).toFixed(2);
  return `<div class="cl-hist" role="list">${history.map((h, i) => `<div class="cl-hist-col${i === history.length - 1 ? ' cur' : ''}" role="listitem" title="${escapeHtml(`${longMonth(h.month)}: recurring ${money(h.recurring)}, one-off ${money(h.oneOff)}`)}">
      <div class="cl-hist-bar">${h.oneOff > 0 ? `<i class="v-one" style="height:${pct(h.oneOff)}%"></i>` : ''}${h.recurring > 0 ? `<i class="v-rec" style="height:${pct(h.recurring)}%"></i>` : ''}</div>
      <span>${escapeHtml(shortMonth(h.month)[0])}</span></div>`).join('')}</div>
    <ul class="cl-legend"><li><b class="v-rec"></b>Recurring</li><li><b class="v-one"></b>One-off</li></ul>`;
}

function badge(inv, t) {
  if (inv.status === 'PAID' || Number(inv.amount_due) <= 0) return '<span class="cl-st paid">Paid</span>';
  if (inv.status === 'DRAFT' || inv.status === 'SUBMITTED') return '<span class="cl-st draft">Draft</span>';
  return inv.due_date && String(inv.due_date) < t ? '<span class="cl-st late">Overdue</span>' : '<span class="cl-st due">Due</span>';
}

function invoicesHtml(p, errors) {
  if (!p.xero) return panel('Invoices', failed('Xero', errors.xero || 'not connected'));
  const t = today();
  const row = i => `<tr><td><a href="${XERO_VIEW}${encodeURIComponent(i.invoice_id)}" target="_blank" rel="noopener">${escapeHtml(i.invoice_number || 'no number')}</a></td>
      <td>${escapeHtml(fmtDate(i.invoice_date))}</td><td>${escapeHtml(i.reference || (String(i.repeating_invoice_id || '').trim() ? 'Repeating' : ''))}</td>
      <td>${badge(i, t)}</td><td class="num">${escapeHtml(money(i.sub_total))}</td><td class="num">${Number(i.amount_due) > 0 ? escapeHtml(money(i.amount_due)) : '—'}</td></tr>`;
  const table = list => `<table class="cl-table"><thead><tr><th>Invoice</th><th>Date</th><th>Reference</th><th>Status</th><th class="num">Net</th><th class="num">Due (incl. VAT)</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>`;
  return `${panel(`Unpaid: ${escapeHtml(money(p.xero.owed))}`, p.xero.unpaid.length ? table(p.xero.unpaid) : '<p class="cl-ok">✓ Nothing unpaid.</p>',
      p.xero.unpaid.length ? go('jobs', 'owed', 'Nudge from Owed to us →', 'cl-link') : '')}
    ${panel('Recent invoices', p.xero.recent.length ? table(p.xero.recent) : note('No invoices in Xero for this client in the last 12 months.'),
      `<span class="cl-muted">${escapeHtml(p.xero.contacts.length ? 'Xero contact: ' + p.xero.contacts.join(', ') : 'No Xero contact matched this name')}</span>`)}`;
}

function servicesHtml(p, errors) {
  if (!p.services) return panel('Service lines', failed('Service lines', errors.services || 'unknown error'));
  const s = p.services;
  const body = s.lines.length ? `
      <div class="cl-margin" role="img" aria-label="${escapeHtml(`Cost ${money(s.cost)}, margin ${money(s.margin)} a month`)}">
        <i class="cost" style="width:${s.sell ? (Math.min(s.cost, s.sell) / s.sell * 100).toFixed(1) : 0}%"></i><i class="v-rec" style="width:${s.sell ? (Math.max(0, s.margin) / s.sell * 100).toFixed(1) : 0}%"></i>
      </div>
      <ul class="cl-legend"><li><b class="cost"></b>Cost ${escapeHtml(money(s.cost))}</li><li><b class="v-rec"></b>Margin ${escapeHtml(money(s.margin))}${s.pct != null ? ` (${Math.round(s.pct * 100)}%)` : ''}</li></ul>
      <table class="cl-table"><thead><tr><th>Service</th><th>Type</th><th class="num">Sell /mo</th><th class="num">Cost /mo</th><th class="num">Margin</th></tr></thead>
      <tbody>${s.lines.map(l => `<tr><td>${escapeHtml(l.title)}</td><td>${escapeHtml(l.category)}</td><td class="num">${escapeHtml(money(l.sell))}</td><td class="num">${escapeHtml(money(l.cost))}</td><td class="num${l.margin < 0 ? ' bad' : ''}">${escapeHtml(money(l.margin))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td></td><td class="num">${escapeHtml(money(s.sell))}</td><td class="num">${escapeHtml(money(s.cost))}</td><td class="num">${escapeHtml(money(s.margin))}</td></tr></tfoot></table>
      <p class="cl-muted">Typed service lines. Licence and hosting costs that come from supplier invoices are on Profitability, month by month.</p>`
    : note('No service lines for this client yet.');
  return panel('What they buy from us', body, go('profitability', '', 'Edit on Profitability →', 'cl-link')) +
    (p.dealer?.length ? panel('With VoIP Unlimited (dealer, commission to Gecko)', `<table class="cl-table"><thead><tr><th>Service</th><th class="num">Qty</th><th>Contract</th><th>Ends</th></tr></thead><tbody>${p.dealer.map(d => `<tr><td>${escapeHtml(d.service.replace(/_/g, ' '))}${d.extras ? ` <span class="cl-muted">${escapeHtml(d.extras)}</span>` : ''}</td><td class="num">${d.quantity}</td><td>${escapeHtml(d.contract.replace(/_/g, ' '))}</td><td>${escapeHtml(fmtDate(d.contract_end)) || '—'}</td></tr>`).join('')}</tbody></table>`) : '');
}

function supportHtml(p, errors) {
  const s = p.support;
  if (!s) {
    if (errors.ssa) return panel('Support hours', failed('SSA balances', errors.ssa));
    return panel('Support hours', `${note('This client has no prepaid support (SSA) block.')}${p.openOpps?.some(o => /support|ssa|retainer/i.test(o.title)) ? '' : go('opportunities', '', 'Suggest one in Opportunities →', 'cl-link')}`);
  }
  const used = Math.max(0, Math.min(1, s.purchased ? (s.purchased - Math.max(0, s.remaining)) / s.purchased : 1));
  const maxH = Math.max(1, ...s.perMonth.map(m => m.hours));
  const gauge = `<div class="cl-gauge ${s.remaining <= 0 ? 'out' : s.remaining < 2 ? 'low' : ''}" style="--used:${(used * 100).toFixed(1)}">
      <div class="cl-gauge-ring" aria-hidden="true"></div>
      <div class="cl-gauge-text"><strong>${escapeHtml(hours(s.remaining))}</strong><span>left of ${escapeHtml(hours(s.purchased))}</span></div></div>`;
  const months = `<div class="cl-bars">${s.perMonth.map(m => `<div title="${escapeHtml(`${longMonth(m.month)}: ${hours(m.hours)}`)}"><i style="height:${(m.hours / maxH * 100).toFixed(1)}%"></i><span>${escapeHtml(shortMonth(m.month))}</span><em>${m.hours ? escapeHtml(hours(m.hours)) : ''}</em></div>`).join('')}</div>`;
  const rows = s.recent.map(e => `<tr><td>${escapeHtml(fmtDate(e.entry_date))}</td><td>${escapeHtml(e.engineer)}</td><td>${escapeHtml(e.work_description || e.title || '')}</td><td class="num">${escapeHtml(hours(e.hours))}</td></tr>`).join('');
  return `<div class="cl-grid">
      ${panel('Prepaid support', `<div class="cl-support">${gauge}<ul class="cl-mini">
          <li><span>Used</span><span>${escapeHtml(hours(s.used))}</span></li>
          <li><span>Last 90 days</span><span>${escapeHtml(hours(s.last90))}</span></li>
          <li><span>At that rate</span><span>${s.monthsLeft != null ? `~${s.monthsLeft} months left` : s.remaining <= 0 ? 'renew now' : 'no recent work'}</span></li>
        </ul></div>`, go('timesheets', 'ssa', 'Renew on SSA →', 'cl-link'))}
      ${panel('Hours a month', months)}
    </div>
    ${panel('Recent work', rows ? `<table class="cl-table"><thead><tr><th>Date</th><th>Who</th><th>Work</th><th class="num">Hours</th></tr></thead><tbody>${rows}</tbody></table>` : note('No time logged yet.'), go('timesheets', 'log', 'Log time →', 'cl-link'))}`;
}

function jobsHtml(p, errors) {
  if (!p.jobs) return panel('Jobs', failed('Jobs', errors.jobs || 'unknown error'));
  if (!p.jobs.length) return panel('Jobs', note('No jobs for this client yet.'), go('jobs', 'jobs', 'Add one in Jobs →', 'cl-link'));
  const order = ['to_invoice', 'in_progress', 'agreed', 'quoted', 'invoiced', 'lost'];
  const list = [...p.jobs].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || String(b.modified_at || '').localeCompare(String(a.modified_at || '')));
  return panel(`Jobs (${p.openJobs.length} open)`, `<table class="cl-table"><thead><tr><th>Job</th><th>Stage</th><th>Target</th><th>Invoice</th><th class="num">Value</th></tr></thead>
    <tbody>${list.map(j => `<tr><td>${escapeHtml(j.title)}${j.next_step ? `<div class="cl-muted">Next: ${escapeHtml(j.next_step)}</div>` : ''}</td><td><span class="cl-stage s-${escapeHtml(j.status)}">${escapeHtml(stageLabel(j.status))}</span></td>
      <td>${escapeHtml(fmtDate(j.target_date)) || '—'}</td><td>${escapeHtml(j.invoice_ref || '—')}</td><td class="num">${j.value != null ? escapeHtml(money(j.value)) : '—'}</td></tr>`).join('')}</tbody></table>`,
    go('jobs', 'jobs', 'Open Jobs →', 'cl-link'));
}

function oppsHtml(p, errors) {
  if (!p.opps) return panel('Opportunities', failed('Opportunities', errors.opps || 'unknown error'));
  const add = `<button type="button" class="cl-btn" data-cl-act="new-opp">+ New opportunity</button>`;
  const form = CL.adding ? newOppHtml(p) : '';
  if (!p.opps.length) return form + panel('Opportunities', note('Nothing in the pipeline for this client. Add one, or see what they don’t buy yet in Opportunities › Gaps.'), (CL.adding ? '' : add) + go('opportunities', 'gaps', 'Find gaps →', 'cl-link'));
  const label = { idea: 'Idea', proposed: 'Proposed', won: 'Won', lost: 'Lost' };
  return form + panel('Opportunities', `<table class="cl-table"><thead><tr><th>Opportunity</th><th>Stage</th><th>Next step</th><th class="num">£/month</th><th class="num">One-off</th></tr></thead>
    <tbody>${p.opps.map(o => `<tr><td>${escapeHtml(o.title)}</td><td><span class="cl-stage o-${escapeHtml(o.status)}">${escapeHtml(label[o.status] || o.status)}</span></td><td>${escapeHtml(o.next_step || '—')}</td>
      <td class="num">${Number(o.mrr) ? escapeHtml(money(o.mrr)) : '—'}</td><td class="num">${Number(o.one_off) ? escapeHtml(money(o.one_off)) : '—'}</td></tr>`).join('')}</tbody></table>`,
    (CL.adding ? '' : add) + go('opportunities', 'pipeline', 'Pipeline →', 'cl-link'));
}

// ─── Contacts (Philip, 9 Oct: contacts per client) ───────────────────

function contactsHtml() {
  const list = CL.data.contacts;
  if (!list) return panel('Contacts', failed('Contacts', CL.data.errors.contacts || 'unknown error'));
  const add = '<button type="button" class="cl-btn" data-cl-act="contact-add">+ Add contact</button>';
  const form = CL.contactEdit === 'new' ? contactFormHtml(null) : '';
  const cards = list.map(c => CL.contactEdit === c.id ? contactFormHtml(c) : `
    <div class="cl-contact${c.is_main ? ' main' : ''}">
      <div class="cl-contact-av" aria-hidden="true">${escapeHtml(initials(c.name || c.email))}</div>
      <div class="cl-contact-body">
        <strong>${escapeHtml(c.name || c.email)}</strong>${c.is_main ? '<span class="cl-chip">Main contact</span>' : ''}
        ${c.role ? `<span class="cl-contact-role">${escapeHtml(c.role)}</span>` : ''}
        <span class="cl-contact-lines">
          ${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : ''}
          ${c.phone ? `<a href="tel:${escapeHtml(c.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(c.phone)}</a>` : ''}
        </span>
        ${c.notes ? `<span class="cl-muted">${escapeHtml(c.notes)}</span>` : ''}
      </div>
      <div class="cl-contact-acts">
        ${c.is_main ? '' : `<button type="button" class="cl-link" data-cl-act="contact-main" data-id="${c.id}">Make main</button>`}
        <button type="button" class="cl-link" data-cl-act="contact-edit" data-id="${c.id}">Edit</button>
        <button type="button" class="cl-link muted" data-cl-act="contact-del" data-id="${c.id}">Remove</button>
      </div>
    </div>`).join('');
  return form + panel(`Contacts (${list.length})`,
    list.length ? `<div class="cl-contacts">${cards}</div>` : note('No contacts yet. Add the people you deal with: owner, accounts, office manager.'),
    CL.contactEdit === 'new' ? '' : add);
}

function contactFormHtml(c) {
  const v = c || { is_main: !CL.data.contacts?.length };
  return panel(c ? `Edit ${escapeHtml(c.name || c.email)}` : 'New contact', `<form class="cl-form" data-cl-form="contact" data-id="${c ? c.id : 'new'}" novalidate>
      <label>Name <input name="name" type="text" maxlength="120" autocomplete="off" value="${escapeHtml(v.name || '')}" placeholder="e.g. Chris Wyeth"></label>
      <label>Role <input name="role" type="text" maxlength="60" list="clRoles" value="${escapeHtml(v.role || '')}" placeholder="e.g. Accounts"></label>
      <label>Email <input name="email" type="email" maxlength="200" autocomplete="off" value="${escapeHtml(v.email || '')}" placeholder="name@company.co.uk"></label>
      <label>Phone <input name="phone" type="tel" maxlength="40" value="${escapeHtml(v.phone || '')}" placeholder="e.g. 01234 567890"></label>
      <label class="wide">Notes <input name="notes" type="text" maxlength="500" value="${escapeHtml(v.notes || '')}" placeholder="e.g. Works Tue–Thu; prefers email"></label>
      <label class="cl-check wide"><input name="is_main" type="checkbox"${v.is_main ? ' checked' : ''}> Main contact (shown at the top of the page)</label>
      <datalist id="clRoles">${ROLES.map(r => `<option value="${escapeHtml(r)}"></option>`).join('')}</datalist>
      <div class="cl-form-actions wide">
        <button type="button" class="cl-btn ghost" data-cl-act="contact-cancel">Cancel</button>
        <button type="submit" class="cl-btn"${CL.saving ? ' disabled' : ''}>${CL.saving ? 'Saving…' : c ? 'Save' : 'Add contact'}</button>
      </div>
    </form>`);
}

/** Only one main contact per client: the others are unset first. */
async function clearOtherMains(sb, keepId) {
  const others = (CL.data.contacts || []).filter(x => x.is_main && x.id !== keepId).map(x => x.id);
  if (others.length) must(await sb.from('client_contacts').update({ is_main: false }).in('id', others));
}

async function saveContact(form) {
  if (CL.saving) return;
  const id = form.dataset.id === 'new' ? null : Number(form.dataset.id);
  const f = form.elements;
  const { row, error } = cleanContact({ name: f.name.value, role: f.role.value, email: f.email.value, phone: f.phone.value, notes: f.notes.value, is_main: f.is_main.checked }, CL.name);
  if (error) { toast(error, 'warning'); return; }
  if (duplicateEmail(CL.data.contacts, row.email, id)) { toast(`${row.email} is already a contact for ${CL.name}.`, 'warning'); return; }
  CL.saving = true; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    if (row.is_main) await clearOtherMains(sb, id);
    if (id) must(await sb.from('client_contacts').update(row).eq('id', id));
    else must(await sb.from('client_contacts').insert({ ...row, created_by: (els('userName')?.textContent || '').trim() }));
    await reloadContacts(sb);
    CL.contactEdit = null;
    toast(id ? 'Contact saved' : `${row.name || row.email} added`, 'success');
  } catch (err) {
    toast('Could not save the contact: ' + (err.message || err), 'error', 7000);
  } finally {
    CL.saving = false; render();
  }
}

async function reloadContacts(sb) {
  CL.data.contacts = contactsFor(must(await sb.from('client_contacts').select('*')), CL.name);
}

async function contactAct(act, id) {
  const c = (CL.data.contacts || []).find(x => x.id === id);
  if (!c) return;
  if (act === 'contact-del' && !confirm(`Remove ${c.name || c.email} from ${CL.name}'s contacts?`)) return;
  try {
    const sb = await connectSupabase({ interactive: true });
    if (act === 'contact-main') { await clearOtherMains(sb, id); must(await sb.from('client_contacts').update({ is_main: true }).eq('id', id)); }
    if (act === 'contact-del') must(await sb.from('client_contacts').delete().eq('id', id));
    await reloadContacts(sb);
    toast(act === 'contact-main' ? `${c.name || c.email} is now the main contact` : 'Contact removed', 'success');
  } catch (err) {
    toast('Could not update: ' + (err.message || err), 'error', 7000);
  } finally { render(); }
}

// ─── New opportunity (Philip, 9 Oct: "create an opportunity when I am in clients, manual or from a list") ───

const PER_UNIT = { user: 'Users', seat: 'Seats', device: 'Devices', site: 'Sites' };
const UNIT_TEXT = { user: 'per user a month', seat: 'per seat a month', device: 'per device a month', site: 'per site a month', month: 'a month', year: 'a year', 'one-off': 'one-off' };

function newOppHtml(p) {
  const a = CL.adding, products = CL.data.products || [];
  const prod = products.find(x => x.key === a.product) || null;
  const open = new Set((p.opps || []).filter(o => o.status === 'idea' || o.status === 'proposed').map(o => o.product_key).filter(Boolean));
  const families = [...new Set(products.map(x => x.family || 'Other'))];
  const options = families.map(f => `<optgroup label="${escapeHtml(f)}">${products.filter(x => (x.family || 'Other') === f).map(x =>
    `<option value="${escapeHtml(x.key)}"${x.key === a.product ? ' selected' : ''}>${escapeHtml(x.name)}${x.unit_price != null ? ` · ${escapeHtml(money(x.unit_price))} ${escapeHtml(UNIT_TEXT[x.price_unit || 'user'] || '')}` : ''}${open.has(x.key) ? ' (already in the pipeline)' : ''}</option>`).join('')}</optgroup>`).join('');
  const per = prod && PER_UNIT[prod.price_unit || 'user'] && prod.unit_price != null ? PER_UNIT[prod.price_unit || 'user'] : '';
  const preview = newOpportunity({ client: CL.name, product: prod, title: a.title, quantity: a.quantity, mrr: a.mrr, oneOff: a.oneOff });
  return panel('New opportunity', `<form class="cl-form" data-cl-form="new-opp" novalidate>
      <label class="wide">What
        <select name="product">
          <option value="">Something else (type it below)</option>
          ${options}
        </select>
        ${!products.length ? '<small>The catalogue didn’t load; you can still type one.</small>' : prod?.unit_note ? `<small>${escapeHtml(prod.unit_note)}</small>` : ''}
      </label>
      <label class="wide">Name <input name="title" type="text" maxlength="200" value="${escapeHtml(a.title || '')}" placeholder="${escapeHtml(prod ? `${prod.name} — ${CL.name}` : 'e.g. New website, Laptop refresh, Cyber Essentials')}"></label>
      ${per ? `<label>${per} <input name="quantity" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(a.quantity ?? '')}" placeholder="how many"></label>` : ''}
      <label>£ a month <input name="mrr" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(a.mrr ?? '')}" placeholder="${escapeHtml(preview.error ? '0' : String(preview.mrr))}"></label>
      <label>£ one-off <input name="one_off" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(a.oneOff ?? '')}" placeholder="${escapeHtml(preview.error ? '0' : String(preview.one_off))}"></label>
      <label>Stage <select name="status"><option value="idea"${a.status !== 'proposed' ? ' selected' : ''}>Idea</option><option value="proposed"${a.status === 'proposed' ? ' selected' : ''}>Proposed</option></select></label>
      <label class="wide">Next step <input name="next_step" type="text" maxlength="200" value="${escapeHtml(a.nextStep || '')}" placeholder="e.g. Call Chris about seats"></label>
      ${open.has(a.product) ? '<p class="cl-form-warn wide">This client already has this one open in the pipeline.</p>' : ''}
      <div class="cl-form-actions wide">
        <span class="cl-muted">${preview.error ? '' : `Adds to the pipeline: ${escapeHtml(preview.title)}${preview.mrr ? ` · ${escapeHtml(money(preview.mrr))}/mo` : ''}${preview.one_off ? ` · ${escapeHtml(money(preview.one_off))} one-off` : ''}`}</span>
        <button type="button" class="cl-btn ghost" data-cl-act="cancel-opp">Cancel</button>
        <button type="submit" class="cl-btn"${CL.saving ? ' disabled' : ''}>${CL.saving ? 'Adding…' : 'Add opportunity'}</button>
      </div>
    </form>`);
}

/** Keep what's typed in CL.adding (the form is re-drawn when the product changes). */
function readForm(form) {
  const f = form.elements;
  const v = n => (f[n] ? f[n].value : undefined);
  return { product: v('product') || '', title: v('title') || '', quantity: v('quantity') ?? CL.adding?.quantity ?? '', mrr: v('mrr') || '', oneOff: v('one_off') || '', status: v('status'), nextStep: v('next_step') || '' };
}

async function saveOpp(form) {
  if (CL.saving) return;
  CL.adding = readForm(form);
  const a = CL.adding;
  const product = (CL.data.products || []).find(x => x.key === a.product) || null;
  const row = newOpportunity({ client: CL.name, product, title: a.title, quantity: a.quantity, mrr: a.mrr, oneOff: a.oneOff, status: a.status, nextStep: a.nextStep, owner: (els('userName')?.textContent || '').trim() });
  if (row.error) { toast(row.error, 'warning'); form.elements.title?.focus(); return; }
  CL.saving = true; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const saved = must(await sb.from('opportunities').insert(row).select('*').single());
    CL.adding = null;
    CL.data.profile.opps = [saved, ...(CL.data.profile.opps || [])];
    CL.data.profile.openOpps = [saved, ...(CL.data.profile.openOpps || [])];
    window.GeckoSections?.opportunities?.reload?.();
    toast(`Added to the pipeline: ${saved.title}`, 'success');
  } catch (err) {
    toast('Could not add: ' + (err.message || err), 'error', 7000);
  } finally {
    CL.saving = false; render();
  }
}

// ─── Events ───────────────────────────────────────────────────────────

function pick(tab) {
  if (tab === CL.tab || !TABS.includes(tab)) return;
  CL.dir = direction(TABS, CL.tab, tab);
  CL.tab = tab;
  render();
}

function onClick(event) {
  const tab = event.target.closest('[data-cl-tab]');
  if (tab) { pick(tab.dataset.clTab); return; }
  const g = event.target.closest('[data-cl-go]');
  if (g) {
    const [section, sub] = g.dataset.clGo.split(':');
    if (section === 'client') { pick(sub); return; }
    window.geckoGo?.(section, sub, CL.name);
    return;
  }
  const act = event.target.closest('[data-cl-act]')?.dataset.clAct;
  if (act === 'reload') { CL.data = null; load(); }
  if (act === 'new-opp') {
    CL.adding = CL.adding || { status: 'idea' };
    if (CL.tab !== 'opportunities') pick('opportunities'); else render();
    setTimeout(() => els('clWrap')?.querySelector('[data-cl-form="new-opp"] select[name="product"]')?.focus(), 50);
  }
  if (act === 'cancel-opp') { CL.adding = null; render(); }
  if (act === 'contact-add') { CL.contactEdit = 'new'; render(); els('clWrap')?.querySelector('[data-cl-form="contact"] [name="name"]')?.focus(); }
  if (act === 'contact-edit') { CL.contactEdit = Number(event.target.closest('[data-id]').dataset.id); render(); }
  if (act === 'contact-cancel') { CL.contactEdit = null; render(); }
  if (act === 'contact-main' || act === 'contact-del') contactAct(act, Number(event.target.closest('[data-id]').dataset.id));
  if (act === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
}

export function init() {
  const section = els('section-client');
  section?.addEventListener('click', onClick);
  section?.addEventListener('submit', e => {
    if (e.target.dataset.clForm === 'new-opp') { e.preventDefault(); saveOpp(e.target); }
    if (e.target.dataset.clForm === 'contact') { e.preventDefault(); saveContact(e.target); }
  });
  section?.addEventListener('change', e => {
    const form = e.target.closest?.('[data-cl-form="new-opp"]');
    if (!form || e.target.name !== 'product') return;
    // A new pick re-fills the suggestions; anything typed by hand in the name/prices is kept.
    const a = readForm(form);
    CL.adding = { ...a, quantity: '', mrr: a.mrr, oneOff: a.oneOff };
    render();
    els('clWrap')?.querySelector('[data-cl-form="new-opp"] [name="quantity"], [data-cl-form="new-opp"] [name="mrr"]')?.focus();
  });
  section?.addEventListener('input', e => {
    const form = e.target.closest?.('[data-cl-form="new-opp"]');
    if (!form || !['quantity', 'mrr', 'one_off', 'title'].includes(e.target.name)) return;
    // Live summary line without redrawing the form (keeps the cursor where it is).
    CL.adding = readForm(form);
    const a = CL.adding, prod = (CL.data.products || []).find(x => x.key === a.product) || null;
    const pv = newOpportunity({ client: CL.name, product: prod, title: a.title, quantity: a.quantity, mrr: a.mrr, oneOff: a.oneOff });
    const line = form.querySelector('.cl-form-actions .cl-muted');
    if (line) line.textContent = pv.error ? '' : `Adds to the pipeline: ${pv.title}${pv.mrr ? ` · ${money(pv.mrr)}/mo` : ''}${pv.one_off ? ` · ${money(pv.one_off)} one-off` : ''}`;
    const mrr = form.elements.mrr; if (mrr && !pv.error) mrr.placeholder = String(pv.mrr);
  });
  section?.addEventListener('keydown', e => keyNav(e, 'data-cl-tab', pick));
  window.addEventListener('resize', () => moveInk(els('clHead')?.querySelector('.app-tabs')));
  render();
}
