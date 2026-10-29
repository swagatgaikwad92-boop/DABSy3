// Small shared helpers (ids, clamping, event emitter).
export function uid(prefix = '') {
  const c = globalThis.crypto;
  if (c?.randomUUID) return prefix + c.randomUUID().replace(/-/g, '').slice(0, 12);
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function createEmitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type)?.delete(fn);
    },
    emit(type, payload) {
      for (const fn of [...(map.get(type) || [])]) {
        try { fn(payload); } catch (e) { console.error(`[emit:${type}]`, e); }
      }
    },
  };
}

/** App-wide event bus for cross-module intents (open chat, toast, etc). */
export const bus = createEmitter();

export function truncate(str, n) {
  const t = String(str ?? '');
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }
