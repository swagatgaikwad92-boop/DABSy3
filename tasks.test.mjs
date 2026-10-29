import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tasks } from '../../src/core/state.js';
import * as T from '../../src/butler/tasks.js';
import { precheck, execute, TOOLS } from '../../src/butler/tools.js';
import { normalizeQuiz } from '../../src/study/quiz.js';

const NOW = new Date(2026, 9, 29, 10, 0); // Thu 29 Oct 2026
beforeEach(() => tasks.reset());

test('create: validates, defaults, resolves relative dates, dedupes', () => {
  assert.equal(T.create({ title: '  ' }).ok, false);
  assert.equal(T.create({ title: 'x', priority: 'urgent' }).ok, false);
  assert.equal(T.create({ title: 'x', due: 'someday' }, { now: NOW }).ok, false);
  assert.equal(T.create({ title: 'x', time: '25:00' }, { now: NOW }).ok, false);
  const a = T.create({ title: 'Buy milk', due: 'tomorrow' }, { now: NOW });
  assert.equal(a.task.due, '2026-10-30');
  assert.equal(a.task.priority, 'normal');
  const dup = T.create({ title: 'buy MILK', due: 'tomorrow' }, { now: NOW });
  assert.equal(dup.existed, true);
  assert.equal(T.all().length, 1);
  const timed = T.create({ title: 'Call', time: '14:30' }, { now: NOW });
  assert.equal(timed.task.due, '2026-10-29'); // a time implies today
});

test('complete / rename / priority / move / delete / restore act on real data', () => {
  const t = T.create({ title: 'A' }, { now: NOW }).task;
  assert.equal(T.complete(t.id).task.done, true);
  assert.equal(T.complete(t.id, false).task.done, false);
  assert.equal(T.rename(t.id, 'B').task.title, 'B');
  assert.equal(T.setPriority(t.id, 'high').task.priority, 'high');
  assert.equal(T.setPriority(t.id, 'nope').ok, false);
  assert.equal(T.move(t.id, { due: '2026-11-01', time: '09:00' }, NOW).task.due, '2026-11-01');
  assert.equal(T.move(t.id, { due: null }, NOW).task.time, null); // clearing the date clears the time
  assert.equal(T.rename('missing', 'x').ok, false);
  const r = T.remove(t.id);
  assert.equal(T.all().length, 0);
  assert.equal(T.restore(r.task).ok, true);
  assert.equal(T.all().length, 1);
  assert.equal(T.restore(r.task).ok, false);
});

test('list scopes and summary', () => {
  T.create({ title: 'late', due: '2026-10-28' }, { now: NOW });
  T.create({ title: 'now', due: 'today' }, { now: NOW });
  T.create({ title: 'soon', due: 'tomorrow' }, { now: NOW });
  T.create({ title: 'someday' }, { now: NOW });
  assert.deepEqual(T.list('today', NOW).map((t) => t.title), ['now']);
  assert.deepEqual(T.list('overdue', NOW).map((t) => t.title), ['late']);
  assert.deepEqual(T.list('upcoming', NOW).map((t) => t.title), ['soon']);
  assert.deepEqual(T.list('undated', NOW).map((t) => t.title), ['someday']);
  const s = T.summary(NOW);
  assert.equal(s.open, 4); assert.equal(s.overdue, 1); assert.equal(s.today, 1);
});

test('plan_day: confirmation required, then schedules existing tasks and creates only new ones', () => {
  const existing = T.create({ title: 'Report' }, { now: NOW }).task;
  const input = { date: 'today', items: [{ title: 'Deep work', time: '09:00', priority: 'high' }, { title: 'x', existing_id: existing.id, time: '11:00' }] };
  const pre = precheck('plan_day', input, NOW);
  assert.equal(pre.confirm.kind, 'plan');
  assert.equal(pre.confirm.rows.length, 2);
  assert.equal(T.all().length, 1, 'nothing is saved before the user confirms');
  const r = execute('plan_day', input, NOW);
  assert.equal(r.ok, true);
  assert.equal(T.all().length, 2);
  assert.equal(T.find(existing.id).time, '11:00');
  assert.equal(r.result.created.length, 1);
  assert.equal(r.result.scheduled.length, 1);
});

test('plan_day rejects unknown existing ids and bad times before asking the user', () => {
  assert.ok(precheck('plan_day', { items: [{ title: 'a', existing_id: 'nope' }] }, NOW).error);
  assert.ok(precheck('plan_day', { items: [{ title: 'a', time: '99:99' }] }, NOW).error);
  assert.ok(precheck('plan_day', { items: [] }, NOW).error);
});

test('delete_task needs confirmation; unknown ids fail fast; success only reported when really deleted', () => {
  const t = T.create({ title: 'Del' }, { now: NOW }).task;
  assert.equal(precheck('delete_task', { id: t.id }).confirm.danger, true);
  assert.ok(precheck('delete_task', { id: 'ghost' }).error);
  assert.equal(execute('delete_task', { id: 'ghost' }).ok, false);
  assert.equal(T.all().length, 1);
  assert.equal(execute('delete_task', { id: t.id }).ok, true);
  assert.equal(T.all().length, 0);
});

test('create_task via tool reports failure honestly', () => {
  const bad = execute('create_task', { title: '' }, NOW);
  assert.equal(bad.ok, false);
  assert.equal(bad.result.ok, false);
  assert.equal(bad.card.tone, 'error');
  assert.equal(T.all().length, 0);
});

test('every tool schema is well formed', () => {
  for (const t of TOOLS) {
    assert.ok(t.name && t.description && t.input_schema?.type === 'object', t.name);
  }
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
});

test('quiz normalisation rejects malformed quizzes', () => {
  assert.equal(normalizeQuiz({ questions: [] }).ok, false);
  assert.equal(normalizeQuiz({ questions: [{ question: 'q', options: ['a'], correct_index: 0 }] }).ok, false);
  assert.equal(normalizeQuiz({ questions: [{ question: 'q', options: ['a', 'b'], correct_index: 5 }] }).ok, false);
  assert.equal(normalizeQuiz({ questions: [{ question: 'q', options: ['a', 'a'], correct_index: 0 }] }).ok, false);
  assert.equal(normalizeQuiz({ questions: [{ question: 'q', options: ['a', 'b'], correct_index: 1, explanation: 'e' }] }).ok, true);
});
