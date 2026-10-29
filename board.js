// The widget board: renders visible widgets from the saved layout and re-renders only the widget whose data changed.
import { h } from '../core/dom.js';
import { layout } from '../core/state.js';
import { bus } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { WIDGETS } from './defs.js';
import { resolveLayout } from './registry.js';

export class WidgetBoard {
  constructor(root) {
    this.root = root;
    this.entries = new Map(); // id -> { card, unsub, raf }
    this.sig = '';
    layout.subscribe(() => this.sync());
    this.sync();
  }

  resolved() { return resolveLayout(WIDGETS, layout.get()); }

  sync() {
    const items = this.resolved();
    const sig = JSON.stringify(items.map((i) => [i.id, i.visible, i.size, i.opts]));
    if (sig === this.sig) return;
    const prev = JSON.parse(this.sig || '[]');
    this.sig = sig;
    const visible = items.filter((i) => i.visible);

    for (const [id, e] of [...this.entries]) {
      if (!visible.some((v) => v.id === id)) { e.unsub?.(); e.card.remove(); this.entries.delete(id); }
    }
    visible.forEach((item, index) => {
      let e = this.entries.get(item.id);
      const changed = !prev.length || JSON.stringify(prev.find((p) => p[0] === item.id)?.slice(1)) !== JSON.stringify([item.visible, item.size, item.opts]);
      if (!e) {
        const card = h('section', { class: 'widget glass', 'data-id': item.id, 'aria-label': item.def.title });
        e = { card, item, unsub: null, raf: 0 };
        this.entries.set(item.id, e);
        e.unsub = item.def.subscribe(() => this.schedule(item.id));
        card.addEventListener('click', (ev) => {
          if (!e.item.def.opensSheet || ev.target.closest('button, a, input')) return;
          bus.emit('ui:open', e.item.def.opensSheet);
        });
      }
      e.item = item;
      e.card.className = `widget glass w--${item.size}${item.def.opensSheet ? ' is-tappable' : ''}`;
      if (changed || !e.card.firstChild) this.paint(item.id);
      // keep DOM order equal to layout order
      if (this.root.children[index] !== e.card) this.root.insertBefore(e.card, this.root.children[index] || null);
    });
  }

  schedule(id) {
    const e = this.entries.get(id);
    if (!e || e.raf) return;
    e.raf = requestAnimationFrame(() => { e.raf = 0; this.paint(id); });
  }

  paint(id) {
    const e = this.entries.get(id);
    if (!e) return;
    try {
      e.card.replaceChildren(e.item.def.render({ size: e.item.size, opts: e.item.opts }));
    } catch (err) {
      console.error(`[widget:${id}]`, err);
      e.card.replaceChildren(h('p', { class: 'muted' }, 'This widget hit a problem.'));
    }
  }

  destroy() { for (const e of this.entries.values()) e.unsub?.(); }
}

export function widgetIcon(def) { return icon(def.icon, 18); }
