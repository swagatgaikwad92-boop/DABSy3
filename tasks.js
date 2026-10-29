// Task domain logic. The single source of truth for tasks: UI, widgets and the AI butler all go through here,
// so every operation validates input, mutates the real store, and reports exactly what happened.
import { tasks as store } from '../core/state.js';
import { uid, plural } from '../core/util.js';
import { isoDate, resolveDate, isValidTime, dayDiff, addDays } from '../core/time.js';

export const PRIORITIES = ['high', 'normal', 'low'];
const RANK = { high: 0, normal: 1, low: 2 };
export const MAX_TITLE = 140;
export const MAX_TASKS = 500;

const fail = (error) => ({ ok: false, error });
const ok = (extra) => ({ ok: true, ...extra });

export const cleanTitle = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
const sameTitle = (a, b) => cleanTitle(a).toLowerCase() === cleanTitle(b).toLowerCase();

export const all = () => store.get().items;
export const find = (id) => all().find((t) => t.id === id) || null;
const write = (items) => store.set({ items });

/** Sort: due date (undated last) → time → priority → creation. */
export function compareTasks(a, b) {
  const ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.time || '99:99', bt = b.time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.priority !== b.priority) return RANK[a.priority] - RANK[b.priority];
  return a.createdAt - b.createdAt;
}

export function create(input, { now = new Date(), source = 'user' } = {}) {
  const title = cleanTitle(input?.title);
  if (!title) return fail('A task needs a title.');
  const priority = input.priority ?? 'normal';
  if (!PRIORITIES.includes(priority)) return fail(`Priority must be one of ${PRIORITIES.join(', ')}.`);
  let due = input.due === undefined ? null : resolveDate(input.due, now);
  if (due === undefined) return fail('Due date must be today, tomorrow, or YYYY-MM-DD.');
  const time = input.time ?? null;
  if (time != null && !isValidTime(time)) return fail('Time must be HH:MM (24h).');
  if (time && !due) due = isoDate(now);
  if (all().length >= MAX_TASKS) return fail(`Task limit (${MAX_TASKS}) reached — clear some completed tasks first.`);

  const dup = all().find((t) => !t.done && sameTitle(t.title, title) && t.due === due);
  if (dup) return ok({ existed: true, task: dup });

  const task = { id: uid('t_'), title, priority, due, time, notes: String(input.notes || '').slice(0, 500), done: false, doneAt: null, createdAt: Date.now(), source };
  write([...all(), task]);
  return ok({ task });
}

function patch(id, fn) {
  const t = find(id);
  if (!t) return fail(`No task with id "${id}".`);
  const next = fn(t);
  if (next?.ok === false) return next;
  const updated = { ...t, ...next };
  write(all().map((x) => (x.id === id ? updated : x)));
  return ok({ task: updated, before: t });
}

export const complete = (id, done = true) => patch(id, (t) => ({ done: !!done, doneAt: done ? Date.now() : null }));

export function rename(id, title) {
  const clean = cleanTitle(title);
  if (!clean) return fail('A task needs a title.');
  return patch(id, () => ({ title: clean }));
}

export function setPriority(id, priority) {
  if (!PRIORITIES.includes(priority)) return fail(`Priority must be one of ${PRIORITIES.join(', ')}.`);
  return patch(id, () => ({ priority }));
}

/** due: 'today' | 'tomorrow' | 'YYYY-MM-DD' | null (clear). time: 'HH:MM' | null. */
export function move(id, { due, time } = {}, now = new Date()) {
  const d = due === undefined ? undefined : resolveDate(due, now);
  if (d === undefined && due !== undefined) return fail('Due date must be today, tomorrow, or YYYY-MM-DD (or null to clear).');
  if (time != null && !isValidTime(time)) return fail('Time must be HH:MM (24h).');
  return patch(id, (t) => {
    const nextDue = due === undefined ? t.due : d;
    const nextTime = time === undefined ? (nextDue ? t.time : null) : time;
    return { due: nextDue, time: nextDue || nextTime ? nextTime : null };
  });
}

export function remove(id) {
  const t = find(id);
  if (!t) return fail(`No task with id "${id}".`);
  write(all().filter((x) => x.id !== id));
  return ok({ task: t });
}

/** Undo support for deletes. */
export function restore(task) {
  if (!task || find(task.id)) return fail('Nothing to restore.');
  write([...all(), task]);
  return ok({ task });
}

export function clearCompleted() {
  const n = all().filter((t) => t.done).length;
  write(all().filter((t) => !t.done));
  return ok({ removed: n });
}

// ---------- queries ----------
export function list(scope = 'today', now = new Date()) {
  const today = isoDate(now);
  const items = all();
  const open = items.filter((t) => !t.done);
  let out;
  switch (scope) {
    case 'overdue': out = open.filter((t) => t.due && t.due < today); break;
    case 'today': out = open.filter((t) => t.due === today); break;
    case 'upcoming': out = open.filter((t) => t.due && t.due > today); break;
    case 'undated': out = open.filter((t) => !t.due); break;
    case 'done': out = items.filter((t) => t.done); break;
    case 'open': out = open; break;
    default: out = items;
  }
  return [...out].sort(compareTasks);
}

export function summary(now = new Date()) {
  const today = isoDate(now);
  const items = all();
  const open = items.filter((t) => !t.done);
  return {
    open: open.length,
    overdue: open.filter((t) => t.due && t.due < today).length,
    today: open.filter((t) => t.due === today).length,
    doneToday: items.filter((t) => t.done && t.doneAt && isoDate(new Date(t.doneAt)) === today).length,
    todayTotal: items.filter((t) => t.due === today).length,
  };
}

export function describe(t, now = new Date()) {
  const bits = [];
  if (t.due) {
    const n = dayDiff(t.due, now);
    bits.push(n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : t.due);
  }
  if (t.time) bits.push(t.time);
  return bits.join(' ');
}

/** Compact snapshot for the model's system prompt. Ids let it target tasks precisely. */
export function snapshotForPrompt(now = new Date(), limit = 40) {
  const open = list('open', now).slice(0, limit);
  const s = summary(now);
  if (!open.length) return 'No open tasks.';
  const lines = open.map((t) => `- id=${t.id} | ${t.priority} | ${JSON.stringify(t.title)}${t.due ? ` | due ${t.due}${t.time ? ' ' + t.time : ''}` : ' | no date'}`);
  const more = s.open > open.length ? `\n(+${s.open - open.length} more not shown)` : '';
  return `${plural(s.open, 'open task')} (${s.overdue} overdue, ${s.today} due today):\n${lines.join('\n')}${more}`;
}

/**
 * Apply a day plan. Items with existing_id are scheduled (due/time set); others are created.
 * Returns per-item outcomes so the caller can report exactly what happened.
 */
export function applyPlan({ date, items }, now = new Date()) {
  const day = resolveDate(date ?? 'today', now);
  if (!day) return fail('Plan date must be today, tomorrow, or YYYY-MM-DD.');
  if (!Array.isArray(items) || !items.length) return fail('A plan needs at least one item.');
  const created = [], scheduled = [], skipped = [];
  for (const it of items.slice(0, 20)) {
    const time = it.time && isValidTime(it.time) ? it.time : null;
    if (it.existing_id) {
      const r = move(it.existing_id, { due: day, time }, now);
      if (r.ok) scheduled.push(r.task); else skipped.push({ title: it.title || it.existing_id, reason: r.error });
    } else {
      const r = create({ title: it.title, priority: it.priority || 'normal', due: day, time }, { now, source: 'dabsy' });
      if (!r.ok) skipped.push({ title: it.title, reason: r.error });
      else if (r.existed) skipped.push({ title: it.title, reason: 'already on your list' });
      else created.push(r.task);
    }
  }
  return ok({ day, created, scheduled, skipped });
}

export { addDays };
