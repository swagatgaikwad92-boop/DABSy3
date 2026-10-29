// Safe, incremental Markdown renderer for streamed answers.
// parseBlocks()/inlineTokens() are pure (unit-tested in Node); MarkdownView builds DOM nodes — text is never
// interpreted as HTML — and re-renders only the blocks that changed while tokens stream in.
import { h } from '../core/dom.js';

// ---------- pure parsing ----------
const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const splitRow = (line) => {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};

export function parseBlocks(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const startsBlock = (l, next) =>
    FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST_ITEM.test(l) || (l.includes('|') && next !== undefined && TABLE_SEP.test(next));

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m = FENCE.exec(line);
    if (m) {
      const marker = m[2];
      const body = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) { closed = true; i++; break; }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', lang: m[3] || '', text: body.join('\n'), closed });
      continue;
    }
    if ((m = HEADING.exec(line))) { blocks.push({ type: 'h', level: m[1].length, text: m[2] }); i++; continue; }
    if (HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ type: 'table', head, aligns, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) { body.push(QUOTE.exec(lines[i])[1]); i++; }
      blocks.push({ type: 'quote', blocks: parseBlocks(body.join('\n')) });
      continue;
    }

    if ((m = LIST_ITEM.exec(line)) && m[1].length < 4) {
      const ordered = /\d/.test(m[2]);
      const start = ordered ? parseInt(m[2], 10) : 1;
      const items = [];
      while (i < lines.length) {
        const lm = LIST_ITEM.exec(lines[i]);
        if (lm && lm[1].length < 2) {
          if (/\d/.test(lm[2]) !== ordered) break;
          items.push({ text: lm[3], rest: [] });
          i++;
        } else if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i])) {
          items[items.length - 1].rest.push(lines[i].replace(/^\s{2,4}/, ''));
          i++;
        } else if (items.length && !lines[i].trim() && i + 1 < lines.length && (/^\s{2,}\S/.test(lines[i + 1]) || (LIST_ITEM.test(lines[i + 1]) && LIST_ITEM.exec(lines[i + 1])[1].length < 2 && /\d/.test(LIST_ITEM.exec(lines[i + 1])[2]) === ordered))) {
          i++; // blank line inside the list
        } else if (items.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1]) && !items[items.length - 1].rest.length) {
          items[items.length - 1].text += '\n' + lines[i].trim(); // lazy continuation
          i++;
        } else break;
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', start, items: items.map((it) => ({ text: it.text, blocks: it.rest.length ? parseBlocks(it.rest.join('\n')) : [] })) });
      continue;
    }

    // paragraph: consume until blank line or the start of another block
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) { para.push(lines[i]); i++; }
    blocks.push({ type: 'p', text: para.join('\n') });
  }
  return blocks;
}

const ESC_CHARS = '\\`*_{}[]()#+-.!~|>';

/** Only absolute http(s) and mailto links are ever rendered as links. */
export function safeUrl(u) {
  const s = String(u).trim();
  if (!/^(https?:\/\/|mailto:)/i.test(s)) return null;
  try { new URL(s); return s; } catch { return null; }
}

/** Inline Markdown → token tree. */
export function inlineTokens(src) {
  const out = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && ESC_CHARS.includes(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (c === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }
    if (c === '`') {
      const j = src.indexOf('`', i + 1);
      if (j > i + 1) { flush(); out.push({ t: 'code', v: src.slice(i + 1, j) }); i = j + 1; continue; }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(src.slice(i));
      if (m) {
        flush();
        const href = safeUrl(m[2]);
        if (href) out.push({ t: 'link', href, c: inlineTokens(m[1]) }); else out.push(...inlineTokens(m[1]));
        i += m[0].length;
        continue;
      }
    }
    if (c === 'h' && (src.startsWith('http://', i) || src.startsWith('https://', i)) && (i === 0 || /[\s(]/.test(src[i - 1]))) {
      const m = /^https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"]/.exec(src.slice(i));
      if (m) { flush(); out.push({ t: 'link', href: m[0], c: [{ t: 'text', v: m[0] }] }); i += m[0].length; continue; }
    }
    if (src.startsWith('**', i) || src.startsWith('__', i)) {
      const d = src.slice(i, i + 2);
      const j = src.indexOf(d, i + 2);
      if (j > i + 2 && !/^\s/.test(src[i + 2]) && !(d === '__' && /\w/.test(src[i - 1] || ''))) { flush(); out.push({ t: 'strong', c: inlineTokens(src.slice(i + 2, j)) }); i = j + 2; continue; }
    }
    if (src.startsWith('~~', i)) {
      const j = src.indexOf('~~', i + 2);
      if (j > i + 2) { flush(); out.push({ t: 'del', c: inlineTokens(src.slice(i + 2, j)) }); i = j + 2; continue; }
    }
    if ((c === '*' || c === '_') && src[i + 1] && !/\s/.test(src[i + 1]) && src[i + 1] !== c) {
      const prev = src[i - 1] || ' ';
      const okOpen = c === '*' ? true : !/\w/.test(prev);
      if (okOpen) {
        let j = i + 1;
        for (; j < src.length; j++) {
          if (src[j] === c && !/\s/.test(src[j - 1]) && (c === '*' || !/\w/.test(src[j + 1] || ' ')) && src[j + 1] !== c) break;
        }
        if (j < src.length) { flush(); out.push({ t: 'em', c: inlineTokens(src.slice(i + 1, j)) }); i = j + 1; continue; }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// ---------- DOM building ----------
function tokensToNodes(tokens) {
  return tokens.map((t) => {
    switch (t.t) {
      case 'text': return document.createTextNode(t.v);
      case 'br': return h('br');
      case 'code': return h('code', { class: 'md-code' }, t.v);
      case 'strong': return h('strong', null, ...tokensToNodes(t.c));
      case 'em': return h('em', null, ...tokensToNodes(t.c));
      case 'del': return h('del', null, ...tokensToNodes(t.c));
      case 'link': return h('a', { href: t.href, target: '_blank', rel: 'noopener noreferrer nofollow' }, ...tokensToNodes(t.c));
      default: return document.createTextNode('');
    }
  });
}

const inlineNodes = (s) => tokensToNodes(inlineTokens(s));

function copyText(text, btn) {
  const done = () => { const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = old; }, 1400); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => {});
  else {
    const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { /* ignore */ }
    ta.remove();
  }
}

function renderBlock(b) {
  switch (b.type) {
    case 'p': return h('p', null, ...inlineNodes(b.text));
    case 'h': return h('h' + Math.min(b.level + 1, 5), { class: 'md-h' }, ...inlineNodes(b.text));
    case 'hr': return h('hr');
    case 'quote': return h('blockquote', null, ...b.blocks.map(renderBlock));
    case 'ul': case 'ol': {
      const el = h(b.type, b.type === 'ol' && b.start !== 1 ? { start: b.start } : null);
      for (const it of b.items) el.append(h('li', null, ...inlineNodes(it.text), ...it.blocks.map(renderBlock)));
      return el;
    }
    case 'code': {
      const copy = b.closed ? h('button', { class: 'md-copy', type: 'button', 'aria-label': 'Copy code', onclick: (e) => copyText(b.text, e.currentTarget) }, 'Copy') : null;
      return h('div', { class: 'md-pre' },
        h('div', { class: 'md-pre__bar' }, h('span', null, b.lang || 'code'), copy),
        h('pre', null, h('code', null, b.text)));
    }
    case 'table': {
      const cell = (tag, txt, a) => h(tag, { style: { textAlign: a } }, ...inlineNodes(txt));
      return h('div', { class: 'md-table' }, h('table', null,
        h('thead', null, h('tr', null, ...b.head.map((c, k) => cell('th', c, b.aligns[k])))),
        h('tbody', null, ...b.rows.map((r) => h('tr', null, ...b.head.map((_, k) => cell('td', r[k] ?? '', b.aligns[k])))))));
    }
    default: return h('span');
  }
}

/** Renders `update(text)` into `root`, touching only blocks whose source changed. */
export class MarkdownView {
  constructor(root) {
    this.root = root;
    this.keys = [];
  }

  update(text) {
    const blocks = parseBlocks(text);
    const keys = blocks.map((b) => JSON.stringify(b));
    let i = 0;
    while (i < keys.length && i < this.keys.length && keys[i] === this.keys[i]) i++;
    while (this.root.childNodes.length > i) this.root.lastChild.remove();
    for (let k = i; k < blocks.length; k++) this.root.append(renderBlock(blocks[k]));
    this.keys = keys;
  }
}

export function renderMarkdownInto(root, text) {
  const v = new MarkdownView(root);
  v.update(text);
  return v;
}
