import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, inlineTokens, safeUrl } from '../../src/chat/markdown.js';

test('parses headings, paragraphs, lists, code, tables, quotes', () => {
  const b = parseBlocks('## Title\n\nHello **world**\nsecond line\n\n- a\n- b\n  - nested\n\n1. one\n2. two\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|:-:|\n| 1 | 2 |\n\n> quote');
  assert.deepEqual(b.map((x) => x.type), ['h', 'p', 'ul', 'ol', 'code', 'table', 'quote']);
  assert.equal(b[0].level, 2);
  assert.equal(b[2].items.length, 2);
  assert.equal(b[2].items[1].blocks[0].type, 'ul');
  assert.equal(b[4].lang, 'js');
  assert.equal(b[4].closed, true);
  assert.deepEqual(b[5].head, ['A', 'B']);
  assert.equal(b[5].aligns[1], 'center');
  assert.equal(b[5].rows[0][1], '2');
});

test('unterminated code fence (mid-stream) is rendered as open code, not swallowed text', () => {
  const b = parseBlocks('Intro\n\n```python\nprint(1)');
  assert.equal(b[1].type, 'code');
  assert.equal(b[1].closed, false);
  assert.equal(b[1].text, 'print(1)');
});

test('ordered list keeps its start number and does not merge with bullet list', () => {
  const b = parseBlocks('3. three\n4. four\n\n- bullet');
  assert.equal(b[0].type, 'ol');
  assert.equal(b[0].start, 3);
  assert.equal(b[1].type, 'ul');
});

test('inline: bold, italic, code, links, escapes, snake_case untouched', () => {
  const t = inlineTokens('a **b** *c* `d` [e](https://x.com) snake_case_word \\*lit\\*');
  const types = t.map((x) => x.t);
  assert.ok(types.includes('strong') && types.includes('em') && types.includes('code') && types.includes('link'));
  assert.ok(!types.includes('em') || t.filter((x) => x.t === 'em').length === 1);
  const text = t.filter((x) => x.t === 'text').map((x) => x.v).join('');
  assert.ok(text.includes('snake_case_word'));
  assert.ok(text.includes('*lit*'));
});

test('links: only http(s) and mailto survive; javascript: is neutralised', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,hi'), null);
  assert.equal(safeUrl('https://ok.com/a?b=1'), 'https://ok.com/a?b=1');
  const t = inlineTokens('[click](javascript:alert(1))');
  assert.ok(!t.some((x) => x.t === 'link'));
});

test('bare URLs auto-link without swallowing trailing punctuation', () => {
  const t = inlineTokens('see https://example.com/a.');
  const link = t.find((x) => x.t === 'link');
  assert.equal(link.href, 'https://example.com/a');
});

test('HTML is never interpreted (tokens carry raw text only)', () => {
  const t = inlineTokens('<img src=x onerror=alert(1)> <script>x</script>');
  assert.ok(t.every((x) => x.t === 'text' || x.t === 'br'));
});
