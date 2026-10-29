// Focus sessions. State is stored as an absolute end timestamp, so a session survives reloads and
// backgrounding; completion is evaluated from the clock, never from a counter that could drift.
import { study as store } from '../core/state.js';
import { bus } from '../core/util.js';
import { logFocus } from './progress.js';

let timer = null;

export const active = () => store.get().focus;
export const remainingMs = (now = Date.now()) => Math.max(0, (active()?.endsAt ?? 0) - now);

export function start(minutes, label = '') {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 1 || m > 180) return { ok: false, error: 'Focus sessions run 1–180 minutes.' };
  if (active()) return { ok: false, error: 'A focus session is already running.' };
  const now = Date.now();
  store.set({ focus: { startedAt: now, endsAt: now + m * 60000, minutes: m, label: String(label || '').slice(0, 80) } });
  arm();
  bus.emit('focus:start', active());
  return { ok: true, session: active() };
}

/** Ends the session early; logs the minutes actually spent (rounded down, only if ≥1). */
export function stop(now = Date.now()) {
  const f = active();
  if (!f) return { ok: false, error: 'No focus session is running.' };
  const spent = Math.min(f.minutes, Math.floor((now - f.startedAt) / 60000));
  store.set({ focus: null });
  clearTimeout(timer);
  if (spent >= 1) logFocus(spent);
  bus.emit('focus:stop', { spent, completed: false });
  return { ok: true, spent };
}

/** Complete the session if its time has passed. Returns the finished session or null. */
export function finalizeIfDue(now = Date.now()) {
  const f = active();
  if (!f || now < f.endsAt) return null;
  store.set({ focus: null });
  clearTimeout(timer);
  logFocus(f.minutes);
  bus.emit('focus:done', f);
  return f;
}

/** (Re)arm the completion timer. Call on boot and after start(). */
export function arm() {
  clearTimeout(timer);
  const f = active();
  if (!f) return;
  const wait = Math.max(0, f.endsAt - Date.now());
  // setTimeout is clamped in background tabs, so also re-check on visibility change (see main.js).
  timer = setTimeout(() => finalizeIfDue(), wait + 50);
}

export function fmtRemaining(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
