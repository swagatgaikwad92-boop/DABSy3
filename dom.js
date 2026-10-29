// Tiny DOM helpers. Text is always inserted as text nodes — never as HTML.
const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  return append(el, kids);
}

export function s(tag, props, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) for (const [k, v] of Object.entries(props)) if (v != null) el.setAttribute(k, String(v));
  return append(el, kids);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function replaceChildren(el, ...kids) { clear(el); return append(el, kids); }

/** Run fn at most once per animation frame (coalesces bursts like streamed tokens). */
export function frameThrottle(fn) {
  let queued = false;
  let lastArgs;
  const run = () => { queued = false; fn(...lastArgs); };
  const t = (...args) => {
    lastArgs = args;
    if (!queued) { queued = true; requestAnimationFrame(run); }
  };
  t.flush = (...args) => { queued = false; fn(...(args.length ? args : lastArgs || [])); };
  return t;
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
