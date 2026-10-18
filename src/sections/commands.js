/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   COMMANDS (Operations › Commands)                                  ║
   ║                                                                     ║
   ║   docs/commands.md drawn like a GitHub README: Windows commands     ║
   ║   with a copy button on each box. A {blank} in a box is typed into  ║
   ║   (the same blank is filled everywhere on the page) and copied with ║
   ║   what was typed. Edited on GitHub, not in the app.                 ║
   ║   Logic: src/core/markdown.js. Design:                              ║
   ║   docs/superpowers/specs/2026-10-18-commands-design.md              ║
   ║   NOTE: no top-level `window` access (importable under Node).       ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { escapeHtml, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { markdownHtml } from '../core/markdown.js';

const wrap = () => document.getElementById('cmdWrap');

async function load() {
  wrap().innerHTML = '<p class="state-empty art art-loading">Loading commands…</p>';
  try {
    const res = await fetch('docs/commands.md', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`docs/commands.md: ${res.status} ${res.statusText}`);
    wrap().innerHTML = `<article class="md">${markdownHtml(await res.text())}</article>`;
  } catch (err) {
    console.error('Commands not loaded:', err);
    wrap().innerHTML = `<div class="state-error art art-offline"><strong>Could not load the commands</strong>`
      + `<p>${escapeHtml(err.message || String(err))}</p><button type="button" class="btn btn-sm" data-cmd-retry>Try again</button></div>`;
  }
}

/** The box's text with each blank replaced by what was typed; null (and the blank focused) if one is empty. */
function boxText(box) {
  const empty = [...box.querySelectorAll('.md-blank')].find(b => !b.value.trim());
  if (empty) { empty.focus(); return null; }
  const code = box.querySelector('code').cloneNode(true);   // a cloned input keeps what was typed
  code.querySelectorAll('.md-blank').forEach(b => b.replaceWith(b.value.trim()));
  return code.textContent;
}

async function copy(btn) {
  const text = boxText(btn.closest('.md-code'));
  if (text == null) { toast('Fill in the blank first', 'warning'); return; }
  try {
    await navigator.clipboard.writeText(text);
    btn.innerHTML = icon('check', 14);
    btn.classList.add('is-copied');
    setTimeout(() => { btn.innerHTML = icon('copy', 14); btn.classList.remove('is-copied'); }, 1500);
  } catch (err) {
    toast('Could not copy: ' + (err.message || err), 'error');
  }
}

export function init() {
  const el = wrap();
  el.addEventListener('click', e => {
    const btn = e.target.closest('.md-copy');
    if (btn) copy(btn);
    else if (e.target.closest('[data-cmd-retry]')) load();
  });
  // One blank, one value: typing an email fills every {email} on the page.
  el.addEventListener('input', e => {
    if (!e.target.matches('.md-blank')) return;
    el.querySelectorAll(`.md-blank[data-blank="${CSS.escape(e.target.dataset.blank)}"]`).forEach(b => { if (b !== e.target) b.value = e.target.value; });
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.md-blank')) copy(e.target.closest('.md-code').querySelector('.md-copy'));
  });
  load();
}
