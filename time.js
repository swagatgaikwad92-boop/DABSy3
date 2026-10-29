// Local-time date helpers. Dates are 'YYYY-MM-DD' strings in the device's time zone; times are 'HH:MM'.
const pad = (n) => String(n).padStart(2, '0');

export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  // reject overflow dates like 2026-02-31
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function isValidTime(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || ''); }

/** Accepts 'today' | 'tomorrow' | 'YYYY-MM-DD' | null. Returns ISO date, null (explicit none) or undefined (invalid). */
export function resolveDate(v, now = new Date()) {
  if (v === null || v === '' || v === 'none') return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (t === 'today') return isoDate(now);
  if (t === 'tomorrow') return addDays(isoDate(now), 1);
  return parseISO(t) ? t : undefined;
}

export function dayDiff(iso, now = new Date()) {
  const a = parseISO(iso), b = parseISO(isoDate(now));
  if (!a || !b) return NaN;
  return Math.round((a - b) / 86400000);
}

export function relativeDay(iso, now = new Date()) {
  const n = dayDiff(iso, now);
  if (Number.isNaN(n)) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const d = parseISO(iso);
  const opts = n > 1 && n < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'short' };
  return d.toLocaleDateString(undefined, opts);
}

export function fmtTime(date, hour12) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...(hour12 == null ? {} : { hour12 }) });
}

export function fmtClock(hhmm, hour12) {
  if (!isValidTime(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return fmtTime(new Date(2000, 0, 1, h, m), hour12);
}

export function fmtLongDate(date = new Date()) {
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function dayPart(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

export function isDaytime(date = new Date()) {
  const h = date.getHours();
  return h >= 6 && h < 18;
}

export function msToMinute(date = new Date()) {
  return 60000 - (date.getSeconds() * 1000 + date.getMilliseconds()) + 20;
}

export function ago(ts, now = Date.now()) {
  const m = Math.round((now - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
