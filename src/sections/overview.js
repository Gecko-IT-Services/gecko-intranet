/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   OVERVIEW — database reads                                       ║
   ║                                                                   ║
   ║   The Overview page itself lives in index.html (ovw*, classic     ║
   ║   script); this module gives it what is kept in the database:     ║
   ║   jobs, opportunities, leave and Xero (the same invoices Jobs     ║
   ║   reads). Logic: core/overview.js. Design: docs/superpowers/      ║
   ║   specs/2026-10-08-overview-design.md. Read only.                 ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { connectSupabase } from '../core/supabase.js';
import { fetchXero } from './jobs.js';

const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const settle = p => p.then(v => ({ v }), e => ({ e }));

/**
 * { jobs, opps, leave, xero, inv, rep, errors } — a source that fails is null with its message in
 * `errors` (jobs / opps / leave / xero), so one bad read never blanks the page. Not being
 * connected to the database at all throws (code DB_SIGNIN_REQUIRED), as every section does.
 */
export async function loadDb() {
  const sb = await connectSupabase();
  const since = new Date(Date.now() - 60 * 86400e3).toISOString();
  const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const month = todayKey.slice(0, 7);   // local month; toISOString() is still last month until 01:00 BST on the 1st
  const [jobs, opps, leave, xero, nudges, ticks, followUps, prospects] = await Promise.all([
    settle(sb.from('jobs').select('id,client_name,title,status,value,target_date,invoice_ref,invoiced_at,created_at,modified_at').then(must)),
    settle(sb.from('opportunities').select('id,client_name,title,status,mrr,one_off,closed_at,created_at,modified_at,follow_up_on,next_step,job_id,billing_set_up_at').then(must)),
    settle(sb.from('leave_requests').select('person,start_date,end_date,status,leave_type,notes').then(must)),
    settle(sb.from('xero_status').select('*').eq('id', 1).maybeSingle().then(must)),
    settle(sb.from('payment_nudges').select('contact_name,created_at').gte('created_at', since).then(must)),
    settle(sb.from('month_end_checks').select('item,done_by,done_at').eq('month', month).then(must)),
    // Follow-ups due by today and not done (client page › Activity).
    settle(sb.from('client_activity').select('id,client_name,kind,body,contact_name,follow_up_on,follow_up_done_at,created_by').lte('follow_up_on', todayKey).is('follow_up_done_at', null).then(must)),
    // Prospects to chase (Opportunities › Prospects).
    settle(sb.from('prospects').select('id,company,stage,next_step,follow_up_on').in('stage', ['new', 'contacted', 'meeting', 'proposal']).lte('follow_up_on', todayKey).then(must))
  ]);
  const errors = {};
  for (const [k, r] of Object.entries({ jobs, opps, leave, xero, nudges, ticks, followUps, prospects })) if (r.e) errors[k] = r.e.message || String(r.e);
  const out = {
    jobs: jobs.v || null,
    opps: opps.v || null,
    leave: leave.v ? leave.v.map(l => ({ person: l.person || 'Jack', start: l.start_date, end: l.end_date || l.start_date, status: status(l.status), type: l.leave_type || 'Annual Leave', note: l.notes || '' })) : null,
    xero: xero.v || null,
    nudges: nudges.v || null, ticks: ticks.v || null, followUps: followUps.v || null, prospects: prospects.v || null,
    inv: null, rep: null, errors
  };
  if (out.xero?.connected) {
    try { Object.assign(out, await fetchXero(sb, out.jobs || [])); }
    catch (e) { errors.xero = e.message || String(e); }
  }
  return out;
}

/** Same reading of a leave status as the Leave section (levNormaliseStatus). */
function status(s) {
  s = String(s || 'Pending');
  if (/approved/i.test(s)) return 'Approved';
  if (/rejected/i.test(s)) return 'Rejected';
  if (/cancelled|canceled/i.test(s)) return 'Cancelled';
  return 'Pending';
}

/** Tick or untick a hand-done month-end check (month_end_checks). Returns the row, or null when unticked. */
export async function tick(month, item, on, by) {
  const sb = await connectSupabase({ interactive: true });
  if (!on) { must(await sb.from('month_end_checks').delete().eq('month', month).eq('item', item)); return null; }
  return must(await sb.from('month_end_checks').upsert({ month, item, done_by: by || '', done_at: new Date().toISOString() }, { onConflict: 'month,item' }).select('item,done_by,done_at').single());
}
