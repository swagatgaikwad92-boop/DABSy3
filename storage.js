// Persistence: versioned, observable slices backed by localStorage with an in-memory fallback.
// Every storage access is guarded — private windows and blocked storage must never break the app.
const PREFIX = 'dabsy3:';
const mem = new Map();
const slices = new Set();

function backing() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function readRaw(key) {
  try {
    const v = backing()?.getItem(PREFIX + key);
    return v ?? mem.get(key) ?? null;
  } catch { return mem.get(key) ?? null; }
}

export function writeRaw(key, str) {
  mem.set(key, str);
  try { backing()?.setItem(PREFIX + key, str); } catch { /* quota/blocked: memory copy still holds */ }
}

export function removeRaw(key) {
  mem.delete(key);
  try { backing()?.removeItem(PREFIX + key); } catch { /* ignore */ }
}

/**
 * createSlice('tasks', { items: [] }, { version: 1, migrate(old, fromVersion) })
 * State is treated as immutable: set() replaces it (shallow-merging a patch object, or taking a reducer).
 */
export function createSlice(key, defaults, { version = 1, migrate } = {}) {
  let state;
  const subs = new Set();
  let timer = null;
  let dirty = false;

  const fresh = () => structuredClone(defaults);

  function load() {
    const raw = readRaw(key);
    if (raw == null) return fresh();
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return fresh();
      let data = parsed.data;
      if (parsed.v !== version) data = migrate ? migrate(data, parsed.v) : fresh();
      return { ...fresh(), ...data };
    } catch { return fresh(); }
  }

  function save() {
    clearTimeout(timer);
    timer = null;
    dirty = false;
    writeRaw(key, JSON.stringify({ v: version, data: state }));
  }

  state = load();

  const slice = {
    key,
    get: () => state,
    set(patchOrFn) {
      const next = typeof patchOrFn === 'function' ? patchOrFn(state) : { ...state, ...patchOrFn };
      if (next === state) return state;
      state = next;
      dirty = true;
      if (timer == null) timer = setTimeout(save, 120);
      for (const fn of [...subs]) {
        try { fn(state); } catch (e) { console.error('[store] subscriber failed', e); }
      }
      return state;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    reset() { state = fresh(); save(); for (const fn of [...subs]) fn(state); },
    flush() { if (dirty) save(); },
    reload() { state = load(); for (const fn of [...subs]) fn(state); },
  };
  slices.add(slice);
  return slice;
}

export function flushAll() { for (const s of slices) s.flush(); }

if (typeof addEventListener === 'function') {
  addEventListener('pagehide', flushAll);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
}

export function eraseEverything() {
  for (const s of slices) s.reset();
}
