// Calendar events. Stored on this device only — there is no external calendar integration in V3.
import { events as store } from '../core/state.js';
import { uid } from '../core/util.js';
import { isoDate, resolveDate, isValidTime, parseISO } from '../core/time.js';

const fail = (error) => ({ ok: false, error });
export const all = () => store.get().items;
export const MAX_EVENTS = 300;

export function create({ title, date, time = null, durationMin = null }, now = new Date()) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!t) return fail('An event needs a title.');
  const d = resolveDate(date ?? 'today', now);
  if (!d) return fail('Event date must be today, tomorrow, or YYYY-MM-DD.');
  if (time != null && !isValidTime(time)) return fail('Time must be HH:MM (24h).');
  if (durationMin != null && !(Number.isFinite(+durationMin) && +durationMin > 0 && +durationMin <= 1440)) return fail('Duration must be 1–1440 minutes.');
  if (all().length >= MAX_EVENTS) return fail('Event limit reached.');
  const dup = all().find((e) => e.title.toLowerCase() === t.toLowerCase() && e.date === d && (e.time || null) === (time || null));
  if (dup) return { ok: true, existed: true, event: dup };
  const event = { id: uid('e_'), title: t, date: d, time, durationMin: durationMin ? Math.round(+durationMin) : null, createdAt: Date.now() };
  store.set({ items: [...all(), event] });
  return { ok: true, event };
}

export function remove(id) {
  const e = all().find((x) => x.id === id);
  if (!e) return fail(`No event with id "${id}".`);
  store.set({ items: all().filter((x) => x.id !== id) });
  return { ok: true, event: e };
}

export function restore(event) {
  if (!event || all().some((x) => x.id === event.id)) return fail('Nothing to restore.');
  store.set({ items: [...all(), event] });
  return { ok: true, event };
}

const key = (e) => `${e.date} ${e.time || '99:99'}`;

/** Events from today onward (today's already-finished timed events are dropped), soonest first. */
export function upcoming(now = new Date(), limit = Infinity) {
  const today = isoDate(now);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return all()
    .filter((e) => e.date > today || (e.date === today && (!e.time || e.time >= hhmm || endsAfter(e, hhmm))))
    .sort((a, b) => (key(a) < key(b) ? -1 : 1))
    .slice(0, limit);
}

function endsAfter(e, hhmm) {
  if (!e.time || !e.durationMin) return false;
  const [h, m] = e.time.split(':').map(Number);
  const end = h * 60 + m + e.durationMin;
  const [nh, nm] = hhmm.split(':').map(Number);
  return end > nh * 60 + nm;
}

export function onDay(iso) { return all().filter((e) => e.date === iso).sort((a, b) => (key(a) < key(b) ? -1 : 1)); }

export function snapshotForPrompt(now = new Date(), limit = 12) {
  const up = upcoming(now, limit);
  if (!up.length) return 'No upcoming calendar events.';
  return up.map((e) => `- ${e.date}${e.time ? ' ' + e.time : ''} ${JSON.stringify(e.title)}`).join('\n');
}

export const validDate = (iso) => !!parseISO(iso);
