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
  const [jobs, opps, leave, xero] = await Promise.all([
    settle(sb.from('jobs').select('id,client_name,title,status,value,target_date,invoice_ref,invoiced_at').then(must)),
    settle(sb.from('opportunities').select('client_name,title,status,mrr,one_off,closed_at,created_at,modified_at').then(must)),
    settle(sb.from('leave_requests').select('person,start_date,end_date,status,leave_type').then(must)),
    settle(sb.from('xero_status').select('*').eq('id', 1).maybeSingle().then(must))
  ]);
  const errors = {};
  for (const [k, r] of Object.entries({ jobs, opps, leave, xero })) if (r.e) errors[k] = r.e.message || String(r.e);
  const out = {
    jobs: jobs.v || null,
    opps: opps.v || null,
    leave: leave.v ? leave.v.map(l => ({ person: l.person || 'Jack', start: l.start_date, end: l.end_date || l.start_date, status: status(l.status), type: l.leave_type || 'Annual Leave' })) : null,
    xero: xero.v || null,
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
