// DABSy — the character. Layered raster parts (body / eyes / bow) driven by a small state machine.
// All motion is transform/opacity only. Positioning is a single translate+scale on the root, so flights are
// GPU-composited and never trigger layout.
import { h } from '../core/dom.js';
import { clamp } from '../core/util.js';

const BASE_W = 240;           // css px at scale 1

/** Persistent states the app sets, and transient states that temporarily override them. */
export const STATES = ['idle', 'listening', 'thinking', 'answering'];
export const TRANSIENT = ['happy', 'confused', 'flying', 'returning'];

export class Dabsy {
  constructor(layer, { assetBase = './assets/char/', isReduced = () => false } = {}) {
    this.layer = layer;
    this.isReduced = isReduced;
    this.base = 'idle';
    this.over = null;
    this.overTimer = null;
    this.target = null;
    this.anims = [];
    this.pulseAt = 0;
    this.blinkTimer = null;
    this.landed = Promise.resolve();

    const img = (cls, name) => h('img', { class: cls, src: assetBase + name, alt: '', draggable: 'false', decoding: 'async' });
    this.bodyImg = img('dabsy__body', 'body.webp');
    this.squash = h('div', { class: 'dabsy__squash' },
      this.bodyImg,
      h('div', { class: 'dabsy__eyes' }, img('dabsy__eye dabsy__eye--l', 'eye-l.webp'), img('dabsy__eye dabsy__eye--r', 'eye-r.webp')),
      img('dabsy__bow', 'bow.webp'),
      h('i', { class: 'dabsy__spark dabsy__spark--1' }), h('i', { class: 'dabsy__spark dabsy__spark--2' }), h('i', { class: 'dabsy__spark dabsy__spark--3' }),
      h('b', { class: 'dabsy__mark', 'aria-hidden': 'true' }, '?'),
    );
    this.float = h('div', { class: 'dabsy__float' }, this.squash);
    this.tilt = h('div', { class: 'dabsy__tilt' }, this.float);
    this.shadow = h('div', { class: 'dabsy__shadow' });
    this.el = h('div', { class: 'dabsy', 'data-state': 'idle', 'data-ready': '0', role: 'img', 'aria-label': 'DABSy, your companion', style: { width: BASE_W + 'px' } }, this.shadow, this.tilt);
    layer.append(this.el);

    this.pose0 = { x: 0, y: 0, s: 1 };
    this.scheduleBlink();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(this.blinkTimer);
      else this.scheduleBlink();
    });
  }

  /** Resolves once the body art is decoded so DABSy never pops in half-drawn. */
  async ready() {
    try { await this.bodyImg.decode(); } catch { /* decode can reject for cached/aborted loads — still show */ }
    this.el.dataset.ready = '1';
  }

  get state() { return this.el.dataset.state; }

  // ---------- state ----------
  set(state) {
    if (!STATES.includes(state)) return;
    this.base = state;
    if (!this.over) this.apply();
  }

  /** Temporary expression. Reverts to the base state after `ms` (unless ms === 0: held until clearOver). */
  react(kind, ms = 1400) {
    if (!TRANSIENT.includes(kind)) return;
    clearTimeout(this.overTimer);
    this.over = kind;
    this.apply();
    if (ms > 0) this.overTimer = setTimeout(() => this.clearOver(kind), ms);
  }

  clearOver(kind) {
    if (kind && this.over !== kind) return;
    clearTimeout(this.overTimer);
    this.over = null;
    this.apply();
  }

  apply() {
    const next = this.over || this.base;
    if (this.el.dataset.state !== next) this.el.dataset.state = next;
  }

  /** A soft nod, used while streamed text arrives. Throttled so it never becomes noise. */
  pulse() {
    const now = performance.now();
    if (now - this.pulseAt < 700 || this.isReduced() || (this.over && this.over !== 'happy')) return;
    this.pulseAt = now;
    this.squash.classList.remove('is-pulse');
    void this.squash.offsetWidth; // restart animation
    this.squash.classList.add('is-pulse');
  }

  scheduleBlink() {
    clearTimeout(this.blinkTimer);
    this.blinkTimer = setTimeout(() => {
      if (!document.hidden && !this.over) {
        this.el.dataset.blink = '1';
        setTimeout(() => { this.el.dataset.blink = '0'; }, 130);
      }
      this.scheduleBlink();
    }, 2600 + Math.random() * 3400);
  }

  // ---------- positioning ----------
  static rectOf(el) {
    const r = el.getBoundingClientRect();
    const host = el.closest('.app')?.getBoundingClientRect() || { left: 0, top: 0 };
    return { x: r.left - host.left, y: r.top - host.top, w: r.width };
  }

  currentPose() {
    const m = new DOMMatrix(getComputedStyle(this.el).transform);
    return { x: m.m41, y: m.m42, s: m.a || 1 };
  }

  placeAt({ x, y, s }) {
    this.pose0 = { x, y, s };
    this.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
  }

  /** Jump (no animation) to an anchor — used at boot and on layout changes. */
  snap(anchor = this.target) {
    if (!anchor) return;
    this.target = anchor;
    if (this.anims.length) return; // a flight owns the transform right now; it re-snaps on landing
    const r = Dabsy.rectOf(anchor);
    if (!r.w) return;
    this.placeAt({ x: r.x, y: r.y, s: r.w / BASE_W });
  }

  cancelFlight() {
    for (const a of this.anims) a.cancel();
    this.anims = [];
  }

  /**
   * Fly to an anchor element. kind: 'flying' (outbound) | 'returning' (heading home).
   * Falls back to a short fade-move when reduced motion is on.
   */
  flyTo(anchor, kind = 'flying') {
    this.target = anchor;
    const r = Dabsy.rectOf(anchor);
    if (!r.w) { this.snap(anchor); return Promise.resolve(); }
    const to = { x: r.x, y: r.y, s: r.w / BASE_W };
    const from = this.anims.length ? this.currentPose() : this.pose0;
    this.cancelFlight();
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);

    if (this.isReduced() || dist < 3) {
      this.placeAt(to);
      if (!this.isReduced()) return Promise.resolve();
      const a = this.el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
      this.anims = [a];
      return a.finished.catch(() => {}).then(() => { this.anims = []; });
    }

    this.react(kind, 0);
    const T = (p) => `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0) scale(${p.s.toFixed(4)})`;
    const arc = clamp(dist * 0.2, 24, 96);
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - arc * 0.55 + Math.abs(dy) * 0.5 - arc * 0.2, s: ((from.s + to.s) / 2) * 1.04 };
    const dur = Math.round(clamp(560 + dist * 0.5, 640, 980));
    const dir = Math.sign(dx) || (kind === 'returning' ? -1 : 1);

    const main = this.el.animate(
      [{ transform: T(from), offset: 0, easing: 'cubic-bezier(.33,.0,.25,1)' }, { transform: T(mid), offset: 0.5, easing: 'cubic-bezier(.3,0,.2,1)' }, { transform: T(to), offset: 1 }],
      { duration: dur, fill: 'both' },
    );
    const lean = this.tilt.animate(
      [{ transform: 'rotate(0deg)' }, { transform: `rotate(${dir * 9}deg)`, offset: 0.35 }, { transform: `rotate(${-dir * 3}deg)`, offset: 0.8 }, { transform: 'rotate(0deg)' }],
      { duration: dur, easing: 'ease-in-out' },
    );
    const stretch = this.squash.animate(
      [{ transform: 'scale(1.06,.92)' }, { transform: 'scale(.95,1.08)', offset: 0.18 }, { transform: 'scale(.97,1.05)', offset: 0.85 }, { transform: 'scale(1.07,.93)' }],
      { duration: dur, easing: 'ease-in-out' },
    );
    this.anims = [main, lean, stretch];

    this.landed = main.finished.then(() => {
      this.placeAt(to);                       // commit final pose to style first…
      this.cancelFlight();                    // …then drop the animations: no flicker
      this.squash.animate(
        [{ transform: 'scale(1.08,.9)' }, { transform: 'scale(.98,1.03)', offset: 0.55 }, { transform: 'scale(1,1)' }],
        { duration: 320, easing: 'ease-out', transformOrigin: '50% 100%' },
      );
      this.clearOver(kind);
      const live = Dabsy.rectOf(anchor);      // layout may have moved during the flight (e.g. keyboard)
      if (live.w && (Math.abs(live.x - to.x) > 1 || Math.abs(live.y - to.y) > 1)) this.snap(anchor);
    }).catch(() => { /* cancelled by a newer flight */ });
    return this.landed;
  }
}
