/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   ATERA COSTS (Clients hub)                                       ║
   ║                                                                   ║
   ║   What Atera charges Gecko (technician seats + AppCenter add-ons) ║
   ║   against what clients pay for Atera services in Xero, by feature ║
   ║   and by client; why the bill moved; the leaks. Read only towards ║
   ║   Atera and Xero: the only write is the usage report upload       ║
   ║   (save_atera_usage, refused unless it adds up to the charge) and ║
   ║   the feed's latest Atera charge into atera_bills.                ║
   ║   Logic: core/atera-costs.js. Design: docs/superpowers/specs/     ║
   ║   2026-10-12-atera-costs-design.md                                ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import {
  FEATURES, featureLabel, billMonths, billsFromFeed, salesByMonth, ateraMonth,
  parseCsv, detectColumns, usageLines, reconcile
} from '../core/atera-costs.js';

const AT = { bills: null, files: [], usage: [], invoices: [], agents: [], month: '', error: null, open: new Set(), pending: null, saving: false, syncedAt: null };
const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const gbp = n => (n == null ? '—' : (n < 0 ? '−£' : '£') + Math.abs(Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const usd = n => (n == null ? '—' : (n < 0 ? '−$' : '$') + Math.abs(Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const monthLabel = m => (m ? new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—');
const shortMonth = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const LEAK = {
  seat_offer: ['amber', 'Atera discount'], unbilled: ['red', 'Not billed'], below_cost: ['red', 'Below cost'],
  unbilled_feature: ['amber', 'Feature not billed'], stale: ['blue', 'Old devices'], devices_unbilled: ['amber', 'No Atera billing'], own: ['purple', 'Gecko’s own']
};
// SheetJS for .xlsx usage reports, loaded only when one is chosen.
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

async function load() {
  AT.error = null; render();
  try {
    const sb = await connectSupabase();
    let bills = must(await sb.from('atera_bills').select('month,charged_on,kind,product,usd,gbp,gbp_source,ref').order('charged_on'));
    // The morning feed carries Atera's latest charges: keep each one (it holds only the current month).
    try {
      const feed = typeof window.fetchProfitFeed === 'function' ? await window.fetchProfitFeed() : null;
      const add = billsFromFeed(feed?.atera, bills);
      if (add.length) {
        const { error } = await sb.from('atera_bills').insert(add);
        if (!error) bills = bills.concat(add);
      }
    } catch { /* the feed is optional here: the receipts already in atera_bills still show */ }
    const first = bills.length ? bills[0].month : today().slice(0, 7);
    const [files, usage, invoices, agents] = await Promise.all([
      sb.from('atera_usage_files').select('*').order('month', { ascending: false }).then(must),
      sb.from('atera_usage').select('month,customer,product,feature,quantity,usd').then(must),
      sb.from('xero_invoices').select('contact_name,invoice_number,invoice_date,status,line_items').gte('invoice_date', first + '-01').in('status', ['AUTHORISED', 'PAID']).then(must),
      sb.from('atera_agents').select('customer_name,machine_name,device_type,os,last_seen').then(must)
    ]);
    Object.assign(AT, { bills, files, usage, invoices, agents, syncedAt: new Date() });
    const months = billMonths(bills).map(b => b.month);
    if (!AT.month || !months.includes(AT.month)) AT.month = months[0] || '';
  } catch (err) {
    AT.error = err;
  }
  render();
}

const monthsHeld = () => billMonths(AT.bills).map(b => b.month);
const prevOf = m => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
const usageFor = m => { const rows = AT.usage.filter(u => u.month === m); return rows.length ? rows : null; };

function render() {
  const mount = els('atWrap');
  if (!mount) return;
  const sync = els('atLastSync');
  if (sync) sync.textContent = AT.syncedAt ? `Synced ${AT.syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
  if (AT.error) {
    const missing = /atera_(bills|usage)/.test(AT.error.message || '');
    mount.innerHTML = AT.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="state-error art art-offline"><strong>Connect to the Gecko database</strong><button type="button" class="btn btn-sm" data-at-act="connect">Connect</button></div>'
      : `<div class="state-error art art-offline"><strong>Could not load Atera costs.</strong><p>${escapeHtml(missing ? 'The Atera cost tables aren’t in the database yet (they arrive with this update).' : AT.error.message || AT.error)}</p><button type="button" class="btn btn-sm" data-at-act="reload">Retry</button></div>`;
    renderMonth(null);
    return;
  }
  if (!AT.bills) { mount.innerHTML = '<p class="state-empty art art-loading">Loading Atera costs…</p>'; renderMonth(null); return; }
  const all = billMonths(AT.bills);
  renderMonth(all.map(b => b.month));
  if (!all.length) { mount.innerHTML = '<p class="state-empty art art-empty">No Atera charges recorded yet.</p>'; return; }

  const bill = all.find(b => b.month === AT.month);
  const fallbackRate = all.find(b => b.rate)?.rate || null;
  const last = all.find(b => b.seats.usd);
  const m = ateraMonth({ month: AT.month, bill, usage: usageFor(AT.month), prevUsage: usageFor(prevOf(AT.month)), invoices: AT.invoices, agents: AT.agents,
    today: today(), fallbackRate, lastSeats: last ? { usd: last.seats.usd, techs: last.techs } : null });
  // Seats are charged on the 26th: until then the month holds only the add-ons, and says so (like Licences before TD SYNNEX's invoice).
  const seatsDue = !bill.seats.usd && last;
  const file = AT.files.find(f => f.month === AT.month);
  const sureLeaks = m.leaks.filter(l => l.sure && l.perMonth);

  const figures = `<div class="kpi-panel at-kpis">
    <div class="kpi"><span class="kpi-label">Atera bill</span><span class="kpi-value">${escapeHtml(gbp(m.cost))}</span><span class="kpi-sub">${escapeHtml(seatsDue ? `add-ons ${usd(bill.addons.usd)}; technician seats (${usd(last.seats.usd)}) not charged yet, due on the 26th` : `${usd(bill.usd)}: seats ${usd(bill.seats.usd)} + add-ons ${usd(bill.addons.usd)}`)}${bill.estimated ? ' · £ at the feed’s rate' : ''}</span></div>
    <div class="kpi"><span class="kpi-label">Charged to clients</span><span class="kpi-value">${escapeHtml(gbp(m.sale))}</span><span class="kpi-sub">${m.clients.filter(c => c.sale).length} clients, Atera lines in Xero</span></div>
    <div class="kpi"><span class="kpi-label">Margin</span><span class="kpi-value${m.margin < 0 ? ' at-bad' : ''}">${escapeHtml(gbp(m.margin))}</span><span class="kpi-sub">${m.margin == null || !m.sale ? '—' : `${pct(m.margin, m.sale)}% of what clients pay${seatsDue ? ', before the seats charge' : ''}`}</span></div>
    <div class="kpi"><span class="kpi-label">Leaks found</span><span class="kpi-value${m.leakTotal ? ' at-warn' : ' at-good'}">${escapeHtml(gbp(m.leakTotal))}</span><span class="kpi-sub">a month, ${sureLeaks.length} certain · ${m.leaks.length - sureLeaks.length} to check</span></div>
  </div>`;

  const noReport = m.hasUsage ? '' : `<div class="at-note"><strong>No usage report for ${escapeHtml(monthLabel(AT.month))} yet.</strong>
    Atera’s receipt is one line (“AppCenter usage ${escapeHtml(usd(bill.addons.usd))}”), so the cost per feature and per client comes from Atera’s per-customer usage report.
    Until it’s uploaded, the page shows the bill, what clients pay and what the devices show.
    <button type="button" class="btn btn-sm btn-primary" data-at-act="upload">Upload usage report</button></div>`;

  mount.innerHTML = `<div class="app-pane">
    ${figures}
    ${AT.pending ? pendingHtml(all) : noReport}
    ${trendHtml(all)}
    ${featuresHtml(m)}
    ${leaksHtml(m)}
    ${changesHtml(m)}
    ${clientsHtml(m)}
    ${fileHtml(file, bill)}
  </div>`;
}

function renderMonth(months) {
  const label = els('atMonthLabel'), sel = els('atMonthSel');
  if (!label || !sel) return;
  sel.hidden = !months || !months.length;
  label.textContent = monthLabel(AT.month);
  const i = months ? months.indexOf(AT.month) : -1;
  sel.querySelector('[data-at-month="-1"]').disabled = !months || i < 0 || i >= months.length - 1;
  sel.querySelector('[data-at-month="1"]').disabled = !months || i <= 0;
}

/** Bill vs what clients pay, last six months: one bar each (bill split seats / add-ons). */
function trendHtml(all) {
  const months = all.slice(0, 6).reverse();
  const sales = salesByMonth(AT.invoices, months.map(b => b.month));
  const max = Math.max(1, ...months.map(b => Math.max(b.gbp, sales[b.month] || 0)));
  const w = v => `${Math.max(0, (v / max) * 100).toFixed(1)}%`;
  const rows = months.map(b => `<li class="at-trend-row${b.month === AT.month ? ' on' : ''}">
      <button type="button" class="at-trend-m" data-at-go="${b.month}">${escapeHtml(shortMonth(b.month))}</button>
      <div class="at-bars">
        <div class="at-bar at-cost" title="${escapeHtml(`Bill ${gbp(b.gbp)}: seats ${gbp(b.seats.gbp)}, add-ons ${gbp(b.addons.gbp)}`)}">
          <span class="at-seg seats" style="width:${w(b.seats.gbp)}"></span><span class="at-seg addons" style="width:${w(b.addons.gbp)}"></span></div>
        <div class="at-bar at-sale" title="${escapeHtml(`Charged ${gbp(sales[b.month])}`)}"><span class="at-seg sale" style="width:${w(sales[b.month] || 0)}"></span></div>
      </div>
      <span class="at-trend-fig"><small>Add-ons</small>${escapeHtml(usd(b.addons.usd))}</span>
      <span class="at-trend-fig"><small>Bill</small>${escapeHtml(gbp(b.gbp))}</span>
      <span class="at-trend-fig"><small>Charged</small>${escapeHtml(gbp(sales[b.month]))}</span>
    </li>`).join('');
  const firstA = months.find(b => b.addons.usd), lastA = [...months].reverse().find(b => b.addons.usd);
  const rise = firstA && lastA && firstA !== lastA ? lastA.addons.usd - firstA.addons.usd : 0;
  const seats = months.filter(b => b.seats.usd).slice(-1)[0]?.seats.usd;
  const line = rise ? `Add-ons ${rise > 0 ? 'up' : 'down'} ${usd(Math.abs(rise))} a month (${pct(Math.abs(rise), firstA.addons.usd)}%) since ${monthLabel(firstA.month)}${seats ? `; technician seats ${usd(seats)}` : ''}.` : '';
  return `<section class="at-group">
    <h2>The bill, month by month</h2>
    <ul class="at-trend">${rows}</ul>
    <p class="at-legend"><span class="at-key seats"></span>Technician seats <span class="at-key addons"></span>Add-ons (AppCenter) <span class="at-key sale"></span>Charged to clients${line ? ` · ${escapeHtml(line)}` : ''}</p>
  </section>`;
}

function featuresHtml(m) {
  const rows = m.features.map(f => `<li class="at-frow">
      <span class="at-name">${escapeHtml(f.label)} <small>${escapeHtml(f.maker)}</small></span>
      <span class="at-fig"><small>Cost</small>${escapeHtml(gbp(f.cost))}</span>
      <span class="at-fig"><small>Charged</small>${escapeHtml(gbp(f.sale))}</span>
      <span class="at-fig${f.margin != null && f.margin < 0 ? ' at-bad' : ''}"><small>Margin</small>${f.margin == null ? '—' : escapeHtml(`${gbp(f.margin)}${f.sale ? ` · ${pct(f.margin, f.sale)}%` : ''}`)}</span>
    </li>`).join('');
  const bundled = m.clients.filter(c => c.split).length;
  const note = [
    !m.hasUsage ? 'Add-on cost per feature arrives with the usage report; the bill’s add-ons total is above.' : '',
    bundled ? `${bundled} client${bundled === 1 ? ' is' : 's are'} charged a bundle (e.g. “Internet Security & Backup & Work from Home”): its price is split ${m.hasUsage ? 'by what each part costs that client' : 'evenly until the costs are known'}. Separate Xero lines would make this exact.` : '',
    'Management is what the technician seats pay for, set against cloud management and retainer lines.'
  ].filter(Boolean).join(' ');
  return `<section class="at-group"><h2>By feature</h2><ul class="at-list">${rows || '<li class="at-empty">Nothing charged or billed this month.</li>'}</ul><p class="at-sub">${escapeHtml(note)}</p></section>`;
}

function leaksHtml(m) {
  if (!m.leaks.length) return '<section class="at-group"><h2>Leaks and savings</h2><p class="state-empty art art-clear">No leaks found this month.</p></section>';
  const rows = m.leaks.map(l => `<li class="at-leak">
      <span class="badge badge-${LEAK[l.kind][0]}">${escapeHtml(LEAK[l.kind][1])}</span>
      ${l.client ? `<strong>${escapeHtml(l.client)}</strong>` : ''}
      <span class="at-leak-fig">${l.perMonth != null ? `${l.sure ? '' : 'about '}${escapeHtml(gbp(l.perMonth))}<small>/month</small>` : '<small>cost unknown</small>'}</span>
      <p>${escapeHtml(l.text)}</p>
    </li>`).join('');
  return `<section class="at-group"><h2>Leaks and savings <span class="badge badge-amber">${m.leaks.length}</span></h2><ul class="at-leaks">${rows}</ul></section>`;
}

function changesHtml(m) {
  if (!m.hasUsage) return '';
  const prev = prevOf(AT.month);
  if (!m.changes) return `<section class="at-group"><h2>What changed</h2><p class="at-sub">Upload ${escapeHtml(monthLabel(prev))}’s usage report too and this shows, line by line, why the add-ons went up or down.</p></section>`;
  const STATE = { new: ['red', 'New'], gone: ['green', 'Gone'], up: ['amber', 'Up'], down: ['green', 'Down'] };
  const rows = m.changes.lines.slice(0, 25).map(l => `<li class="at-change">
      <span class="badge badge-${STATE[l.state][0]}">${STATE[l.state][1]}</span>
      <strong>${escapeHtml(l.customer)}</strong> <span class="at-prod">${escapeHtml(l.product)}</span>
      ${l.qtyBefore != null || l.qtyAfter != null ? `<span class="at-qty">${l.qtyBefore ?? 0} → ${l.qtyAfter ?? 0}</span>` : ''}
      <span class="at-leak-fig">${l.diff > 0 ? '+' : ''}${escapeHtml(usd(l.diff))}</span>
    </li>`).join('');
  return `<section class="at-group"><h2>What changed since ${escapeHtml(monthLabel(prev))}</h2>
    <p class="at-sub">Add-ons ${m.changes.total.usd >= 0 ? 'up' : 'down'} ${escapeHtml(usd(Math.abs(m.changes.total.usd)))}${m.changes.total.gbp != null ? ` (${escapeHtml(gbp(Math.abs(m.changes.total.gbp)))})` : ''} a month. Largest changes first.</p>
    <ul class="at-leaks">${rows}</ul></section>`;
}

function clientsHtml(m) {
  const rows = m.clients.map(c => {
    const open = AT.open.has(c.key);
    const leaks = m.leaks.filter(l => l.client === c.name);
    const worst = leaks[0];
    const badge = worst ? `<span class="badge badge-${LEAK[worst.kind][0]}">${escapeHtml(LEAK[worst.kind][1])}</span>${leaks.length > 1 ? ` <small>+${leaks.length - 1}</small>` : ''}` : (c.sale ? '<span class="badge badge-green">OK</span>' : '');
    const mp = c.margin != null && c.sale ? pct(c.margin, c.sale) : null;
    return `<li class="at-client${open ? ' open' : ''}">
      <button type="button" class="at-row" data-at-open="${escapeHtml(c.key)}" aria-expanded="${open}">
        <span class="at-name">${escapeHtml(c.name)}</span>
        <span class="at-badge">${badge}</span>
        <span class="at-fig"><small>Devices</small>${c.devices}</span>
        <span class="at-fig"><small>Cost</small>${escapeHtml(gbp(c.cost))}</span>
        <span class="at-fig"><small>Charged</small>${escapeHtml(gbp(c.sale))}</span>
        <span class="at-fig${c.margin != null && c.margin < 0 ? ' at-bad' : ''}"><small>Margin</small>${mp == null ? '—' : `${mp}%`}</span>
      </button>
      ${open ? clientDetail(m, c, leaks) : ''}
    </li>`;
  }).join('');
  return `<section class="at-group"><h2>By client <span class="at-count">${m.clients.length}</span></h2><ul class="at-list">${rows}</ul>
    ${m.unmatched.length ? `<p class="at-sub">In the usage report but not matched to a Xero contact: ${escapeHtml(m.unmatched.join(', '))}. If one is a client under another name, add it to ATERA_NAMES in src/core/devices.js.</p>` : ''}</section>`;
}

function clientDetail(m, c, leaks) {
  const feats = FEATURES.filter(f => (c.costByFeature?.[f.key] || 0) || c.saleByFeature[f.key]).map(f => `<li class="at-line">
      <span class="at-prod">${escapeHtml(f.label)}</span>
      <span class="at-seats">${escapeHtml(gbp(c.costByFeature ? c.costByFeature[f.key] : null))} <small>cost</small> · ${escapeHtml(gbp(c.saleByFeature[f.key]))} <small>charged${c.split ? ', split' : ''}</small></span>
    </li>`).join('');
  const products = c.products.length ? `<p class="at-sub">Atera usage: ${escapeHtml(c.products.map(p => `${p.product}${p.quantity != null ? ` × ${p.quantity}` : ''} ${usd(p.usd)}`).join(' · '))}</p>` : '';
  const lines = c.saleLines.length ? `<p class="at-sub">Xero: ${escapeHtml(c.saleLines.map(l => `${l.text} ${gbp(l.amount)}`).join(' · '))}</p>` : '<p class="at-sub">No Atera lines in Xero this month.</p>';
  const names = c.ateraNames.filter(n => n && n !== c.name);
  return `<div class="at-detail">
    ${feats ? `<ul class="at-lines">${feats}</ul>` : ''}
    ${leaks.map(l => `<p class="at-sub at-warn-text">${escapeHtml(l.text)}</p>`).join('')}
    ${products}${lines}
    <p class="at-sub">${c.devices} device${c.devices === 1 ? '' : 's'} in Atera${c.stale ? `, ${c.stale} not seen for 30+ days` : ''}${names.length ? ` · Atera calls them “${escapeHtml(names.join('”, “'))}”` : ''}</p>
    <div class="at-actions">${clientLink(c.name)}</div>
  </div>`;
}

function fileHtml(file, bill) {
  if (!file) return `<section class="at-group"><h2>Usage report</h2><p class="at-sub">None for ${escapeHtml(monthLabel(AT.month))}. In Atera, download the per-customer AppCenter usage report for the ${escapeHtml(usd(bill.addons.usd))} add-ons charge (CSV or Excel) and upload it here. It is only saved if its lines add up to that charge.</p>
    <button type="button" class="btn btn-sm" data-at-act="upload">Upload usage report</button></section>`;
  const when = new Date(file.uploaded_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<section class="at-group"><h2>Usage report</h2>
    <p class="at-sub">${escapeHtml(`${file.file_name}: ${file.rows} lines adding up to ${usd(file.total_usd)} against the ${usd(file.bill_usd)} charge. Uploaded ${when}${file.uploaded_by ? ` by ${file.uploaded_by}` : ''}.`)}</p>
    <button type="button" class="btn btn-sm btn-ghost" data-at-act="upload">Replace</button></section>`;
}

// — Upload: read the file, find its columns, show what it adds up to, save only when it matches the charge. —

function pendingHtml(all) {
  const p = AT.pending;
  const target = all.find(b => b.month === p.month);
  const { lines, skipped, total } = usageLines(p.rows, p.cols);
  const rec = reconcile(total, target?.addons.usd ?? null);
  const opts = (k, allowNone) => `<select data-at-col="${k}">${allowNone ? `<option value="-1"${p.cols[k] < 0 ? ' selected' : ''}>(none)</option>` : ''}${p.cols.headings.map((h, i) => `<option value="${i}"${p.cols[k] === i ? ' selected' : ''}>${escapeHtml(h || `Column ${i + 1}`)}</option>`).join('')}</select>`;
  const months = all.filter(b => b.addons.usd).map(b => `<option value="${b.month}"${b.month === p.month ? ' selected' : ''}>${escapeHtml(`${monthLabel(b.month)}: ${usd(b.addons.usd)} on ${b.charges.find(c => c.kind === 'addons')?.charged_on || ''}`)}</option>`).join('');
  const byFeature = FEATURES.map(f => [f, lines.filter(l => l.feature === f.key).reduce((t, l) => t + l.usd, 0)]).filter(([, v]) => v);
  const sample = lines.slice(0, 6).map(l => `<li>${escapeHtml(`${l.customer} · ${l.product}${l.quantity != null ? ` × ${l.quantity}` : ''} · ${usd(l.usd)} → ${featureLabel(l.feature)}`)}</li>`).join('');
  const verdict = p.cols.header < 0
    ? '<p class="at-bad">No customer and amount columns found. Pick them below.</p>'
    : rec.ok ? `<p class="at-good"><strong>Adds up:</strong> ${escapeHtml(usd(total))} in ${lines.length} lines against the ${escapeHtml(usd(target.addons.usd))} charge.</p>`
      : `<p class="at-bad"><strong>Doesn’t add up:</strong> ${escapeHtml(usd(total))} in ${lines.length} lines against the ${escapeHtml(usd(target?.addons.usd))} charge (${rec.diff > 0 ? '+' : ''}${escapeHtml(usd(rec.diff))}). Check the columns and the month; it can’t be saved like this.</p>`;
  return `<div class="at-upload">
    <h2>Usage report: ${escapeHtml(p.name)}</h2>
    <label>For the add-ons charge <select data-at-pmonth>${months}</select></label>
    <div class="at-cols">
      <label>Customer ${opts('customer')}</label><label>Product ${opts('product', true)}</label>
      <label>Quantity ${opts('quantity', true)}</label><label>Amount (USD) ${opts('amount')}</label>
    </div>
    ${verdict}
    ${byFeature.length ? `<p class="at-sub">${escapeHtml(byFeature.map(([f, v]) => `${f.label} ${usd(v)}`).join(' · '))}${skipped.length ? ` · ${skipped.length} total or blank rows left out` : ''}</p>` : ''}
    ${sample ? `<ul class="at-sample">${sample}</ul>` : ''}
    <div class="at-actions">
      <button type="button" class="btn btn-sm btn-primary" data-at-act="save"${rec.ok && !AT.saving ? '' : ' disabled'}>${AT.saving ? 'Saving…' : 'Save'}</button>
      <button type="button" class="btn btn-sm btn-ghost" data-at-act="cancel">Cancel</button>
    </div>
  </div>`;
}

async function readFile(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text());
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_URL; s.onload = resolve; s.onerror = () => reject(new Error('Couldn’t load the spreadsheet reader. Save the report as CSV and try again.'));
      document.head.appendChild(s);
    });
  }
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  // The sheet with the most rows that has customer and amount columns.
  const sheets = wb.SheetNames.map(n => window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
  return sheets.filter(r => detectColumns(r).header >= 0).sort((a, b) => b.length - a.length)[0] || sheets[0] || [];
}

async function chooseFile(file) {
  try {
    const rows = await readFile(file);
    if (!rows.length) throw new Error('The file is empty.');
    AT.pending = { name: file.name, rows, cols: detectColumns(rows), month: AT.month };
    if (AT.pending.cols.header < 0) AT.pending.cols = { ...AT.pending.cols, header: 0, customer: 0, amount: Math.max(0, (rows[0] || []).length - 1) };
  } catch (err) {
    toast(`Couldn’t read ${file.name}: ${err.message || err}`, 'error', 9000);
  }
  render();
}

async function save() {
  const p = AT.pending;
  if (!p || AT.saving) return;
  const { lines } = usageLines(p.rows, p.cols);
  AT.saving = true; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const h = p.cols.headings;
    const { data, error } = await sb.rpc('save_atera_usage', {
      p_month: p.month, p_file_name: p.name,
      p_columns: { customer: h[p.cols.customer] || '', product: h[p.cols.product] || '', quantity: h[p.cols.quantity] || '', amount: h[p.cols.amount] || '' },
      p_rows: lines
    });
    if (error) throw new Error(error.message || 'Not saved');
    toast(`Saved ${data.rows} usage lines for ${monthLabel(p.month)} (${usd(data.total_usd)}).`, 'success');
    AT.pending = null; AT.month = p.month;
    await load();
  } catch (err) {
    toast(`Usage report not saved: ${err.message || err}`, 'error', 9000);
  } finally {
    AT.saving = false; render();
  }
}

function onClick(e) {
  if (e.target.closest('a')) return;
  const o = e.target.closest('[data-at-open]');
  if (o) { const k = o.dataset.atOpen; AT.open.has(k) ? AT.open.delete(k) : AT.open.add(k); render(); return; }
  const g = e.target.closest('[data-at-go]');
  if (g) { AT.month = g.dataset.atGo; AT.open.clear(); render(); return; }
  const mo = e.target.closest('[data-at-month]');
  if (mo) {
    const months = monthsHeld();
    const i = months.indexOf(AT.month) - Number(mo.dataset.atMonth);
    if (months[i]) { AT.month = months[i]; AT.open.clear(); render(); }
    return;
  }
  const a = e.target.closest('[data-at-act]')?.dataset.atAct;
  if (a === 'reload') load();
  if (a === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
  if (a === 'upload') els('atFile')?.click();
  if (a === 'cancel') { AT.pending = null; render(); }
  if (a === 'save') save();
}

function onChange(e) {
  if (e.target.id === 'atFile') { const f = e.target.files?.[0]; e.target.value = ''; if (f) chooseFile(f); return; }
  if (!AT.pending) return;
  const col = e.target.closest('[data-at-col]');
  if (col) { AT.pending.cols = { ...AT.pending.cols, [col.dataset.atCol]: Number(col.value) }; render(); return; }
  if (e.target.matches('[data-at-pmonth]')) { AT.pending.month = e.target.value; render(); }
}

export function init() {
  const sec = els('section-atera');
  sec?.addEventListener('click', onClick);
  sec?.addEventListener('change', onChange);
  els('atRefresh')?.addEventListener('click', async () => {
    const b = els('atRefresh');
    b?.classList.add('spinning');
    await load();
    b?.classList.remove('spinning');
  });
  load();
}
