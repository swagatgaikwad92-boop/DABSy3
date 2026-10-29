// The butler's toolbox: schemas the model sees, validation, confirmation policy and executors.
// Executors call the real task/event/focus modules and return what actually happened; the model is only ever
// told about success if the underlying operation succeeded.
import * as T from './tasks.js';
import * as E from './events.js';
import * as F from '../study/focus.js';
import { normalizeQuiz } from '../study/quiz.js';
import { resolveDate, isValidTime, relativeDay, fmtClock } from '../core/time.js';

const PRIORITY = { type: 'string', enum: ['high', 'normal', 'low'] };
const DATE = { type: ['string', 'null'], description: "'today', 'tomorrow', or YYYY-MM-DD. null clears the date." };
const TIME = { type: ['string', 'null'], description: 'HH:MM, 24-hour.' };
const ID = { type: 'string', description: 'Task id from the task snapshot (e.g. t_ab12cd34ef56).' };

export const TOOLS = [
  {
    name: 'list_tasks',
    description: 'List the user\'s real tasks. Use when asked to review tasks, or when the snapshot is not enough.',
    input_schema: { type: 'object', properties: { scope: { type: 'string', enum: ['today', 'overdue', 'upcoming', 'undated', 'open', 'done', 'all'] } }, required: [] },
  },
  {
    name: 'create_task',
    description: 'Create ONE task the user explicitly asked for. Never use this to plan a day — use plan_day for that.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, priority: PRIORITY, due: DATE, time: TIME, notes: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'plan_day',
    description: 'Propose a realistic plan for a day (or part of one) as an ordered list. The user reviews it and confirms before anything is saved. Use ONLY when asked to plan, organise or schedule a day/time block. Items with existing_id schedule an existing task instead of duplicating it.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: "'today', 'tomorrow', or YYYY-MM-DD. Default today." },
        summary: { type: 'string', description: 'One short sentence describing the shape of the day.' },
        items: {
          type: 'array', minItems: 1, maxItems: 12,
          items: { type: 'object', properties: { title: { type: 'string' }, priority: PRIORITY, time: TIME, existing_id: ID }, required: ['title'] },
        },
      },
      required: ['items'],
    },
  },
  { name: 'complete_task', description: 'Mark a task done (or not done with done=false).', input_schema: { type: 'object', properties: { id: ID, done: { type: 'boolean' } }, required: ['id'] } },
  { name: 'rename_task', description: 'Change a task\'s title.', input_schema: { type: 'object', properties: { id: ID, title: { type: 'string' } }, required: ['id', 'title'] } },
  { name: 'set_priority', description: 'Change a task\'s priority.', input_schema: { type: 'object', properties: { id: ID, priority: PRIORITY }, required: ['id', 'priority'] } },
  { name: 'move_task', description: 'Change a task\'s due date and/or time.', input_schema: { type: 'object', properties: { id: ID, due: DATE, time: TIME }, required: ['id'] } },
  { name: 'delete_task', description: 'Delete a task. The app asks the user to confirm first.', input_schema: { type: 'object', properties: { id: ID }, required: ['id'] } },
  {
    name: 'add_event',
    description: 'Add a calendar event (an appointment at a date/time). For to-dos use create_task instead.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string' }, time: TIME, duration_min: { type: 'integer', minimum: 1, maximum: 1440 } }, required: ['title', 'date'] },
  },
  {
    name: 'start_focus',
    description: 'Start a focus timer for studying/working. Only when the user asks to start a session.',
    input_schema: { type: 'object', properties: { minutes: { type: 'integer', minimum: 1, maximum: 180 }, label: { type: 'string' } }, required: ['minutes'] },
  },
  {
    name: 'present_quiz',
    description: 'Show the student an interactive multiple-choice practice quiz (3–5 questions typically). The app checks answers and records results. After calling it, add at most one short sentence.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        questions: {
          type: 'array', minItems: 1, maxItems: 8,
          items: {
            type: 'object',
            properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 }, correct_index: { type: 'integer', minimum: 0 }, explanation: { type: 'string' } },
            required: ['question', 'options', 'correct_index'],
          },
        },
      },
      required: ['questions'],
    },
  },
];

const taskLine = (t, now) => {
  const when = T.describe(t, now);
  return `${t.title}${when ? ' · ' + when : ''}`;
};
const pubTask = (t) => ({ id: t.id, title: t.title, priority: t.priority, due: t.due, time: t.time, done: t.done });

const err = (name, message) => ({ ok: false, result: { ok: false, error: message }, card: { tone: 'error', icon: 'x', title: message, tool: name } });

/**
 * Pre-flight validation and confirmation policy. Returns:
 *   { error }            → fail now, no UI, model hears the error
 *   { confirm: {...} }   → ask the user before executing
 *   null                 → execute directly
 */
export function precheck(name, input = {}, now = new Date()) {
  switch (name) {
    case 'delete_task': {
      const t = T.find(input.id);
      if (!t) return { error: `No task with id "${input.id}".` };
      return { confirm: { kind: 'delete', title: 'Delete this task?', detail: taskLine(t, now), confirmLabel: 'Delete', danger: true } };
    }
    case 'plan_day': {
      const day = resolveDate(input.date ?? 'today', now);
      if (!day) return { error: 'Plan date must be today, tomorrow, or YYYY-MM-DD.' };
      const items = Array.isArray(input.items) ? input.items.slice(0, 12) : [];
      if (!items.length) return { error: 'A plan needs at least one item.' };
      const rows = [];
      for (const it of items) {
        const title = T.cleanTitle(it?.title);
        if (!title) return { error: 'Every plan item needs a title.' };
        if (it.time != null && !isValidTime(it.time)) return { error: `Invalid time "${it.time}" — use HH:MM.` };
        if (it.priority != null && !T.PRIORITIES.includes(it.priority)) return { error: `Invalid priority "${it.priority}".` };
        let existing = null;
        if (it.existing_id) {
          existing = T.find(it.existing_id);
          if (!existing) return { error: `Plan item "${title}" refers to unknown task id "${it.existing_id}".` };
        }
        rows.push({ title: existing ? existing.title : title, time: it.time || null, priority: it.priority || existing?.priority || 'normal', existing: !!existing });
      }
      const newCount = rows.filter((r) => !r.existing).length;
      return {
        confirm: {
          kind: 'plan', title: `Plan for ${relativeDay(day, now).toLowerCase()}`, detail: String(input.summary || '').slice(0, 200), rows, day,
          confirmLabel: newCount ? `Add ${newCount} task${newCount === 1 ? '' : 's'}${rows.length > newCount ? ' & schedule' : ''}` : 'Schedule',
        },
      };
    }
    case 'complete_task': case 'rename_task': case 'set_priority': case 'move_task':
      return T.find(input.id) ? null : { error: `No task with id "${input.id}".` };
    default: return null;
  }
}

export function execute(name, input = {}, now = new Date()) {
  switch (name) {
    case 'list_tasks': {
      const scope = ['today', 'overdue', 'upcoming', 'undated', 'open', 'done', 'all'].includes(input.scope) ? input.scope : 'today';
      const items = T.list(scope, now);
      return { ok: true, result: { ok: true, scope, count: items.length, tasks: items.slice(0, 50).map(pubTask) }, card: null };
    }
    case 'create_task': {
      const r = T.create(input, { now, source: 'dabsy' });
      if (!r.ok) return err(name, r.error);
      return {
        ok: true, result: { ok: true, existed: !!r.existed, task: pubTask(r.task) },
        card: { tone: 'ok', icon: 'check', title: r.existed ? 'Already on your list' : 'Task added', detail: taskLine(r.task, now), tool: name },
      };
    }
    case 'plan_day': {
      const r = T.applyPlan({ date: input.date, items: input.items }, now);
      if (!r.ok) return err(name, r.error);
      const done = r.created.length + r.scheduled.length;
      return {
        ok: done > 0,
        result: { ok: done > 0, day: r.day, created: r.created.map(pubTask), scheduled: r.scheduled.map(pubTask), skipped: r.skipped },
        card: { tone: done ? 'ok' : 'error', icon: done ? 'calendar' : 'x', title: done ? `Plan saved · ${r.created.length} added${r.scheduled.length ? `, ${r.scheduled.length} scheduled` : ''}` : 'Nothing was saved', detail: r.skipped.length ? `${r.skipped.length} skipped` : '', tool: name },
      };
    }
    case 'complete_task': {
      const done = input.done !== false;
      const r = T.complete(input.id, done);
      if (!r.ok) return err(name, r.error);
      return { ok: true, result: { ok: true, task: pubTask(r.task) }, card: { tone: 'ok', icon: 'check', title: done ? 'Marked done' : 'Reopened', detail: r.task.title, tool: name } };
    }
    case 'rename_task': {
      const r = T.rename(input.id, input.title);
      if (!r.ok) return err(name, r.error);
      return { ok: true, result: { ok: true, task: pubTask(r.task) }, card: { tone: 'ok', icon: 'edit', title: 'Renamed', detail: `${r.before.title} → ${r.task.title}`, tool: name } };
    }
    case 'set_priority': {
      const r = T.setPriority(input.id, input.priority);
      if (!r.ok) return err(name, r.error);
      return { ok: true, result: { ok: true, task: pubTask(r.task) }, card: { tone: 'ok', icon: 'flag', title: `Priority: ${r.task.priority}`, detail: r.task.title, tool: name } };
    }
    case 'move_task': {
      const move = {};
      if ('due' in input) move.due = input.due;
      if ('time' in input) move.time = input.time;
      if (!('due' in move) && !('time' in move)) return err(name, 'Give a due date and/or time.');
      const r = T.move(input.id, move, now);
      if (!r.ok) return err(name, r.error);
      return { ok: true, result: { ok: true, task: pubTask(r.task) }, card: { tone: 'ok', icon: 'calendar', title: 'Moved', detail: taskLine(r.task, now), tool: name } };
    }
    case 'delete_task': {
      const r = T.remove(input.id);
      if (!r.ok) return err(name, r.error);
      return { ok: true, result: { ok: true, deleted: pubTask(r.task) }, card: { tone: 'ok', icon: 'trash', title: 'Deleted', detail: r.task.title, tool: name } };
    }
    case 'add_event': {
      const r = E.create({ title: input.title, date: input.date, time: input.time ?? null, durationMin: input.duration_min ?? null }, now);
      if (!r.ok) return err(name, r.error);
      const when = `${relativeDay(r.event.date, now)}${r.event.time ? ' · ' + fmtClock(r.event.time) : ''}`;
      return { ok: true, result: { ok: true, existed: !!r.existed, event: { id: r.event.id, title: r.event.title, date: r.event.date, time: r.event.time } }, card: { tone: 'ok', icon: 'calendar', title: r.existed ? 'Already on your calendar' : 'Event added', detail: `${r.event.title} · ${when}`, tool: name } };
    }
    case 'start_focus': {
      const r = F.start(input.minutes, input.label);
      if (!r.ok) return err(name, r.error);
      return { ok: true, result: { ok: true, minutes: r.session.minutes }, card: { tone: 'ok', icon: 'target', title: `Focus started · ${r.session.minutes} min`, detail: r.session.label || '', tool: name } };
    }
    case 'present_quiz': {
      const r = normalizeQuiz(input);
      if (!r.ok) return err(name, r.error);
      return {
        ok: true, result: { ok: true, shown: r.quiz.questions.length, note: 'The quiz is on screen. The app checks answers itself — do not reveal answers; wait for the student.' },
        card: null, quiz: r.quiz,
      };
    }
    default:
      return err(name, `Unknown tool "${name}".`);
  }
}
