/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   MONDAY BRIEF (Overview › Today)                                 ║
   ║                                                                   ║
   ║   The week from Gecko HQ in your Outlook Drafts: made the first   ║
   ║   time Overview opens on a Monday (once per person per week,      ║
   ║   weekly_briefs), or with the button any day. Never sent. Figures ║
   ║   only (core/brief.js), from what Overview holds plus Do next.    ║
   ║   Design: docs/superpowers/specs/2026-10-19-monday-brief-design.md║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { graphFetch } from '../core/graph.js';
import { connectSupabase } from '../core/supabase.js';
import { toast, escapeHtml } from '../core/ui.js';
import { mondayBrief, weekKey } from '../core/brief.js';
import { current, whenReady } from './actions.js';

const BR = { week: '', madeAt: null, busy: false, error: '', checked: '', checking: null };
const when = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const draw = () => { const m = document.getElementById('ovwBrief'); if (m) m.innerHTML = inner(); };

function inner() {
  if (BR.busy) return '<span>Monday brief: making it…</span>';
  const made = BR.madeAt && BR.week ? `in your Outlook Drafts (made ${escapeHtml(when(BR.madeAt))})` : '';
  return `<span><strong>Monday brief</strong> ${made || 'the week’s figures, Do next and what needs a look, as a draft to yourself'}${BR.error ? ` · <em class="ovw-brief-err">${escapeHtml(BR.error)}</em>` : ''}</span>
    <button type="button" class="btn btn-sm${made ? ' btn-ghost' : ''}" data-brief-make>${made ? 'Make it again' : 'Make this week’s brief'}</button>`;
}

/** Has this person had this week's brief? (read once per week per page load) */
function check(email, today) {
  const week = weekKey(today);
  if (BR.checked === `${week}:${email}`) return BR.checking;
  BR.checked = `${week}:${email}`; BR.week = week;
  BR.checking = read(email, week);
  return BR.checking;
}
async function read(email, week) {
  try {
    const sb = await connectSupabase();
    const { data } = await sb.from('weekly_briefs').select('made_at').eq('week_start', week).eq('made_by', email).maybeSingle();
    BR.madeAt = data?.made_at || null;
  } catch { /* no table yet, or offline: the button still works */ }
  draw();
}

/**
 * Make the brief. input: { email, first, today, last, ahead, attention, missing, url } from Overview. auto: the Monday run, which
 * claims the week first (so two devices don't both make one) and stays quiet if it can't (the button is there).
 */
async function make(input, { auto = false } = {}) {
  if (BR.busy || !input.email) return;
  const week = weekKey(input.today);
  BR.busy = true; BR.error = ''; draw();
  let sb = null, claimed = false;
  try {
    sb = await connectSupabase({ interactive: !auto });
    if (auto) {
      const { data, error } = await sb.from('weekly_briefs').insert({ week_start: week, made_by: input.email }).select('made_at');
      if (error) { if (/duplicate|unique/i.test(error.message || '')) { BR.madeAt = BR.madeAt || new Date().toISOString(); return; } throw new Error(error.message); }
      claimed = !!data?.length;
    }
    await Promise.race([whenReady(), new Promise(r => setTimeout(r, 20000))]);
    const a = current();
    const { subject, html } = mondayBrief({ ...input, actions: (a?.list || []).filter(x => !x.key.startsWith('date:')), dates: a?.dates || [], missing: [...(input.missing || []), ...(a ? a.missing : ['Do next'])] });
    await graphFetch('/me/messages', { method: 'POST', scopes: ['Mail.ReadWrite'], interactive: !auto,
      body: JSON.stringify({ subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: input.email } }] }) });
    const at = new Date().toISOString();
    if (!claimed) await sb.from('weekly_briefs').upsert({ week_start: week, made_by: input.email, made_at: at }, { onConflict: 'week_start,made_by' });
    BR.madeAt = at; BR.week = week;
    toast('This week’s brief is in your Outlook Drafts.', 'success', 6000);
  } catch (err) {
    if (claimed) await sb.from('weekly_briefs').delete().eq('week_start', week).eq('made_by', input.email);   // so the button (or next open) can try again
    BR.error = auto ? 'not made automatically: use the button' : `couldn’t make it: ${err.message || err}`;
    if (!auto) toast(`Couldn’t make the brief: ${err.message || err}`, 'error', 9000);
  } finally {
    BR.busy = false; draw();
  }
}

/** The line on Today. input is built by Overview only when needed (getInput), as it walks several lists. */
export function lineHtml(email, today) {
  check(email, today);
  return `<div class="ovw-brief" id="ovwBrief">${inner()}</div>`;
}
/** Overview, once loaded on a Monday: make it if this person hasn't had this week's. */
export async function auto(getInput) {
  const input = getInput();
  if (!input.email) return;
  await check(input.email, input.today);
  if (!BR.madeAt) make(input, { auto: true });
}
export function init(getInput) {
  document.addEventListener('click', e => { if (e.target.closest?.('#ovwBrief [data-brief-make]')) make(getInput()); });
}
