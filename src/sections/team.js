/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   TEAM OVERVIEW                                                   ║
   ║                                                                   ║
   ║   The first tab of the Team hub (with Leave and Mileage): for     ║
   ║   Philip and Jack, who's in, holiday left this tax year, the      ║
   ║   next four weeks, hours logged this week, mileage to claim.      ║
   ║   Read only: buttons go to Leave, Mileage and Timesheets.         ║
   ║   Logic: core/team.js. Design: docs/superpowers/specs/            ║
   ║   2026-10-09-gecko-hq-structure-design.md (stage 3).              ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { selectAllPages } from '../core/store.js';
import { PEOPLE, DAY_HOURS, taxYear, holiday, bars, daysBetween, tokensHtml, presence, hours, mileage, monday, addDays } from '../core/team.js';

const TM = { data: null, loading: false, error: null };
const els = id => document.getElementById(id);
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const settle = p => p.then(v => ({ v }), e => ({ e }));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const money = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const h = v => (Number(v) || 0).toFixed(2).replace(/\.?0+$/, '') + 'h';
const days = v => { const d = Math.round((Number(v) || 0) / DAY_HOURS * 2) / 2; return `${d} day${d === 1 ? '' : 's'}`; };
const short = k => new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const weekday = k => new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
const range = (a, b) => (!b || a === b ? short(a) : `${short(a)} – ${short(b)}`);
const longDay = k => new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const dayNum = v => Math.round((Number(v) || 0) / DAY_HOURS * 2) / 2;
const WEEKS = 4;

async function load() {
  TM.loading = true; TM.error = null; render();
  try {
    const sb = await connectSupabase();
    const since = addDays(monday(today()), -7);
    const q = (table, cols, f = x => x) => settle(f(sb.from(table).select(cols)).then(must));
    const [requests, ents, journeys, entries] = await Promise.all([
      q('leave_requests', 'id,person,start_date,end_date,hours,status,leave_type,notes'),
      q('leave_entitlements', 'person,tax_year,entitlement_hours,carry_over_hours,adjustment_hours'),
      // Every journey, in pages: Supabase answers 1000 rows at most, and "to claim" must not undercount.
      settle(selectAllPages((from, to) => sb.from('mileage_journeys').select('id,driver,journey_date,miles,amount,claimed_date').order('id').range(from, to))),
      q('timesheet_entries', 'engineer,entry_date,hours,deleted_at', x => x.gte('entry_date', since))
    ]);
    const status = s => (/approved/i.test(s) ? 'Approved' : /rejected/i.test(s) ? 'Rejected' : /cancel/i.test(s) ? 'Cancelled' : 'Pending');
    TM.data = {
      requests: requests.v ? requests.v.map(r => ({ person: r.person, start: r.start_date, end: r.end_date || r.start_date, hours: Number(r.hours) || 0, status: status(r.status), type: r.leave_type || 'Annual Leave', note: r.notes || '', id: r.id })) : null,
      ents: ents.v || [], journeys: journeys.v || null, entries: entries.v || null,
      errors: { leave: requests.e?.message || '', mileage: journeys.e?.message || '', hours: entries.e?.message || '' }
    };
    const sync = els('teamLastSync');
    if (sync) sync.textContent = 'Synced ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    TM.error = err;
  } finally {
    TM.loading = false; render();
  }
}

function render() {
  const mount = els('teamWrap');
  if (!mount) return;
  if (TM.error) {
    mount.innerHTML = TM.error.code === 'DB_SIGNIN_REQUIRED'
      ? '<div class="tm-error art art-offline"><strong>Connect to the Gecko database</strong><button type="button" class="btn btn-sm" data-tm-act="connect">Connect</button></div>'
      : `<div class="tm-error art art-offline"><strong>Could not load the team.</strong>${escapeHtml(TM.error.message || TM.error)}<button type="button" class="btn btn-sm" data-tm-act="reload">Retry</button></div>`;
    return;
  }
  if (!TM.data) { mount.innerHTML = '<p class="tm-empty art art-loading">Loading the team…</p>'; return; }
  const t = today(), ty = taxYear(t), d = TM.data;
  const pres = d.requests ? presence(d.requests, t) : null;
  const hrs = d.entries ? hours(d.entries, t) : null;
  const mil = d.journeys ? mileage(d.journeys, t) : null;
  const cards = PEOPLE.map(p => {
    const hol = d.requests ? holiday(d.requests, d.ents, p, ty) : null;
    const pr = pres?.[p];
    const away = pr?.off;
    const what = r => r.note || (r.type === 'Annual Leave' ? 'Holiday' : r.type);
    const statusLine = !pr ? `<span class="tm-state">${escapeHtml(d.errors.leave ? 'Leave didn’t load' : '—')}</span>`
      : away ? `<span class="tm-state away"><b aria-hidden="true"></b>Away · back ${escapeHtml(longDay(pr.back))}</span><span class="tm-state-sub">${escapeHtml(what(pr.now))}</span>`
      : `<span class="tm-state in"><b aria-hidden="true"></b>In today</span><span class="tm-state-sub">${pr.next ? `Next off ${escapeHtml(range(pr.next.start, pr.next.end))}${pr.next.status === 'Pending' ? ' (requested)' : ''}` : 'No leave booked'}</span>`;
    const left = hol ? dayNum(hol.remaining) : null;
    const maxDay = Math.max(1, ...(hrs?.[p]?.byDay || [0]));
    const m = mil?.[p];
    return `<article class="tm-card tm-${p.toLowerCase()}${away ? ' is-away' : ''}">
      <header class="tm-card-head"><div class="tm-av" aria-hidden="true">${p[0]}</div><div class="tm-who"><h2>${p} Morris</h2>${statusLine}</div></header>
      <section class="tm-hol" aria-label="Holiday ${escapeHtml(ty)}">
        <div class="tm-row-head"><span>Holiday ${escapeHtml(ty)}</span>${hol ? `<strong class="${hol.remaining < 0 ? 'bad' : hol.remaining < DAY_HOURS ? 'low' : ''}">${escapeHtml(String(left))}<small> day${left === 1 ? '' : 's'} left</small></strong>` : '<strong>—</strong>'}</div>
        ${hol ? tokensHtml(hol) : `<p class="tm-muted">${escapeHtml(d.errors.leave || 'Leave didn’t load')}</p>`}
        ${hol ? `<p class="tm-sub">${escapeHtml(String(dayNum(hol.booked)))} booked · ${escapeHtml(String(dayNum(hol.pending)))} requested · of ${escapeHtml(String(dayNum(hol.entitlement)))}</p>` : ''}
      </section>
      <section class="tm-figs">
        <div class="tm-fig"><span>Hours this week</span><strong>${hrs ? escapeHtml(h(hrs[p].week)) : '—'}</strong><small>${hrs ? `last week ${escapeHtml(h(hrs[p].last))}` : escapeHtml(d.errors.hours || 'Timesheets didn’t load')}</small>
          ${hrs ? `<div class="tm-days" aria-hidden="true">${hrs[p].byDay.slice(0, 5).map((v, i) => `<div title="${escapeHtml(h(v))}"><i style="height:${(v / maxDay * 100).toFixed(1)}%"></i><span>${'MTWTF'[i]}</span></div>`).join('')}</div>` : ''}</div>
        <div class="tm-fig"><span>Mileage to claim</span><strong class="${m?.unclaimed ? 'warn' : ''}">${m ? escapeHtml(m.unclaimed ? money(m.unclaimed) : '£0') : '—'}</strong><small>${m ? (m.unclaimed ? `${m.unclaimedTrips} trip${m.unclaimedTrips === 1 ? '' : 's'} since ${escapeHtml(short(m.oldest))}` : 'all claimed') : escapeHtml(d.errors.mileage || 'Mileage didn’t load')}</small></div>
      </section>
      <footer class="tm-actions">
        <button type="button" class="btn btn-sm" data-tm-go="leave">Book leave</button>
        <button type="button" class="btn btn-sm" data-tm-go="mileage">${m?.unclaimed ? 'Claim mileage' : 'Add journey'}</button>
        <button type="button" class="btn btn-sm" data-tm-go="timesheets:log">Log time</button>
      </footer>
    </article>`;
  }).join('');

  let strip = `<p class="tm-muted">${escapeHtml(d.errors.leave || 'Leave didn’t load')}</p>`;
  if (d.requests) {
    const from = monday(t), to = addDays(from, WEEKS * 7 - 1);
    const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(from, i));
    const we = k => [0, 6].includes(new Date(k + 'T00:00:00Z').getUTCDay());
    const col = k => daysBetween(from, k) + 2;
    const all = bars(d.requests, from, to);
    const cells = days.map(k => `<span class="tm-c${we(k) ? ' we' : ''}${k === t ? ' today' : ''}${k.endsWith('-01') || k === from ? ' m' : ''}" style="grid-column:${col(k)}"></span>`).join('');
    strip = `<div class="tm-plan" role="group" aria-label="Who’s off, next four weeks">
      <div class="tm-plan-row head"><span></span>${days.map((k, i) => `<span class="${k === t ? 'today' : ''}${we(k) ? ' we' : ''}${i % 7 ? '' : ' mon'}" style="grid-column:${col(k)}" title="${escapeHtml(longDay(k))}">${k.endsWith('-01') || k === from ? `<em>${escapeHtml(new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' }))}</em>` : ''}${Number(k.slice(8))}</span>`).join('')}</div>
      ${PEOPLE.map(p => `<div class="tm-plan-row tm-${p.toLowerCase()}"><span class="tm-plan-who">${p}</span>${cells}${all.filter(x => x.person === p).map(x =>
        `<button type="button" class="tm-bar${x.status === 'Pending' ? ' pending' : ''}${x.cutStart ? ' cut-s' : ''}${x.cutEnd ? ' cut-e' : ''}" style="grid-column:${col(x.from)} / ${col(x.to) + 1}" data-tm-go="leave" title="${escapeHtml(`${p} · ${range(x.from, x.to)} · ${x.note || x.type}${x.status === 'Pending' ? ' · requested' : ''}`)}">${escapeHtml(x.note || x.type)}</button>`).join('')}</div>`).join('')}
    </div>
    <ul class="tm-legend"><li><b class="booked"></b>Booked</li><li><b class="pending"></b>Requested</li><li><b class="today"></b>Today</li></ul>`;
  }

  mount.innerHTML = `<div class="app-pane">
    <div class="tm-cards">${cards}</div>
    <section class="tm-panel"><div class="tm-panel-head"><h2>Next four weeks</h2><button type="button" class="btn btn-sm btn-ghost" data-tm-go="leave">Year planner →</button></div>${strip}</section>
  </div>`;
}

function onClick(e) {
  const g = e.target.closest('[data-tm-go]');
  if (g) { const [s, t] = g.dataset.tmGo.split(':'); window.geckoGo?.(s, t); return; }
  const a = e.target.closest('[data-tm-act]')?.dataset.tmAct;
  if (a === 'reload') load();
  if (a === 'connect') connectSupabase({ interactive: true }).then(load, err => toast(err.message || 'Could not connect', 'error'));
}

export function init() {
  els('section-team')?.addEventListener('click', onClick);
  els('teamRefresh')?.addEventListener('click', async () => {
    const b = els('teamRefresh');
    b.disabled = true; b.classList.add('spinning'); b.setAttribute('aria-busy', 'true');
    await load();
    b.disabled = false; b.classList.remove('spinning'); b.removeAttribute('aria-busy');
    if (!TM.error) toast('Team refreshed', 'success', 2500);
  });
  load();
}
