/**
 * Just enough Markdown for the Commands page (docs/commands.md), drawn the way GitHub draws a README:
 * # headings, paragraphs, - lists, ``` code boxes with a copy button, `code`, **bold**, [links](https://…).
 * In a code box, {name} becomes a blank to type into (the copy takes what is typed).
 * Everything is escaped first. No `window` (importable under Node; tests/markdown.mjs).
 * ponytail: no tables, images, nesting or numbered lists; add them when the page needs one.
 */
import { icon } from './icons.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

const codeBox = lines => {
  const code = esc(lines.join('\n')).replace(/\{([a-zA-Z][\w.-]*)\}/g, (_, name) =>
    `<input class="md-blank" data-blank="${name}" placeholder="${name}" aria-label="${name}" size="${Math.max(name.length, 8)}" spellcheck="false" autocomplete="off">`);
  return `<div class="md-code"><pre><code>${code}</code></pre>`
    + `<button type="button" class="btn btn-ghost btn-sm md-copy" title="Copy" aria-label="Copy">${icon('copy', 14)}</button></div>`;
};

export function markdownHtml(text) {
  const out = [];
  let para = [], list = [], code = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    if (list.length) out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`);
    para = []; list = [];
  };
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (code) {
      if (/^```\s*$/.test(line)) { out.push(codeBox(code)); code = null; } else code.push(line);
      continue;
    }
    let m;
    if (/^```/.test(line)) { flush(); code = []; }
    else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (para.length) flush(); list.push(m[1]); }
    else if (!line.trim()) flush();
    else { if (list.length) flush(); para.push(line.trim()); }
  }
  if (code) out.push(codeBox(code));   // an unclosed box still shows
  flush();
  return out.join('\n');
}

/**
 * Each code box with what it is for, for Quick find: { code, about, heading, n }. `about` is the paragraph just above
 * the box, `heading` the ## it sits under, `n` its place among the page's boxes (from 0, as markdownHtml draws them).
 * Blanks stay as {name}. An unclosed box at the end is left out.
 */
export function codeBoxes(text) {
  const out = [];
  let heading = '', para = [], gap = true, code = null, m;
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (code) {
      if (/^```\s*$/.test(line)) { out.push({ code: code.join('\n').trim(), about: para.join(' ').replace(/\*\*|`/g, ''), heading, n: out.length }); code = null; para = []; }
      else code.push(line);
    }
    else if (/^```/.test(line)) code = [];
    else if ((m = line.match(/^#{1,3}\s+(.*)$/))) { heading = m[1].trim(); para = []; }
    else if (!line.trim()) gap = true;
    else { if (gap) para = []; gap = false; para.push(line.trim()); }
  }
  return out;
}
