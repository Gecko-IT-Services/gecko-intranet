/* Ask Gecko HQ: pure helpers (no window). Tested in tests/ask.mjs.
   Design: docs/superpowers/specs/2026-10-11-ask-gecko-hq-design.md

   The answer comes back as plain text with client names in [[double brackets]] and the odd **bold**, list or
   line break. It is escaped first, then those few marks become HTML, so nothing in an answer can inject markup. */

export const EXAMPLES = [
  'Who is close to running out of SSA hours?',
  'What did we do for Cowan Consultancy last month?',
  'How much have we invoiced so far this month?',
  'Which follow-ups are overdue?',
  'Which jobs are waiting to be invoiced?'
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Answer text → HTML. link(name) returns the HTML for a client link (the shell's clientLink, which escapes);
 * it is given the unescaped name.
 */
export function answerHtml(text, link = n => esc(n)) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const inline = s => {
    const parts = s.split(/\[\[([^\]\n]{1,120})\]\]/);
    return parts.map((p, i) => (i % 2 ? link(p.trim()) : esc(p).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>'))).join('');
  };
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`<${list.tag}>${list.items.map(x => `<li>${x}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/), num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { close(); list = { tag, items: [] }; }
      list.items.push(inline((bullet || num)[1]));
      continue;
    }
    close();
    if (!line.trim()) continue;
    out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
  }
  close();
  return out.join('');
}

/** The conversation as the function wants it: text turns only, the last six. */
export function historyFor(turns) {
  return (turns || []).filter(t => t.answer && !t.error)
    .flatMap(t => [{ role: 'user', content: t.question }, { role: 'assistant', content: t.answer }]).slice(-6);
}
