// Study progress: real numbers only — focus minutes and quiz answers actually logged on this device.
import { study as store } from '../core/state.js';
import { isoDate, addDays } from '../core/time.js';

const DAY_KEEP = 120;

function bump(iso, fn) {
  const days = { ...store.get().days };
  days[iso] = fn({ focusMin: 0, answered: 0, correct: 0, ...(days[iso] || {}) });
  const keys = Object.keys(days).sort();
  while (keys.length > DAY_KEEP) delete days[keys.shift()];
  store.set({ days });
}

export function logFocus(minutes, now = new Date()) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return;
  bump(isoDate(now), (d) => ({ ...d, focusMin: d.focusMin + m }));
}

export function logAnswers(answered, correct, now = new Date()) {
  if (answered < 1) return;
  bump(isoDate(now), (d) => ({ ...d, answered: d.answered + answered, correct: d.correct + Math.min(correct, answered) }));
}

export function today(now = new Date()) {
  return { focusMin: 0, answered: 0, correct: 0, ...(store.get().days[isoDate(now)] || {}) };
}

/** Consecutive active days ending today (or yesterday, so the streak isn't lost before you study today). */
export function streak(now = new Date()) {
  const days = store.get().days;
  const active = (iso) => (days[iso]?.focusMin || 0) > 0 || (days[iso]?.answered || 0) > 0;
  let cursor = isoDate(now);
  if (!active(cursor)) cursor = addDays(cursor, -1);
  let n = 0;
  while (active(cursor)) { n++; cursor = addDays(cursor, -1); }
  return n;
}

export function week(now = new Date()) {
  const days = store.get().days;
  const end = isoDate(now);
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(end, i - 6);
    return { iso, focusMin: days[iso]?.focusMin || 0, answered: days[iso]?.answered || 0, correct: days[iso]?.correct || 0 };
  });
}

export function accuracy(now = new Date()) {
  const w = week(now);
  const answered = w.reduce((a, d) => a + d.answered, 0);
  const correct = w.reduce((a, d) => a + d.correct, 0);
  return { answered, correct, pct: answered ? Math.round((correct / answered) * 100) : null };
}

export function hasAnyData() {
  return Object.values(store.get().days).some((d) => d.focusMin > 0 || d.answered > 0);
}

export function snapshotForPrompt(now = new Date()) {
  const t = today(now), a = accuracy(now), s = streak(now);
  if (!hasAnyData()) return 'No study activity logged yet.';
  return `Today: ${t.focusMin} min focused, ${t.answered} practice answers. Last 7 days accuracy: ${a.pct == null ? 'n/a' : a.pct + '%'} over ${a.answered} answers. Streak: ${s} day(s).`;
}
