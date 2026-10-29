// Wallpaper scenes with day/night variants and a slow crossfade. Only the active image is ever decoded.
import { h } from '../core/dom.js';
import { isDaytime } from '../core/time.js';

export const SCENES = ['bedroom', 'garden', 'cabin', 'study'];
export const SCENE_LABELS = { bedroom: 'Bedroom', garden: 'Garden', cabin: 'Cabin', study: 'Study' };

/** Pure: which wallpaper key to show. */
export function pickScene({ pref = 'auto', study = false, now = new Date() } = {}) {
  const tod = isDaytime(now) ? 'day' : 'night';
  const name = study ? 'study' : SCENES.includes(pref) ? pref : hourScene(now.getHours());
  return `${name}-${tod}`;
}

// 'auto' rotates calm defaults through the day: bedroom (morning), garden (afternoon), cabin (evening), bedroom (night).
function hourScene(hr) {
  if (hr >= 6 && hr < 12) return 'bedroom';
  if (hr >= 12 && hr < 18) return 'garden';
  if (hr >= 18 && hr < 22) return 'cabin';
  return 'bedroom';
}

export class Scene {
  constructor(root, { base = './assets/scenes/' } = {}) {
    this.base = base;
    this.layers = [h('div', { class: 'scene__layer' }), h('div', { class: 'scene__layer' })];
    root.append(...this.layers);
    this.active = -1;
    this.key = null;
    this.cache = new Map();
  }

  async show(key) {
    if (key === this.key) return;
    this.key = key;
    const url = `${this.base}${key}.webp`;
    try { await this.preload(url); } catch { /* missing art: keep the current scene */ return; }
    if (key !== this.key) return; // superseded while loading
    const next = (this.active + 1) % 2;
    const layer = this.layers[next];
    layer.style.backgroundImage = `url("${url}")`;
    layer.classList.add('is-on');
    if (this.active >= 0) this.layers[this.active].classList.remove('is-on');
    this.active = next;
  }

  preload(url) {
    if (this.cache.has(url)) return this.cache.get(url);
    const p = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(url);
      img.onerror = () => { this.cache.delete(url); rej(new Error('scene failed: ' + url)); };
      img.decoding = 'async';
      img.src = url;
    });
    this.cache.set(url, p);
    return p;
  }
}
