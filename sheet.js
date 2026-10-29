// Bottom sheets (one at a time) and toasts. Sheets join browser history so Back closes them.
import { h } from '../core/dom.js';
import { icon } from './icons.js';
import { pushLayer, releaseLayer } from '../core/nav.js';

let root = null;
let toastRoot = null;
let current = null;

export function initOverlays(sheetRoot, toasts) { root = sheetRoot; toastRoot = toasts; }
export const sheetOpen = () => !!current;

export function openSheet({ title, render, onClose, label }) {
  if (current) current.close({ instant: true });
  const returnFocus = document.activeElement;
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const body = h('div', { class: 'sheet__body' });
  const titleEl = h('h2', { class: 'sheet__title' }, title);
  const grab = h('div', { class: 'sheet__grab', 'aria-hidden': 'true' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => api.close() }, icon('x', 22));
  const head = h('div', { class: 'sheet__head' }, titleEl, closeBtn);
  const sheet = h('section', { class: 'sheet glass glass--strong', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title, tabindex: '-1' }, grab, head, body);
  root.append(backdrop, sheet);

  let closed = false;
  let layer = null;
  const finish = (instant) => {
    if (closed) return;
    closed = true;
    if (current === api) current = null;
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    const remove = () => { sheet.remove(); backdrop.remove(); };
    if (instant) remove(); else setTimeout(remove, 380);
    try { returnFocus?.isConnected && returnFocus.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    onClose?.();
  };
  const api = {
    el: body, sheet, titleEl,
    close({ instant = false } = {}) {
      if (closed) return;
      if (layer) releaseLayer(layer);
      finish(instant);
    },
    rerender() { body.replaceChildren(); render(body, api); },
  };
  layer = pushLayer(() => finish(false));
  current = api;
  backdrop.addEventListener('click', () => api.close());

  // swipe down to dismiss (from the grab handle / header)
  let startY = null, dy = 0;
  const down = (e) => { if (e.target.closest('button')) return; startY = e.clientY; dy = 0; sheet.style.transition = 'none'; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (startY == null) return; dy = Math.max(0, e.clientY - startY); sheet.style.transform = `translateY(${dy}px)`; };
  const up = () => {
    if (startY == null) return;
    startY = null;
    sheet.style.transition = '';
    if (dy > 110) { sheet.style.transform = ''; api.close(); } else sheet.style.transform = '';
  };
  for (const el of [grab, head]) { el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); }

  render(body, api);
  requestAnimationFrame(() => { sheet.classList.add('is-open'); backdrop.classList.add('is-open'); sheet.focus({ preventScroll: true }); });
  return api;
}

addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) current.close(); });

/** toast('Task deleted', { action: { label: 'Undo', run } }) */
export function toast(message, { action, tone, ms = 4200 } = {}) {
  if (!toastRoot) return;
  const t = h('div', { class: `toast glass glass--strong${tone === 'bad' ? ' toast--bad' : ''}`, role: 'status' }, h('span', null, message));
  const remove = () => t.remove();
  if (action) t.append(h('button', { type: 'button', onclick: () => { action.run(); remove(); } }, action.label));
  toastRoot.append(t);
  while (toastRoot.children.length > 2) toastRoot.firstChild.remove();
  setTimeout(remove, ms);
}
