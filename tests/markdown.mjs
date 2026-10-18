import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markdownHtml, codeBoxes } from '../src/core/markdown.js';

const html = markdownHtml('# Title\n\nSome **bold** and `code`,\nsame paragraph.\n\n- one\n- [two](https://x.test/?a=1&b=2)\n\n```cmd\nnet localgroup administrators /add "AzureAD\\{email}"\n```\n\n<script>alert(1)</script>');
assert.match(html, /^<h1>Title<\/h1>/);
assert.match(html, /<p>Some <strong>bold<\/strong> and <code>code<\/code>, same paragraph\.<\/p>/);
assert.match(html, /<ul><li>one<\/li><li><a href="https:\/\/x\.test\/\?a=1&amp;b=2" target="_blank" rel="noopener">two<\/a><\/li><\/ul>/);
// A code box keeps its text escaped, turns {email} into a blank, and carries a copy button.
assert.match(html, /<pre><code>net localgroup administrators \/add &quot;AzureAD\\<input class="md-blank" data-blank="email" placeholder="email"[^>]*>&quot;<\/code><\/pre>/);
assert.match(html, /class="btn btn-ghost btn-sm md-copy"/);
// Nothing in the file becomes markup by itself.
assert.ok(!html.includes('<script>'));
assert.equal(markdownHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
// Braces that are code, not blanks, are left alone; an unclosed box still shows.
assert.match(markdownHtml('```\nGet-Service | ? { $_.Status -eq 1 }\n'), /\{ \$_\.Status -eq 1 \}\n?<\/code>/);

// The real page parses into boxes, and every box has its copy button.
const page = markdownHtml(readFileSync('docs/commands.md', 'utf8'));
assert.equal((page.match(/<pre>/g) || []).length, (readFileSync('docs/commands.md', 'utf8').match(/^```\w/gm) || []).length);
assert.match(page, /data-blank="email"/);

// Quick find's list of boxes: the command, the paragraph just above it, its heading, and its place on the page.
assert.deepEqual(codeBoxes('## Network\n\nIntro.\n\nShows **the** `IP`.\n\n```cmd\nipconfig\n```\n\n## Users\n\n```cmd\nnet localgroup administrators /add "AzureAD\\{email}"\n```\n\n```\nnot closed'), [
  { code: 'ipconfig', about: 'Shows the IP.', heading: 'Network', n: 0 },
  { code: 'net localgroup administrators /add "AzureAD\\{email}"', about: '', heading: 'Users', n: 1 }
]);
// Every box on the real page has a description, and the numbering matches the boxes markdownHtml draws.
const boxes = codeBoxes(readFileSync('docs/commands.md', 'utf8'));
assert.equal(boxes.length, (page.match(/<pre>/g) || []).length);
for (const b of boxes) assert.ok(b.about && b.heading, `"${b.code}" has a description and a heading`);

console.log('markdown: ok');
