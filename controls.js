import { h } from '../core/dom.js';

/** Segmented control. choices: [[value,label],…]. */
export function segmented(choices, value, onChange, label = '') {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const paint = (v) => [...el.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  for (const [v, text] of choices) {
    el.append(h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(v === value), onclick: () => { paint(v); onChange(v); } }, text));
  }
  return el;
}

export function toggle(checked, onChange, label) {
  const el = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label });
  el.addEventListener('click', () => { const v = el.getAttribute('aria-checked') !== 'true'; el.setAttribute('aria-checked', String(v)); onChange(v); });
  return el;
}

export function field(label, control, hint) {
  return h('div', { class: 'field' }, h('label', { class: 'field__label' }, label), control, hint ? h('p', { class: 'field__hint muted' }, hint) : null);
}
