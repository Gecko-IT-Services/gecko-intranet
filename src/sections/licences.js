/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   LICENCES (Clients hub)                                          ║
   ║                                                                   ║
   ║   Microsoft 365: what TD SYNNEX charged us for each client this   ║
   ║   month against the M365 lines we invoiced them in Xero. Read     ║
   ║   only: differences are listed with the invoice to change; the    ║
   ║   change itself is made in Xero by Philip.                        ║
   ║   Logic: core/licences.js. Design: docs/superpowers/specs/        ║
   ║   2026-10-10-licence-check-design.md                              ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { validateFeed } from '../core/profit-feed.js';
import { licenceMonths, licenceCheck, productLabel, suggestRate, TYPES } from '../core/licences.js';

const LC = { feed: null, invoices: null, month: '', error: null, loading: false, open: new Set(), syncedAt: null };
const els = id => document.getElementById(id);
const money = n => (n == null ? '—' : (n < 0 ? '−£' : '£') + Math.abs(Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const monthLabel = m => (m ? new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—');
const dayLabel = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const prevMonth = m => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
// Without seat detail a match only means "billed this month", so it says that.
const typeLabel = (c, type) => (type === 'MATCH' && !c.detail ? 'Billed' : TYPES[type]);
const BADGE = { UNBILLED_CLIENT: 'red', UNBILLED_SKU: 'red', SEAT_SHORT: 'amber', SEAT_OVER: 'blue', NO_TD_LINE: 'blue', UNMATCHABLE: 'purple', MATCH: 'green' };

async function load() {
  LC.loading = true; LC.error = null; render();
  try {
    if (typeof window.fetchProfitFeed !== 'function') throw new Error('The page’s feed reader isn’t available. Reload the page.');
    const feed = await window.fetchProfitFeed();
    if (!feed) throw new Error('No feed yet: the morning job hasn’t written one.');
    const v = validateFeed(feed);
    if (!v.ok) throw new Error(`The feed was refused: ${v.errors.slice(0, 3).join('; ')}`);
    const months = licenceMonths(feed);
    const since = months.length ? prevMonth(months[months.length - 1]) + '-01' : '2026-01-01';
    const sb = await connectSupabase();
    const { data, error } = await sb.from('xero_invoices')
      .select('contact_name,invoice_number,invoice_date,status,line_items')
      .gte('invoice_date', since).in('status', ['AUTHORISED', 'PAID']);
    if (error) throw new Error(error.message || 'Database request failed');
    LC.feed = feed; LC.invoices = data || [];
    if (!LC.month || !months.includes(LC.month)) LC.month = months[0] || '';
    LC.syncedAt = new Date();
  } catch (err) {
    LC.error = err;
  } finally {
    LC.loading = false; render();
  }
}

function check(month) {
  const months = licenceMonths(LC.feed);
  const i = months.indexOf(month);
  const prev = i >= 0 && months[i + 1] ? licenceCheck(LC.feed, LC.invoices, months[i + 1]) : null;
  return licenceCheck(LC.feed, LC.invoices, month, prev);
}

function render() {
  const mount = els('licWrap');
  if (!mount) return;
  const sync = els('licLastSync');
  if (sync) sync.textContent = LC.syncedAt ? `Synced ${LC.syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
  if (LC.error) {
    mount.innerHTML = LC.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="state-error art art-offline"><strong>Connect to the Gecko database</strong><button type="button" class="btn btn-sm" data-lic-act="connect">Connect</button></div>'
      : `<div class="state-error art art-offline"><strong>Could not load the licence check.</strong><p>${escapeHtml(LC.error.message || LC.error)}</p><button type="button" class="btn btn-sm" data-lic-act="reload">Retry</button></div>`;
    renderMonth(null);
    return;
  }
  if (!LC.feed) { mount.innerHTML = '<p class="state-empty art art-loading">Loading licences…</p>'; renderMonth(null); return; }
  const months = licenceMonths(LC.feed);
  renderMonth(months);
  if (!LC.month) { mount.innerHTML = '<p class="state-empty art art-empty">No TD SYNNEX licence invoice in the feed yet.</p>'; return; }

  const c = check(LC.month);
  const t = c.totals;
  const diffs = c.clients.filter(x => !x.ok), fine = c.clients.filter(x => x.ok);
  const inv = c.invoice.map(i => `Invoice ${i.invoice} · ${dayLabel(i.date)}`).join(', ');
  const figures = `<div class="kpi-panel lic-kpis">
      <div class="kpi"><span class="kpi-label">TD SYNNEX cost</span><span class="kpi-value">${escapeHtml(money(t.tdCost))}</span><span class="kpi-sub">${escapeHtml(inv)}</span></div>
      <div class="kpi"><span class="kpi-label">Billed in Xero</span><span class="kpi-value">${escapeHtml(money(t.xeroRevenue))}</span><span class="kpi-sub">M365 lines, ${escapeHtml(monthLabel(c.month))}</span></div>
      <div class="kpi"><span class="kpi-label">Margin</span><span class="kpi-value">${escapeHtml(money(t.margin))}</span><span class="kpi-sub">${t.marginPct == null ? '—' : `${t.marginPct}%`}</span></div>
      <div class="kpi"><span class="kpi-label">Differences</span><span class="kpi-value${t.differences ? ' lic-warn' : ' lic-good'}">${t.differences}</span><span class="kpi-sub">${t.worth ? `${escapeHtml(money(t.worth))}/month not billed` : 'nothing missing'}</span></div>
    </div>`;
  const level = c.detail ? '' : `<div class="lic-note"><strong>Totals per client only.</strong> This invoice in the feed has each client’s cost but not their products and seats, so seats can’t be compared yet. Once the morning job also records them, each product is checked seat by seat.</div>`;
  mount.innerHTML = `<div class="app-pane">
    ${figures}
    ${level}
    <section class="lic-group">
      <h2>${diffs.length ? `Needs a look <span class="badge badge-amber">${diffs.length}</span>` : 'Needs a look'}</h2>
      ${diffs.length ? `<ul class="lic-list">${diffs.map(x => clientHtml(c, x)).join('')}</ul>` : '<p class="state-empty art art-clear">Every client on the TD SYNNEX invoice is billed in Xero.</p>'}
    </section>
    <section class="lic-group">
      <h2>Matching <span class="lic-count">${fine.length}</span></h2>
      <ul class="lic-list">${fine.map(x => clientHtml(c, x)).join('')}</ul>
    </section>
  </div>`;
}

function renderMonth(months) {
  const label = els('licMonthLabel'), sel = els('licMonthSel');
  if (!label || !sel) return;
  sel.hidden = !months || !months.length;
  label.textContent = monthLabel(LC.month);
  const i = months ? months.indexOf(LC.month) : -1;
  sel.querySelector('[data-lic-month="-1"]').disabled = !months || i < 0 || i >= months.length - 1;
  sel.querySelector('[data-lic-month="1"]').disabled = !months || i <= 0;
}

function clientHtml(c, x) {
  const open = LC.open.has(x.client);
  const worst = x.rows.find(r => r.type !== 'MATCH') || x.rows[0];
  const pct = x.marginPct;
  const head = `<button type="button" class="lic-row" data-lic-open="${escapeHtml(x.client)}" aria-expanded="${open}">
      <span class="lic-name">${escapeHtml(x.client)}</span>
      <span class="lic-badge"><span class="badge badge-${BADGE[worst.type]}">${escapeHtml(typeLabel(c, worst.type))}</span>${x.rows.filter(r => r.type !== 'MATCH').length > 1 ? ` <small>+${x.rows.filter(r => r.type !== 'MATCH').length - 1}</small>` : ''}</span>
      <span class="lic-fig"><small>TD</small>${escapeHtml(money(x.tdCost))}</span>
      <span class="lic-fig"><small>Xero</small>${escapeHtml(money(x.xeroRevenue))}</span>
      <span class="lic-fig lic-margin${pct != null && pct < 0 ? ' bad' : pct != null && pct < 30 ? ' low' : ''}"><small>Margin</small>${pct == null ? '—' : `${pct}%`}</span>
    </button>`;
  return `<li class="lic-client${open ? ' open' : ''}">${head}${open ? detailHtml(c, x) : ''}</li>`;
}

function detailHtml(c, x) {
  const names = [x.tdName && x.tdName !== x.client ? `TD SYNNEX calls them “${x.tdName}”` : '', x.xeroName && x.xeroName !== x.client ? `Xero: “${x.xeroName}”` : ''].filter(Boolean).join(' · ');
  const rows = x.rows.map(r => {
    let what = '';
    if (r.type === 'SEAT_SHORT' && r.fix) what = `${r.fix.invoice}: ${r.fix.line} ${r.fix.from} → ${r.fix.to} at ${money(r.fix.unit)} = +${money(r.worth)}/month`;
    else if (r.type === 'SEAT_SHORT') what = `${r.tdSeats - r.xeroSeats} more on TD SYNNEX than billed (Xero line is a bundle; check ${r.invoice})`;
    else if (r.type === 'UNBILLED_SKU' || (r.type === 'UNBILLED_CLIENT' && r.tdSeats)) {
      const s = suggestRate(c, x.client, r.product, r.tdUnit);
      what = `Costs us ${money(r.tdTotal)}/month${s ? ` · estimate ${money(s.unit)} a seat (${s.rule})` : ''}`;
    } else if (r.type === 'UNBILLED_CLIENT') what = `Costs us ${money(r.tdTotal)}/month and no M365 line in Xero this month. They may be billed under another name.`;
    else if (r.type === 'SEAT_OVER') what = `${r.xeroSeats - r.tdSeats} more billed than TD SYNNEX charges for. Licence removed, or a seat still to add?`;
    else if (r.type === 'NO_TD_LINE') what = r.product === 'any' ? 'Billed in Xero, not on this TD SYNNEX invoice. Another supplier, or a licence that has gone?' : `Billed in Xero (${r.invoice}), not on this TD SYNNEX invoice.`;
    else if (r.type === 'UNMATCHABLE') what = r.note;
    else if (r.note) what = r.note;
    const seats = (a, b) => (a == null && b == null ? '' : `<span class="lic-seats">${a ?? '—'} <small>TD</small> · ${b ?? '—'} <small>Xero</small></span>`);
    return `<li class="lic-line">
      <span class="lic-prod">${escapeHtml(c.detail ? productLabel(r.product) : 'Microsoft 365, all products')}</span>
      <span class="badge badge-${BADGE[r.type]}">${escapeHtml(typeLabel(c, r.type))}</span>
      ${c.detail ? seats(r.tdSeats, r.xeroSeats) : ''}
      ${r.cause ? `<span class="lic-cause">${escapeHtml(r.cause)}</span>` : ''}
      ${what ? `<p>${escapeHtml(what)}</p>` : ''}
    </li>`;
  }).join('');
  const monthly = x.monthly.length ? `<p class="lic-sub">On monthly commitment at TD SYNNEX: ${escapeHtml(x.monthly.join(', '))}. The annual price is lower.</p>` : '';
  return `<div class="lic-detail">
    <ul class="lic-lines">${rows}</ul>
    ${monthly}
    <p class="lic-sub">${x.invoices.length ? `Xero ${escapeHtml(x.invoices.join(', '))}` : 'No Xero invoice with M365 lines this month'}${names ? ` · ${escapeHtml(names)}` : ''}</p>
    <div class="lic-actions">${clientLink(x.client)}</div>
  </div>`;
}

function onClick(e) {
  if (e.target.closest('a')) return;
  const o = e.target.closest('[data-lic-open]');
  if (o) { const k = o.dataset.licOpen; LC.open.has(k) ? LC.open.delete(k) : LC.open.add(k); render(); return; }
  const m = e.target.closest('[data-lic-month]');
  if (m) {
    const months = licenceMonths(LC.feed);
    const i = months.indexOf(LC.month) - Number(m.dataset.licMonth);
    if (months[i]) { LC.month = months[i]; LC.open.clear(); render(); }
    return;
  }
  const a = e.target.closest('[data-lic-act]')?.dataset.licAct;
  if (a === 'reload') load();
  if (a === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
}

export function init() {
  els('section-licences')?.addEventListener('click', onClick);
  els('licRefresh')?.addEventListener('click', async () => {
    const b = els('licRefresh');
    b?.classList.add('spinning');
    await load();
    b?.classList.remove('spinning');
  });
  load();
}
