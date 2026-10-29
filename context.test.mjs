import test from 'node:test';
import assert from 'node:assert/strict';
import { trimContext, repairToolPairs, isValidStart } from '../../src/ai/context.js';
import { buildSystem } from '../../src/ai/prompts.js';

const u = (t) => ({ role: 'user', content: t });
const a = (t) => ({ role: 'assistant', content: t });

test('trim keeps recent messages and always starts on a user text turn', () => {
  const msgs = [];
  for (let i = 0; i < 20; i++) { msgs.push(u('q' + i + 'x'.repeat(500))); msgs.push(a('a' + i + 'y'.repeat(500))); }
  const { messages, dropped } = trimContext(msgs, { maxChars: 5000 });
  assert.ok(dropped > 0);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[messages.length - 1], msgs[msgs.length - 1]);
});

test('trim never starts on a tool_result (would orphan it)', () => {
  const msgs = [u('hi'), { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] }, a('done'), u('next')];
  const { messages } = trimContext(msgs, { maxChars: 60 });
  assert.ok(isValidStart(messages[0]));
});

test('repairToolPairs drops dangling tool_use but keeps its text', () => {
  const msgs = [u('hi'), { role: 'assistant', content: [{ type: 'text', text: 'working' }, { type: 'tool_use', id: 't1', name: 'x', input: {} }] }, u('again')];
  const r = repairToolPairs(msgs);
  assert.deepEqual(r[1], { role: 'assistant', content: [{ type: 'text', text: 'working' }] });
  assert.equal(r.length, 3);
});

test('repairToolPairs leaves complete pairs alone', () => {
  const msgs = [u('hi'), { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] }];
  assert.deepEqual(repairToolPairs(msgs), msgs);
});

test('system prompt: balanced by default, study mode changes teaching behaviour, snapshot included', () => {
  const base = buildSystem({ tasks: '- id=t_1 | normal | "x"' });
  assert.match(base, /RESPONSE LENGTH: balanced/);
  assert.match(base, /id=t_1/);
  assert.doesNotMatch(base, /STUDY MODE IS ON/);
  const study = buildSystem({ studyMode: true, style: 'concise' });
  assert.match(study, /STUDY MODE IS ON/);
  assert.match(study, /RESPONSE LENGTH: concise/);
  assert.match(base, /plan_day/);
  assert.match(base, /Never claim an action succeeded/);
});
