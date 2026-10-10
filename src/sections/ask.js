/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   ASK GECKO HQ                                                    ║
   ║                                                                   ║
   ║   Ask (sidebar on desktop, top bar on a phone) opens a dialog:    ║
   ║   about the business, the `ask` Edge Function looks it up with    ║
   ║   read-only tools and Claude answers in a few lines, client names ║
   ║   linked. Read only; never sends or changes anything.             ║
   ║   Logic: core/ask.js. Design: docs/superpowers/specs/             ║
   ║   2026-10-11-ask-gecko-hq-design.md                               ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { escapeHtml, clientLink } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { EXAMPLES, answerHtml, historyFor } from '../core/ask.js';

const AK = { turns: [], busy: false };
const els = id => document.getElementById(id);

function dialogHtml() {
  return `<dialog class="ask-dialog" id="askDialog" aria-labelledby="askTitle">
    <div class="ask-head">
      <h2 id="askTitle">Ask Gecko HQ</h2>
      <button type="button" class="btn btn-sm btn-ghost" data-ask-act="new">New question</button>
      <button type="button" class="btn btn-sm btn-ghost ask-close" data-ask-act="close" aria-label="Close">✕</button>
    </div>
    <div class="ask-thread" id="askThread" aria-live="polite"></div>
    <form class="ask-form" id="askForm">
      <textarea id="askInput" rows="2" maxlength="1000" placeholder="e.g. Who is close to running out of SSA hours?" aria-label="Your question"></textarea>
      <button type="submit" class="btn btn-primary" id="askSend">Ask</button>
    </form>
    <p class="ask-foot">Reads Gecko HQ’s data to answer; never changes or sends anything. Answers can be wrong, so check before acting on a figure.</p>
  </dialog>`;
}

function render() {
  const t = els('askThread');
  if (!t) return;
  if (!AK.turns.length) {
    t.innerHTML = `<div class="ask-start"><p>Ask about clients, SSA hours, time logged, jobs, the pipeline, invoices, leave or mileage.</p>
      <div class="ask-examples">${EXAMPLES.map(q => `<button type="button" class="btn btn-sm btn-ghost" data-ask-example="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div></div>`;
  } else {
    t.innerHTML = AK.turns.map(x => `<div class="ask-turn">
        <p class="ask-q">${escapeHtml(x.question)}</p>
        ${x.pending ? '<p class="ask-a ask-pending">Looking it up…</p>'
          : x.error ? `<div class="ask-a state-error"><strong>Couldn’t answer.</strong><p>${escapeHtml(x.error)}</p></div>`
          : `<div class="ask-a">${answerHtml(x.answer, clientLink)}</div>`}
      </div>`).join('');
    t.scrollTop = t.scrollHeight;
  }
  const send = els('askSend');
  if (send) { send.disabled = AK.busy; send.textContent = AK.busy ? 'Asking…' : 'Ask'; }
}

async function ask(question) {
  question = String(question || '').trim();
  if (!question || AK.busy) return;
  const history = historyFor(AK.turns);
  const turn = { question, pending: true };
  AK.turns.push(turn); AK.busy = true; render();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('ask', { body: { question, history } });
    if (error) {
      let msg = error.message || 'The request failed';
      try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    turn.answer = String(data?.answer || '').trim() || 'No answer came back.';
  } catch (err) {
    turn.error = err.message || String(err);
  } finally {
    turn.pending = false; AK.busy = false; render();
    els('askInput')?.focus();
  }
}

export function open(question = '') {
  const d = els('askDialog');
  if (!d) return;
  if (!d.open) d.showModal();
  render();
  const input = els('askInput');
  if (input) { input.value = question || input.value; input.focus(); }
}

export function init() {
  if (els('askDialog')) return;
  const host = els('app') || document.body;
  host.insertAdjacentHTML('beforeend', dialogHtml());
  els('askOpen')?.addEventListener('click', () => open());
  els('askOpenSide')?.addEventListener('click', () => { window.closeSidebar?.(); open(); });
  const d = els('askDialog');
  d.addEventListener('click', e => {
    if (e.target === d) { d.close(); return; }   // backdrop
    const ex = e.target.closest('[data-ask-example]');
    if (ex) { ask(ex.dataset.askExample); return; }
    const a = e.target.closest('[data-ask-act]')?.dataset.askAct;
    if (a === 'close') d.close();
    if (a === 'new') { AK.turns = []; render(); els('askInput')?.focus(); }
    if (e.target.closest('[data-open-client]')) d.close();   // the shell's handler opens the client page
  });
  els('askForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = els('askInput');
    const q = input.value; input.value = '';
    ask(q);
  });
  els('askInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els('askForm').requestSubmit(); }
  });
}
