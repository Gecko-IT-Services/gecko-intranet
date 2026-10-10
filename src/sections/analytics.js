/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   ANALYTICS                                                       ║
   ║                                                                   ║
   ║   Three tabs, each card one question: Revenue (why recurring      ║
   ║   revenue moved, each month, who it rides on), Time (is client    ║
   ║   time logged, is support crowding out projects), Ahead (SSA      ║
   ║   blocks running out, where the next recurring pound is). Read    ║
   ║   only: every figure comes from data another section owns.        ║
   ║   Logic: core/analytics.js.                                       ║
   ║   Design: docs/superpowers/specs/2026-10-10-analytics-design.md   ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { selectAllPages } from '../core/store.js';
import { validateFeed } from '../core/profit-feed.js';
import { loadAll, rowToClient, rowToEntry } from '../core/timesheets.js';
import { ssaBoard } from '../core/ssa.js';
import { tabsHtml, moveInk, keyNav, direction } from '../core/tabs.js';
import * as A from '../core/analytics.js';
import { whitespace as gapsSnapshot } from './opportunities.js';

const TABS = [{ key: 'revenue', label: 'Revenue' }, { key: 'time', label: 'Time' }, { key: 'ahead', label: 'Ahead' }];
const AN = { tab: 'revenue', d: null, loading: false, error: null, dir: '', syncedAt: null, ws: null, wsError: '', wsLoading: false };

const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const settle = p => Promise.resolve(p).then(v => ({ v }), e => ({ e }));
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DAY = 864e5;
const ms = k => Date.parse(k + 'T00:00:00Z');
const fmt = (k, o) => new Date(ms(k.length === 7 ? k + '-01' : k)).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
const monthName = (m, month = 'long') => fmt(m, { month });
const gbp = n => (n < 0 ? '−' : '') + '£' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-GB');
const gbp2 = n => (n < 0 ? '−' : '') + '£' + Math.abs(Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const signed = n => (n > 0 ? '+' : '') + gbp2(n);
// Pounds large, pence small: the sum stays exact without shouting the pennies.
const big = n => { const [p, d] = gbp2(n).split('.'); return `${escapeHtml(p)}<i class="p">.${d}</i>`; };
const hrs = n => (Number(n) || 0).toFixed(2).replace(/\.?0+$/, '');
const pct = v => Math.round(v * 100) + '%';
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const T = (x, y, s, cls = 'ax', a = 'start') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${cls}" text-anchor="${a}">${escapeHtml(s)}</text>`;
const tip = (...lines) => `data-tip="${escapeHtml(lines.filter(Boolean).map(l => String(l).replace(/\|/g, '/')).join('|'))}" tabindex="0"`;
const fit = (name, px, per = 6.9) => { const m = Math.max(4, Math.floor(px / per)); return name.length > m ? name.slice(0, m - 1).trimEnd() + '…' : name; };
// An axis top just above the data, in at most five clean steps (40.75 h → 50, not 100).
const niceMax = v => { const step = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000].find(s => v / s <= 5) || 250000; return { step, max: Math.max(1, Math.ceil(v / step)) * step }; };
const kTick = v => (Math.abs(v) >= 1000 ? `£${v / 1000}k` : `£${v}`);

// ─── Data ─────────────────────────────────────────────────────────────

async function readFeed() {
  if (typeof window.fetchProfitFeed !== 'function') throw new Error('The page’s feed reader isn’t available. Reload the page.');
  const feed = await window.fetchProfitFeed();
  if (!feed) throw new Error('No feed yet: the morning job hasn’t written one.');
  const v = validateFeed(feed);
  if (!v.ok) throw new Error(`The feed was refused: ${v.errors.slice(0, 3).join('; ')}`);
  return feed;
}

async function load() {
  AN.loading = true; AN.error = null; render();
  try {
    const sb = await connectSupabase();
    const all = (table, cols) => settle(sb.from(table).select(cols).then(must));
    const [invoices, repeating, jobs, gClients, gServices, feed, ts, leave] = await Promise.all([
      settle(selectAllPages((from, to) => sb.from('xero_invoices').select('contact_name,invoice_number,invoice_date,status,sub_total,repeating_invoice_id').order('invoice_id').range(from, to))),
      all('xero_repeating_invoices', 'contact_name,status,period,unit,next_date,end_date,sub_total,reference'),
      all('jobs', 'status,value,invoice_ref,target_date'),
      all('gecko_clients', 'id,title'),
      all('gecko_services', 'client_name,category,cost_per_month'),
      settle(readFeed()),
      settle(loadAll()),
      all('leave_requests', 'person,start_date,end_date,status')
    ]);
    const today = todayKey(), month = today.slice(0, 7);
    const d = { today, month, errors: {} };

    // Revenue: Xero, read the way Jobs › This month reads it.
    if (invoices.v && repeating.v) {
      d.moves = A.recurringMoves(invoices.v, repeating.v, { month });
      d.series = A.monthSeries(invoices.v, repeating.v, jobs.v || [], { month });
      d.conc = A.concentration(d.moves.shares);
    } else d.errors.xero = (invoices.e || repeating.e).message;

    // The margin strip: the feed and the service lines, counted the way Profitability counts them.
    if (feed.v && gClients.v && gServices.v) {
      const clients = gClients.v.map(c => ({ id: String(c.id), name: c.title }));
      const services = gServices.v.map(s => ({ clientName: s.client_name, category: String(s.category || 'other').toLowerCase(), cost: Number(s.cost_per_month) || 0 }));
      const match = name => window.prfXeroMatchName(name, clients);
      d.margins = (d.series || []).map(s => A.monthMoney(feed.v, s.month, clients, services, match));
    } else d.errors.money = (feed.e || gClients.e || gServices.e).message;

    // Time and SSA: timesheet entries (deleted ones left out) and the balances as Timesheets holds them.
    if (ts.v) {
      const names = new Map(ts.v.clients.map(c => [String(c.id), c.name]));
      const entries = ts.v.entries.filter(e => !e.deleted_at).map(e => rowToEntry(e, names.get(String(e.client_id)) || ''));
      const ssa = ts.v.clients.map(c => rowToClient(c, ts.v.balances.get(String(c.id))));
      d.grid = A.logGrid(entries, (leave.v || []).map(r => ({ person: r.person, start: r.start_date, end: r.end_date || r.start_date, status: r.status })), { today });
      d.kinds = A.weeklyKinds(entries, { today });
      d.renewals = A.renewals(ssaBoard(ssa, entries, today).rows, today);
      if (leave.e) d.errors.leave = leave.e.message;
    } else d.errors.time = ts.e.message;

    AN.d = d; AN.syncedAt = new Date();
  } catch (err) {
    AN.error = err;
  } finally {
    AN.loading = false; render();
  }
  if (AN.tab === 'ahead') loadGaps();
}

/** The gaps map is Opportunities' own (and its heaviest load), so it is only read when Ahead is opened. */
async function loadGaps(force = false) {
  if (AN.wsLoading || (AN.ws && !force)) return;
  AN.wsLoading = true; AN.wsError = '';
  if (force) render();
  try { AN.ws = A.whitespace(await gapsSnapshot()); }
  catch (err) { AN.wsError = err.message || String(err); }
  AN.wsLoading = false;
  if (AN.tab === 'ahead') render();
}

// ─── Page ─────────────────────────────────────────────────────────────

const tabStrip = () => document.querySelector('#section-analytics > .app-tabs');

function renderTabs() {
  let strip = tabStrip();
  if (!strip) return;
  if (!strip.querySelector('[data-an-tab]')) {
    strip.outerHTML = tabsHtml(TABS, AN.tab, { attr: 'data-an-tab', controls: 'anWrap', label: 'Analytics views' });
    strip = tabStrip();
  }
  strip.querySelectorAll('[data-an-tab]').forEach(b => {
    const on = b.dataset.anTab === AN.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  moveInk(strip);
}

function switchTab(key) {
  if (key === AN.tab || !TABS.some(t => t.key === key)) return;
  AN.dir = direction(TABS.map(t => t.key), AN.tab, key);
  AN.tab = key;
  render();
  if (key === 'ahead') loadGaps();
}

const card = (title, sub, body, go = '') => `<article class="an-card"><header><div><h2>${escapeHtml(title)}</h2><p>${sub}</p></div>${go}</header>${body}</article>`;
const goBtn = (label, to) => `<button type="button" class="btn btn-sm btn-ghost" data-an-go="${to}">${escapeHtml(label)}</button>`;
const failed = (what, message) => `<div class="state-error"><strong>${escapeHtml(what)} didn’t load.</strong><p>${escapeHtml(message || '')}</p><button type="button" class="btn btn-sm" data-an-act="reload">Retry</button></div>`;
const none = text => `<p class="an-none">${escapeHtml(text)}</p>`;
const chart = name => `<div class="an-chart" data-chart="${name}"></div>`;

function render() {
  const mount = els('anWrap');
  if (!mount) return;
  renderTabs();
  const sync = els('anLastSync');
  if (sync) sync.textContent = AN.syncedAt ? `Synced ${AN.syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
  if (AN.error) {
    mount.innerHTML = AN.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="state-error art art-offline"><strong>Connect to the Gecko database</strong><button type="button" class="btn btn-sm" data-an-act="connect">Connect</button></div>'
      : `<div class="state-error art art-offline"><strong>Could not load Analytics.</strong><p>${escapeHtml(AN.error.message || AN.error)}</p><button type="button" class="btn btn-sm" data-an-act="reload">Retry</button></div>`;
    return;
  }
  if (!AN.d) { mount.innerHTML = '<p class="state-empty art art-loading">Loading the numbers…</p>'; return; }
  const pane = { revenue: revenueHtml, time: timeHtml, ahead: aheadHtml }[AN.tab]();
  mount.innerHTML = `<div class="app-pane ${AN.dir}">${pane}</div>`;
  AN.dir = '';
  drawCharts(mount);
}

// ─── Revenue ──────────────────────────────────────────────────────────

const KIND = { new: 'New', periodic: 'Not monthly', left: 'Left', notdue: 'Not due this month' };

function revenueHtml() {
  const d = AN.d;
  if (d.errors.xero) return failed('Xero', d.errors.xero);
  if (!d.series.length) return '<p class="state-empty art art-empty">No Xero invoices yet. Connect Xero on Jobs, This month.</p>';
  const m = d.moves, c = d.conc;
  const diff = m.now - m.prev;
  const group = (title, total, rows, cls) => `<section class="an-mv-g ${cls}"><h3>${title}<b>${escapeHtml(total)}</b></h3>${rows.length ? rows.map(r =>
    `<div class="an-mv"><div class="an-mv-n">${clientLink(r.name)}${KIND[r.kind] ? `<span class="badge">${KIND[r.kind]}</span>` : ''}</div><div class="an-mv-b"><i style="width:${(Math.abs(r.v) / mvMax * 100).toFixed(1)}%"></i></div><b>${escapeHtml(signed(r.v))}</b></div>`).join('')
    : `<p class="an-quiet">Nobody.</p>`}</section>`;
  const mvMax = Math.max(1, ...m.gained.map(r => r.v), ...m.lost.map(r => -r.v));
  const sum = `<div class="an-sum">
      <div class="an-term"><span>${escapeHtml(monthName(m.from))}</span><strong>${big(m.prev)}</strong><small>recurring</small></div>
      <div class="an-term up"><span>Gained</span><strong><i>+</i>${big(m.gSum)}</strong><small>${plural(m.gained.length, 'client')}</small></div>
      <div class="an-term down"><span>Lost</span><strong><i>−</i>${big(m.lSum)}</strong><small>${plural(m.lost.length, 'client')}</small></div>
      <div class="an-term total"><span>${escapeHtml(monthName(m.to))}</span><strong><i>=</i>${big(m.now)}</strong><small>${Math.abs(diff) < 0.005 ? 'no change' : `<b class="${diff < 0 ? 'neg' : ''}">${escapeHtml(signed(diff))}</b>${m.prev > 0 ? `, ${diff > 0 ? 'up' : 'down'} ${Math.abs(diff / m.prev * 100).toFixed(1)}%` : ''}`} on ${escapeHtml(monthName(m.from))}</small></div>
    </div>`;
  const moves = m.gained.length || m.lost.length
    ? `<div class="an-moves">${group('Gained', '+' + gbp2(m.gSum), m.gained, 'up')}${group('Lost', '−' + gbp2(m.lSum), m.lost, 'down')}</div>`
    : none(`The same recurring invoices as ${monthName(m.from)}.`);
  const why = card('Why did recurring revenue change?',
    `${escapeHtml(monthName(m.from))} to ${escapeHtml(fmt(m.to, { month: 'long', year: 'numeric' }))}, from Xero repeating invoices${m.toCome > 0 ? `. ${escapeHtml(monthName(m.to))} includes ${escapeHtml(gbp2(m.toCome))} still to be raised` : ''}`,
    sum + moves);

  const months = card('Is each month on course?', 'Invoiced by month, from Xero',
    `<div class="an-legend"><span><i class="sw rec"></i>Recurring</span><span><i class="sw one"></i>One-off</span><span><i class="sw come"></i>Still to come</span></div>${chart('monthly')}
     ${d.errors.money ? `<p class="an-quiet">Margin not shown: ${escapeHtml(d.errors.money)}</p>` : ''}`,
    goBtn('This month', 'jobs:month'));

  const top = c.rows[0];
  const lead = c.rows.length
    ? `<p class="an-lead"><b>${pct(c.top3)}</b> comes from ${c.rows.length >= 3 ? 'three clients' : plural(c.rows.length, 'client')}. ${c.over === 0 ? `No client is over the ${pct(A.DEPENDENCE)} line.`
      : c.over === 1 ? `${escapeHtml(top.name)} alone is <b>${pct(top.share)}</b>, the only one over the ${pct(A.DEPENDENCE)} line.`
      : `<b>${c.over}</b> clients are over the ${pct(A.DEPENDENCE)} line.`}</p>${chart('conc')}`
    : none(`No repeating invoices for ${monthName(m.to)} yet.`);
  const ride = card('How much rides on a few clients?', `Each client’s share of ${escapeHtml(monthName(m.to))}’s recurring revenue`, lead);

  return why + `<div class="an-row2">${months}${ride}</div>`;
}

const CHARTS = {
  monthly(w) {
    const d = AN.d, M = d.series, cur = d.month;
    const margins = (d.margins || []).filter(x => x.margin != null);
    const l = 42, r = 6, top = 22, ph = 190, sh = 46, capY = top + ph + 52, base = capY + 26 + sh;
    const h = margins.length ? base + 26 : top + ph + 28;
    const { step, max } = niceMax(Math.max(1, ...M.map(m => m.total + m.recToCome + m.oneToCome)));
    const y = v => top + ph - v / max * ph, slot = (w - l - r) / M.length, cx = i => l + slot * (i + .5), bw = Math.min(24, slot * .45);
    const every = slot < 34 ? 2 : 1;
    let s = `<svg width="${w}" height="${h}" role="img" aria-label="Invoiced per month, recurring and one-off">`;
    for (let v = 0; v <= max; v += step) s += `<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>` + T(l - 8, y(v) + 4, kTick(v), 'ax', 'end');
    M.forEach((m, i) => {
      const segs = [[m.recurring, 'class="f-rec"', 'Recurring'], [m.recToCome, 'fill="url(#an-st-rec)"', 'Recurring still to come'],
        [m.oneOff, 'class="f-one"', 'One-off'], [m.oneToCome, 'fill="url(#an-st-one)"', 'Jobs still to invoice']].filter(x => x[0] > 0);
      const total = segs.reduce((t, x) => t + x[0], 0); let acc = 0;
      s += `<g ${tip(gbp2(total), fmt(m.month, { month: 'long', year: 'numeric' }) + (m.month === cur ? ', on course for' : ''), ...segs.map(x => `${x[2]} ${gbp2(x[0])}`))}><rect x="${cx(i) - slot / 2 + 1}" y="${top}" width="${slot - 2}" height="${ph}" fill="transparent"/>`;
      segs.forEach(([v, paint]) => { const y1 = y(acc + v); s += `<rect x="${cx(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(y(acc) - y1 - 2, 1)}" rx="2" ${paint}/>`; acc += v; });
      s += '</g>';
      if (slot >= 46 || i === M.length - 1) s += T(cx(i), y(total) - 8, gbp(total), 'vl', 'middle');
      if ((M.length - 1 - i) % every === 0) s += T(cx(i), top + ph + 18, monthName(m.month, 'short'), 'ax', 'middle');
    });
    if (margins.length) {
      // Margin is its own strip on the same months, never a second scale on the bars.
      const shown = margins.filter(x => x.month !== cur || x.licenceIn);
      const vals = shown.map(x => x.margin), lo = Math.min(...vals, 1) - .03, hi = Math.max(...vals, 0) + .03;
      const y2 = v => base - (v - lo) / Math.max(hi - lo, .01) * sh;
      const at = x => cx(M.findIndex(m => m.month === x.month));
      s += T(l, capY, 'Kept after suppliers (Profitability’s margin)', 'cap') + `<line x1="${l}" x2="${w - r}" y1="${base + 8}" y2="${base + 8}" class="grid"/>`;
      if (shown.length > 1) s += `<polyline points="${shown.map(x => `${at(x).toFixed(1)},${y2(x.margin).toFixed(1)}`).join(' ')}" class="line-rec"/>`;
      shown.forEach((x, i) => {
        s += `<g ${tip(pct(x.margin), fmt(x.month, { month: 'long', year: 'numeric' }), `Recurring ${gbp2(x.recurring)}`, `Cost ${gbp2(x.cost)}`)}><circle cx="${at(x)}" cy="${y2(x.margin)}" r="12" fill="transparent"/><circle cx="${at(x)}" cy="${y2(x.margin)}" r="4.5" class="f-rec ring"/></g>`;
        if (slot >= 40 || i === 0 || i === shown.length - 1) s += T(at(x), y2(x.margin) - 10, pct(x.margin), 'vl', 'middle');
      });
      const open = margins.find(x => x.month === cur && !x.licenceIn);
      if (open) {
        const ly = shown.length ? y2(shown[shown.length - 1].margin) : base - sh / 2;
        s += `<g ${tip('Not yet', `${monthName(cur)} needs the TD SYNNEX invoice, usually dated around the 16th`)}><circle cx="${at(open)}" cy="${ly}" r="12" fill="transparent"/><circle cx="${at(open)}" cy="${ly}" r="4.5" class="hollow"/></g>`
          + T(Math.min(at(open), w - r - 50), ly + 20, 'licences not in yet', 'sub', 'middle');
      }
    }
    return s + '</svg>';
  },

  conc(w) {
    const c = AN.d.conc, LIMIT = 12;
    const rest = c.rows.slice(LIMIT);
    const rows = rest.length ? [...c.rows.slice(0, LIMIT), { name: `${rest.length} others`, v: rest.reduce((t, r) => t + r.v, 0), share: rest.reduce((t, r) => t + r.share, 0), over: false, folded: true }] : c.rows;
    const lab = Math.min(170, Math.max(112, w * .36)), valw = 42, rh = 24, top = 20, pw = w - lab - valw, h = top + rows.length * rh + 4;
    const max = Math.max(.2, Math.ceil(Math.max(...rows.map(r => r.share)) * 20) / 20), x = v => lab + v / max * pw;
    let s = `<svg width="${w}" height="${h}" role="img" aria-label="Share of recurring revenue by client">`;
    s += `<line x1="${x(A.DEPENDENCE)}" x2="${x(A.DEPENDENCE)}" y1="${top - 4}" y2="${h}" class="rule"/>` + T(x(A.DEPENDENCE), 10, pct(A.DEPENDENCE), 'ax', 'middle');
    rows.forEach((r, i) => {
      const yy = top + i * rh;
      s += `<g ${tip(`${gbp2(r.v)} a month`, r.name, `${(r.share * 100).toFixed(1)}% of recurring revenue`)}><rect x="0" y="${yy}" width="${w}" height="${rh}" fill="transparent"/>
        <rect x="${lab}" y="${yy + 7}" width="${Math.max(x(r.share) - lab, 2)}" height="10" rx="3" class="${r.over ? 'f-rec' : 'f-mute'}"/></g>`;
      s += T(0, yy + 16, fit(r.name, lab, 7.1), r.folded ? 'lbm' : 'lb') + T(x(r.share) + 7, yy + 16, pct(r.share), 'vl');
    });
    return s + '</svg>';
  },

  // ─── Time ───────────────────────────────────────────────────────────
  heat(w) {
    const g = AN.d.grid, lab = 32, step = Math.max(10, Math.min(34, Math.floor((w - lab) / g.weeks))), cell = step - 2, rx = Math.min(4, cell / 4), mh = 16;
    const block = 22 + mh + 5 * step + 12, h = block * g.people.length - 8, dn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    let s = `<svg width="${w}" height="${h}" role="img" aria-label="Hours logged each weekday for ${g.weeks} weeks, per person">`;
    g.people.forEach((p, pi) => {
      const y0 = pi * block, gy = y0 + 22 + mh; let lastM = '', lastX = -99;
      s += T(0, y0 + 13, p.name, 'lb');
      dn.forEach((n, i) => { if (step >= 15 || i % 2 === 0) s += T(0, gy + i * step + cell * .5 + 4, n, 'ax'); });
      p.weeks.forEach((wk, i) => {
        const x = lab + i * step, m = wk[0].date.slice(0, 7);
        if (m !== lastM && x - lastX > 30) { s += T(x, gy - 6, monthName(m, 'short'), 'ax'); lastX = x; }
        lastM = m;
        wk.forEach((d, di) => {
          const yy = gy + di * step, when = fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' });
          if (d.state === 'future') s += `<rect x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="${rx}" class="f-none"/>`;
          else if (d.state === 'away' || d.state === 'closed') s += `<rect x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="${rx}" fill="url(#an-st-away)" ${tip(d.state === 'away' ? 'Away' : 'Nobody logged: closed', when, p.name)}/>`;
          else if (d.state === 'blank') s += `<g ${tip('Nothing logged', when, p.name)}><rect x="${x}" y="${yy}" width="${cell}" height="${cell}" fill="transparent"/><rect x="${x + .75}" y="${yy + .75}" width="${cell - 1.5}" height="${cell - 1.5}" rx="${rx}" class="blank"/></g>`;
          else s += `<rect x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="${rx}" class="f-h${1 + g.cuts.filter(c => d.hours > c).length}" ${tip(`${hrs(d.hours)} h`, when, p.name + (d.top ? `, mostly ${d.top}` : ''))}/>`;
        });
      });
    });
    return s + '</svg>';
  },

  weeks(w) {
    const ws = AN.d.kinds, l = 34, r = 6, top = 12, ph = 190, h = top + ph + 26;
    const { step, max } = niceMax(Math.max(1, ...ws.map(x => x.total)));
    const y = v => top + ph - v / max * ph, slot = (w - l - r) / ws.length, cx = i => l + slot * (i + .5), bw = Math.min(24, slot * .58), every = slot < 44 ? 3 : slot < 64 ? 2 : 1;
    let s = `<svg width="${w}" height="${h}" role="img" aria-label="Hours per week by kind of work">`;
    for (let v = 0; v <= max; v += step) s += `<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>` + T(l - 8, y(v) + 4, v + (v === max ? ' h' : ''), 'ax', 'end');
    ws.forEach((wk, i) => {
      let acc = 0;
      s += `<g ${tip(`${hrs(wk.total)} h`, `Week of ${fmt(wk.start, { day: 'numeric', month: 'short' })}`, `Support ${hrs(wk.support)} h`, `Planned work ${hrs(wk.planned)} h`, `Other ${hrs(wk.other)} h`)}><rect x="${cx(i) - slot / 2}" y="${top}" width="${slot}" height="${ph}" fill="transparent"/>`;
      [[wk.support, 'f-rec'], [wk.planned, 'f-one'], [wk.other, 'f-mute']].forEach(([v, c]) => {
        if (v <= 0) return;
        const y1 = y(acc + v); s += `<rect x="${cx(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(y(acc) - y1 - 2, 1)}" rx="2" class="${c}"/>`; acc += v;
      });
      s += '</g>';
      if ((ws.length - 1 - i) % every === 0) s += T(cx(i), top + ph + 18, fmt(wk.start, { day: 'numeric', month: 'short' }), 'ax', 'middle');
    });
    return s + '</svg>';
  },

  // ─── Ahead ──────────────────────────────────────────────────────────
  ssa(w) {
    const R = AN.d.renewals, rows = R.rows, today = AN.d.today, t0 = ms(today);
    const span = Math.min(365, Math.max(90, ...rows.map(c => c.days + 14))), end = t0 + span * DAY;
    const lw = Math.min(176, Math.max(116, w * .36)), rw = 54, top = 24, rh = 50, wh = 30, h = top + rows.length * rh + 4;
    const x = t => lw + Math.min(1, (t - t0) / (end - t0)) * (w - lw - rw), x0 = x(t0);
    const maxLeft = Math.max(1, ...rows.map(c => c.remaining));
    let s = `<svg width="${w}" height="${h}" role="img" aria-label="Each client’s prepaid support hours running down to the day they run out">`;
    s += `<rect x="${x0}" y="${top - 4}" width="${x(t0 + A.SOON_DAYS * DAY) - x0}" height="${h - top + 4}" class="zone"/>`;
    const first = new Date(t0); first.setUTCDate(1); first.setUTCMonth(first.getUTCMonth() + 1);
    const perMonth = (w - lw - rw) / (span / 30.44), every = perMonth < 26 ? 3 : perMonth < 40 ? 2 : 1;
    for (let m = new Date(first), i = 0; m.getTime() < end; m.setUTCMonth(m.getUTCMonth() + 1), i++) {
      s += `<line x1="${x(m.getTime())}" x2="${x(m.getTime())}" y1="${top - 4}" y2="${h}" class="grid"/>`;
      if (i % every === 0 && x(m.getTime()) - x0 > 34) s += T(x(m.getTime()) + 4, 10, m.toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short' }), 'ax');
    }
    s += `<line x1="${x0}" x2="${x0}" y1="${top - 4}" y2="${h}" class="rule"/>` + T(x0 - 4, 10, 'Today', 'ax', 'end');
    rows.forEach((c, i) => {
      const yy = top + i * rh, base = yy + rh - 10, k = c.state === 'over' ? 'red' : c.state === 'soon' ? 'amber' : 'rec';
      const when = c.over ? 'Now' : fmt(c.out, { day: 'numeric', month: 'short' }), bal = c.over ? `${hrs(-c.remaining)} h over` : `${hrs(c.remaining)} h left`;
      const x1 = x(ms(c.out)), y0 = base - Math.max(c.remaining, 0) / maxLeft * wh;
      s += `<g ${tip(c.over ? 'Renew now' : `Runs out ${when}`, c.name, `${bal}, using ${hrs(c.perMonth)} h a month`, `Renewal ${gbp(R.price)}`)}><rect x="0" y="${yy}" width="${w}" height="${rh}" fill="transparent"/>`;
      s += `<line x1="${x0}" x2="${w - rw}" y1="${base}" y2="${base}" class="grid"/>`;
      s += c.over ? `<circle cx="${x0}" cy="${base}" r="5" class="f-red ring"/>`
        : `<polygon points="${x0},${y0} ${x1},${base} ${x0},${base}" class="w-${k}"/><line x1="${x0}" y1="${y0}" x2="${x1}" y2="${base}" class="l-${k}"/><circle cx="${x1}" cy="${base}" r="4.5" class="f-${k} ring"/>`;
      s += '</g>' + T(0, yy + 20, fit(c.name, lw, 6.8), 'lb') + T(0, yy + 34, bal, 'sub') + T(w, yy + 34, when, 'vl', 'end');
    });
    return s + '</svg>';
  }
};

// ─── Time ─────────────────────────────────────────────────────────────

function timeHtml() {
  const d = AN.d;
  if (d.errors.time) return failed('Timesheets', d.errors.time);
  const g = d.grid, k = d.kinds;
  const since = fmt(g.start, { day: 'numeric', month: 'long' });
  const heat = card('Is every working day logged?', `Hours logged each weekday, last ${g.weeks} weeks`,
`<p class="an-lead">${g.logged ? `Client time was logged on <b>${g.logged}</b> of <b>${g.logged + g.blanks}</b> working days since ${escapeHtml(since)}${g.blanks ? `, leaving <b>${g.blanks}</b> with nothing` : ''}. A typical logged day is <b>${hrs(g.typical)} h</b>.`
      : `Nothing logged since ${escapeHtml(since)}.`}</p>
     ${chart('heat')}
     <div class="an-legend"><span class="ramp">Fewer<i class="sw h1"></i><i class="sw h2"></i><i class="sw h3"></i><i class="sw h4"></i>more hours</span><span><i class="sw away"></i>Away or closed</span><span><i class="sw blank"></i>Nothing logged</span></div>
     ${d.errors.leave ? `<p class="an-quiet">Leave didn’t load, so days off may show as nothing logged: ${escapeHtml(d.errors.leave)}</p>` : ''}`,
    goBtn('Log time', 'timesheets:log'));
  // Typed weeks only: a mix worked out from the few entries that carry a work type would be a guess.
  const typed = A.typedShare(k), usable = k.filter(w => w.total > 0 && w.untyped / w.total < .2);
  const last = A.supportShare(usable.slice(-4)), before = usable.length >= 8 ? A.supportShare(usable.slice(-8, -4)) : null;
  const body = typed == null ? none(`Nothing logged in the last ${k.length} weeks.`)
    : typed < .5 ? none(`Only ${pct(typed)} of the hours logged in the last ${k.length} weeks have a work type, so there is nothing to compare yet. This fills in as new entries are logged with one.`)
    : `<p class="an-lead">${last == null ? 'No week has enough typed entries yet.' : `Support took <b>${pct(last)}</b> of logged time in the last ${plural(Math.min(4, usable.length), 'typed week')}${before != null ? `, against <b>${pct(before)}</b> in the four before` : ''}.`}${typed < .95 ? ` ${pct(1 - typed)} of the hours have no work type and count as other.` : ''}</p>
     <div class="an-legend"><span><i class="sw rec"></i>Support</span><span><i class="sw one"></i>Planned work</span><span><i class="sw mute"></i>Other or no type</span></div>${chart('weeks')}`;
  const weeks = card('Is support crowding out project work?', `Hours logged per week by kind of work, last ${k.length} weeks`, body, goBtn('Weekly summary', 'timesheets:week'));
  return heat + weeks;
}

// ─── Ahead ────────────────────────────────────────────────────────────

function aheadHtml() {
  const d = AN.d;
  let ssa;
  if (d.errors.time) ssa = failed('Timesheets', d.errors.time);
  else {
    const R = d.renewals, shown = R.byMonth.slice(0, 4), later = R.byMonth.slice(4);
    const cells = shown.map(m => `<div class="kpi"><span class="kpi-label">${escapeHtml(monthName(m.month))}</span><span class="kpi-value">${escapeHtml(gbp(m.value))}</span><span class="kpi-sub">${plural(m.count, 'renewal')}</span></div>`).join('')
      + (later.length ? `<div class="kpi"><span class="kpi-label">Later</span><span class="kpi-value">${escapeHtml(gbp(later.reduce((t, m) => t + m.value, 0)))}</span><span class="kpi-sub">${plural(later.reduce((t, m) => t + m.count, 0), 'renewal')}</span></div>` : '');
    ssa = card('Which support blocks run out next?', 'Prepaid SSA hours at each client’s pace over the last 90 days',
      R.rows.length ? `<div class="kpi-panel an-kpis flat">${cells}</div>
        <div class="an-legend"><span>Height: hours left today</span><span>Slope: how fast they are used</span><span><i class="sw soon"></i>Next ${A.SOON_DAYS} days</span></div>${chart('ssa')}
        ${R.quiet.length ? `<p class="an-quiet">${plural(R.quiet.length, 'client has', 'clients have')} hours left and used none in 90 days, so no date.</p>` : ''}`
        : none('No SSA client is using hours at the moment.'),
      goBtn('SSA dashboard', 'timesheets:ssa'));
  }

  let gaps;
  if (AN.wsError) gaps = `<div class="state-error"><strong>The gaps map didn’t load.</strong><p>${escapeHtml(AN.wsError)}</p><button type="button" class="btn btn-sm" data-an-act="gaps">Retry</button></div>`;
  else if (!AN.ws) gaps = none('Reading the gaps map…');
  else if (!AN.ws.rows.length) gaps = none('No products in the catalogue yet. Add them on Opportunities, Products.');
  else {
    const W = AN.ws, top = W.rows[0];
    const TIP = t => (t.state === 'has' ? ['Has it', t.client] : t.state === 'deal' ? ['In the pipeline', t.client, t.mrr ? `${gbp2(t.mrr)} a month` : '']
      : t.state === 'gap' ? [t.mrr ? `+${gbp2(t.mrr)} a month` : 'Price not set', t.client, 'Could have it'] : [t.why || 'Not offered', t.client]);
    gaps = `<p class="an-lead"><b>${W.gaps}</b> ${W.gaps === 1 ? 'gap' : 'gaps'} across <b>${W.clients}</b> clients.${top?.gaps ? ` ${escapeHtml(top.name)} has the most room: <b>${top.gaps}</b> could have it.` : ''}${W.total > 0 ? ` The priced gaps add up to <b>${escapeHtml(gbp(W.total))}</b> a month.` : ''}${W.pipeline > 0 ? ` <b>${escapeHtml(gbp(W.pipeline))}</b> a month is already in the pipeline.` : ''}${W.unpriced ? ` ${plural(W.unpriced, 'gap has', 'gaps have')} no monthly value, because the product has none in the catalogue.` : ''}</p>
      <div class="an-legend"><span><i class="sw rec"></i>Has it</span><span><i class="sw one"></i>In the pipeline</span><span><i class="sw gap"></i>Could have it</span><span><i class="sw off"></i>Not offered</span></div>
      <div class="an-ws">${W.rows.map(r => `<div class="an-ws-row"><div class="an-ws-name">${escapeHtml(r.name)}</div><div class="an-ws-tok">${r.tokens.map(t => `<i class="tok ${t.state}" ${tip(...TIP(t))}></i>`).join('')}</div><div class="an-ws-val">${r.gaps}<small>could have it${r.total > 0 ? `, +${escapeHtml(gbp(r.total))} a month` : ''}</small></div></div>`).join('')}</div>`;
  }
  return ssa + card('Where is the next pound of recurring revenue?', 'One square per client, largest client first, from the Opportunities gaps map', gaps, goBtn('Gaps map', 'opportunities:gaps'));
}

// ─── Charts, tooltip, events ──────────────────────────────────────────

let observer = null;
function drawCharts(root) {
  observer?.disconnect();
  observer = typeof ResizeObserver === 'function' ? new ResizeObserver(list => list.forEach(e => draw(e.target))) : null;
  root.querySelectorAll('.an-chart').forEach(el => { draw(el); observer?.observe(el); });
}
function draw(el) {
  const w = Math.floor(el.clientWidth);
  if (!w || w === el.drawnAt || !CHARTS[el.dataset.chart]) return;   // hidden (width 0) or unchanged
  el.drawnAt = w;
  el.innerHTML = CHARTS[el.dataset.chart](w);
}

function showTip(el, px, py) {
  const box = els('anTip');
  if (!box) return;
  const [head, ...rest] = el.dataset.tip.split('|');
  box.textContent = '';
  const b = document.createElement('b'); b.textContent = head; box.append(b);
  rest.forEach(t => { const d = document.createElement('div'); d.textContent = t; box.append(d); });
  box.hidden = false;
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(px + 14, window.innerWidth - r.width - 8)) + 'px';
  box.style.top = (py + 18 + r.height > window.innerHeight ? py - r.height - 12 : py + 18) + 'px';
}
const hideTip = () => { const box = els('anTip'); if (box) box.hidden = true; };

function onClick(e) {
  const tab = e.target.closest('[data-an-tab]');
  if (tab) { switchTab(tab.dataset.anTab); return; }
  const go = e.target.closest('[data-an-go]');
  if (go) { const [s, t] = go.dataset.anGo.split(':'); if (t) window.geckoGo?.(s, t); else window.navTo?.(s); return; }
  const a = e.target.closest('[data-an-act]')?.dataset.anAct;
  if (a === 'reload') load();
  if (a === 'gaps') loadGaps(true);
  if (a === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
}

export function init() {
  const section = els('section-analytics');
  if (!section) return;
  section.addEventListener('click', onClick);
  section.addEventListener('keydown', e => keyNav(e, 'data-an-tab', switchTab));
  section.addEventListener('pointermove', e => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else hideTip(); });
  section.addEventListener('pointerleave', hideTip);
  section.addEventListener('focusin', e => { const el = e.target.closest?.('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.bottom - 8); } });
  section.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });
  window.addEventListener('resize', () => moveInk(tabStrip()));
  els('anRefresh')?.addEventListener('click', async () => {
    const b = els('anRefresh');
    b.disabled = true; b.classList.add('spinning'); b.setAttribute('aria-busy', 'true');
    AN.ws = null;
    await load();
    b.disabled = false; b.classList.remove('spinning'); b.removeAttribute('aria-busy');
    if (!AN.error) toast('Analytics refreshed', 'success', 2500);
  });
  load();
}

/** Open a tab from elsewhere: geckoGo('analytics', 'ahead'). */
export function show(tab) { switchTab(tab); }
