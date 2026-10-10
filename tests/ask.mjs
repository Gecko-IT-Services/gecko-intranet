import assert from 'node:assert/strict';
import { answerHtml, historyFor } from '../src/core/ask.js';

const link = n => `<a data-c="${n}">${n}</a>`;
assert.equal(answerHtml('[[Cowan Consultancy]] has **2.5h** left.', link), '<p><a data-c="Cowan Consultancy">Cowan Consultancy</a> has <strong>2.5h</strong> left.</p>');
assert.equal(answerHtml('Two:\n- [[A Ltd]]: 1h\n- [[B & Co]]: 0.5h', link),
  '<p>Two:</p><ul><li><a data-c="A Ltd">A Ltd</a>: 1h</li><li><a data-c="B & Co">B & Co</a>: 0.5h</li></ul>', 'link gets the raw name; the shell escapes it');
assert.equal(answerHtml('1. first\n2) second\n\nafter', link), '<ol><li>first</li><li>second</li></ol><p>after</p>');
assert.equal(answerHtml('<img src=x onerror=alert(1)> **<b>**'), '<p>&lt;img src=x onerror=alert(1)&gt; <strong>&lt;b&gt;</strong></p>', 'escaped before marks');
assert.equal(answerHtml('## Heading'), '<p>Heading</p>');
assert.equal(answerHtml(''), '');

assert.deepEqual(historyFor([
  { question: 'q1', answer: 'a1' },
  { question: 'q2', error: 'failed' },
  { question: 'q3', answer: 'a3' }
]), [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q3' }, { role: 'assistant', content: 'a3' }], 'failed turns left out');
assert.equal(historyFor(Array.from({ length: 5 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }))).length, 6, 'last six messages');
assert.equal(historyFor(Array.from({ length: 5 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` })))[0].role, 'user', 'starts with a question');

console.log('ask: all tests passed');
