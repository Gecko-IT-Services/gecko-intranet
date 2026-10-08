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
import { PEOPLE, DAY_HOURS, taxYear, holiday, calendar, presence, hours, mileage, monday, addDays } from '../core/team.js';

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

async function load() {
  TM.loading = true; TM.error = null; render();
  try {
    const sb = await connectSupabase();
    const since = addDays(monday(today()), -7);
    const q = (table, cols, f = x => x) => settle(f(sb.from(table).select(cols)).then(must));
    const [requests, ents, journeys, entries] = await Promise.all([
      q('leave_requests', 'person,start_date,end_date,hours,status,leave_type'),
      q('leave_entitlements', 'person,tax_year,entitlement_hours,carry_over_hours,adjustment_hours'),
      q('mileage_journeys', 'driver,journey_date,miles,amount,claimed_date'),
      q('timesheet_entries', 'engineer,entry_date,hours,deleted_at', x => x.gte('entry_date', since))
    ]);
    const status = s => (/approved/i.test(s) ? 'Approved' : /rejected/i.test(s) ? 'Rejected' : /cancel/i.test(s) ? 'Cancelled' : 'Pending');
    TM.data = {
      requests: requests.v ? requests.v.map(r => ({ person: r.person, start: r.start_date, end: r.end_date || r.start_date, hours: Number(r.hours) || 0, status: status(r.status), type: r.leave_type || 'Annual Leave' })) : null,
      ents: ents.v || [], journeys: journeys.v || null, entries: entries.v || null,
      errors: { leave: requests.e?.message || '', mileage: journeys.e?.message || '', hours: entries.e?.message || '' }
    };
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
      ? '<div class="tm-error"><strong>Connect to the Gecko database</strong><button type="button" class="tm-btn" data-tm-act="connect">Connect</button></div>'
      : `<div class="tm-error"><strong>Could not load the team.</strong>${escapeHtml(TM.error.message || TM.error)}<button type="button" class="tm-btn" data-tm-act="reload">Retry</button></div>`;
    return;
  }
  if (!TM.data) { mount.innerHTML = '<p class="tm-empty">Loading the team…</p>'; return; }
  const t = today(), ty = taxYear(t), d = TM.data;
  const pres = d.requests ? presence(d.requests, t) : null;
  const hrs = d.entries ? hours(d.entries, t) : null;
  const mil = d.journeys ? mileage(d.journeys, t) : null;
  const cards = PEOPLE.map(p => {
    const hol = d.requests ? holiday(d.requests, d.ents, p, ty) : null;
    const pr = pres?.[p];
    const used = hol ? Math.max(0, Math.min(1, hol.booked / (hol.entitlement || 1))) : 0;
    const status = !pr ? '<span class="tm-pill">—</span>'
      : pr.off ? `<span class="tm-pill off">Off · back ${escapeHtml(short(pr.back))}</span>` : '<span class="tm-pill in">In today</span>';
    const maxDay = Math.max(1, ...(hrs?.[p]?.byDay || [0]));
    return `<div class="tm-card">
      <div class="tm-card-head"><div class="tm-av" aria-hidden="true">${p[0]}</div><div><strong>${p} Morris</strong>${status}</div></div>
      <div class="tm-card-body">
        <div class="tm-ring ${hol && hol.remaining < DAY_HOURS ? 'low' : ''}" style="--used:${(used * 100).toFixed(1)}">
          <div class="tm-ring-in"><strong>${hol ? escapeHtml(days(hol.remaining)) : '—'}</strong><span>holiday left ${escapeHtml(ty)}</span></div>
        </div>
        <ul class="tm-facts">
          <li><span>Booked</span><span>${hol ? escapeHtml(days(hol.booked)) : '—'}</span></li>
          <li><span>Pending</span><span>${hol ? escapeHtml(days(hol.pending)) : '—'}</span></li>
          <li><span>Next off</span><span>${pr?.next ? escapeHtml(range(pr.next.start, pr.next.end)) + (pr.next.status === 'Pending' ? ' (pending)' : '') : 'nothing booked'}</span></li>
          <li><span>Mileage to claim</span><span>${mil ? (mil[p].unclaimed ? `<b class="warn">${escapeHtml(money(mil[p].unclaimed))}</b> · ${mil[p].unclaimedTrips} trip${mil[p].unclaimedTrips === 1 ? '' : 's'}` : 'all claimed') : '—'}</span></li>
        </ul>
      </div>
      <div class="tm-week">
        <div class="tm-week-head"><span>Hours this week</span><strong>${hrs ? escapeHtml(h(hrs[p].week)) : '—'}</strong>${hrs ? `<small>last week ${escapeHtml(h(hrs[p].last))}</small>` : ''}</div>
        ${hrs ? `<div class="tm-days">${hrs[p].byDay.slice(0, 5).map((v, i) => `<div title="${escapeHtml(h(v))}"><i style="height:${(v / maxDay * 100).toFixed(1)}%"></i><span>${'MTWTF'[i]}</span></div>`).join('')}</div>` : `<p class="tm-muted">${escapeHtml(d.errors.hours || 'Timesheets didn’t load')}</p>`}
      </div>
      <div class="tm-actions">
        <button type="button" class="tm-btn ghost" data-tm-go="leave">Book leave</button>
        <button type="button" class="tm-btn ghost" data-tm-go="mileage">${mil?.[p]?.unclaimed ? 'Claim mileage' : 'Add journey'}</button>
        <button type="button" class="tm-btn ghost" data-tm-go="timesheets:log">Log time</button>
      </div>
    </div>`;
  }).join('');

  let cal = `<p class="tm-muted">${escapeHtml(d.errors.leave || 'Leave didn’t load')}</p>`;
  if (d.requests) {
    const c = calendar(d.requests, t, { weeks: 4 });
    cal = `<div class="tm-cal" role="table" aria-label="Who's off, next four weeks">
      <div class="tm-cal-row head" role="row"><span role="columnheader"></span>${c.days.map(x => `<span role="columnheader" class="${x === t ? 'today' : ''}${[0, 6].includes(new Date(x + 'T00:00:00Z').getUTCDay()) ? ' we' : ''}" title="${escapeHtml(weekday(x) + ' ' + short(x))}">${new Date(x + 'T00:00:00Z').getUTCDate()}</span>`).join('')}</div>
      ${c.rows.map(r => `<div class="tm-cal-row" role="row"><span role="rowheader">${r.person}</span>${r.cells.map(x => `<span role="cell" class="${[x.state, x.weekend ? 'we' : '', x.today ? 'today' : ''].filter(Boolean).join(' ')}" title="${escapeHtml(`${r.person} · ${weekday(x.date)} ${short(x.date)}${x.state ? ` · ${x.state === 'off' ? x.type : 'pending ' + x.type}` : ''}`)}"></span>`).join('')}</div>`).join('')}
    </div>
    <ul class="tm-legend"><li><b class="off"></b>Off (approved)</li><li><b class="pending"></b>Requested</li><li><b class="today"></b>Today</li></ul>`;
  }

  mount.innerHTML = `<div class="app-pane">
    <div class="tm-cards">${cards}</div>
    <div class="tm-panel"><div class="tm-panel-head"><strong>Next four weeks</strong><button type="button" class="tm-link" data-tm-go="leave">Leave calendar →</button></div>${cal}</div>
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
    b.disabled = true; b.textContent = 'Refreshing…';
    await load();
    b.disabled = false; b.textContent = 'Refresh';
    if (!TM.error) toast('Team refreshed', 'success', 2500);
  });
  load();
}
