import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDate, parseISO, addDays, dayDiff, relativeDay } from '../../src/core/time.js';
import { resolveLayout, moveWidget } from '../../src/widgets/registry.js';
import { pickScene } from '../../src/scenes/scene.js';
import { createNormalizer } from '../../worker/providers/anthropic.js';
import { validate, allowedOrigin, handle } from '../../worker/index.js';
import { parseForecast, forecastUrl } from '../../src/widgets/weather-service.js';
import * as events from '../../src/butler/events.js';
import { events as eventsStore, study } from '../../src/core/state.js';
import * as P from '../../src/study/progress.js';

const NOW = new Date(2026, 9, 29, 10, 0);

test('dates: relative resolution, validation, overflow rejection', () => {
  assert.equal(resolveDate('today', NOW), '2026-10-29');
  assert.equal(resolveDate('Tomorrow', NOW), '2026-10-30');
  assert.equal(resolveDate(null, NOW), null);
  assert.equal(resolveDate('2026-02-31', NOW), undefined);
  assert.equal(parseISO('2026-13-01'), null);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(dayDiff('2026-10-31', NOW), 2);
  assert.equal(relativeDay('2026-10-30', NOW), 'Tomorrow');
});

const defs = [{ id: 'a', sizes: ['s', 'm'], defaultSize: 's', options: [{ key: 'k', default: 1 }] }, { id: 'b', sizes: ['m'], defaultSize: 'm' }, { id: 'c', sizes: ['m'], defaultSize: 'm' }];
test('layout: defaults, order, hidden, size validation, unknown ids, new widgets appended', () => {
  const r = resolveLayout(defs, { order: ['b', 'ghost', 'a'], hidden: ['a', 'ghost'], sizes: { a: 'huge', b: 'm' }, opts: { a: { k: 5 } } });
  assert.deepEqual(r.map((x) => x.id), ['b', 'a', 'c']);
  assert.equal(r.find((x) => x.id === 'a').visible, false);
  assert.equal(r.find((x) => x.id === 'a').size, 's');
  assert.equal(r.find((x) => x.id === 'a').opts.k, 5);
  assert.deepEqual(moveWidget(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveWidget(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
});

test('scene selection: time of day, study override, explicit scene', () => {
  assert.equal(pickScene({ pref: 'auto', now: new Date(2026, 9, 29, 8) }), 'bedroom-day');
  assert.equal(pickScene({ pref: 'auto', now: new Date(2026, 9, 29, 14) }), 'garden-day');
  assert.equal(pickScene({ pref: 'auto', now: new Date(2026, 9, 29, 20) }), 'cabin-night');
  assert.equal(pickScene({ pref: 'cabin', now: new Date(2026, 9, 29, 8) }), 'cabin-day');
  assert.equal(pickScene({ pref: 'garden', study: true, now: new Date(2026, 9, 29, 23) }), 'study-night');
});

test('Anthropic adapter normalises text, tool_use (with streamed JSON) and stop reason', () => {
  const n = createNormalizer();
  const out = [];
  const feed = (t, d) => out.push(...n(t, d));
  feed('message_start', {});
  feed('content_block_start', { index: 0, content_block: { type: 'text' } });
  feed('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hi' } });
  feed('content_block_stop', { index: 0 });
  feed('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'create_task' } });
  feed('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"title":' } });
  feed('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '"Milk"}' } });
  feed('content_block_stop', { index: 1 });
  feed('message_delta', { delta: { stop_reason: 'tool_use' } });
  feed('message_stop', {});
  assert.deepEqual(out, [
    { type: 'text', data: { t: 'Hi' } },
    { type: 'tool', data: { id: 'tu1', name: 'create_task', input: { title: 'Milk' } } },
    { type: 'done', data: { stop: 'tool_use' } },
  ]);
});

test('worker: validation, origin allowlist, and the key is never echoed', async () => {
  const env = { ANTHROPIC_API_KEY: 'sk-secret', ALLOWED_ORIGINS: 'https://me.github.io' };
  assert.equal(validate({ system: 's', messages: [{ role: 'assistant', content: 'x' }] }, env).ok, false);
  assert.equal(validate({ system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 999999 }, { ...env, MAX_TOKENS: '1000' }).value.maxTokens, 1000);
  const req = (origin) => new Request('https://w/chat', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(allowedOrigin(req('https://me.github.io'), env), 'https://me.github.io');
  assert.equal(allowedOrigin(req('https://evil.com'), env), null);
  const denied = await handle(req('https://evil.com'), env);
  assert.equal(denied.status, 403);
  const noKey = await handle(req('https://me.github.io'), { ALLOWED_ORIGINS: 'https://me.github.io' });
  assert.equal(noKey.status, 500);
  const health = await handle(new Request('https://w/health', { headers: { origin: 'https://me.github.io' } }), env);
  const body = await health.text();
  assert.ok(!body.includes('sk-secret'));
});

test('worker streams normalised events from a (faked) upstream and forwards the key only upstream', async () => {
  const env = { ANTHROPIC_API_KEY: 'sk-secret', ALLOWED_ORIGINS: '*' };
  const frames = ['content_block_start|{"index":0,"content_block":{"type":"text"}}', 'content_block_delta|{"index":0,"delta":{"type":"text_delta","text":"Yo"}}', 'message_delta|{"delta":{"stop_reason":"end_turn"}}', 'message_stop|{}'].map((f) => { const [e, d] = f.split('|'); return `event: ${e}\ndata: ${d}\n\n`; }).join('');
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return new Response(frames, { headers: { 'content-type': 'text/event-stream' } }); };
  const res = await handle(new Request('https://w/chat', { method: 'POST', headers: { origin: 'https://a.b', 'content-type': 'application/json' }, body: JSON.stringify({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }] }) }), env, { fetchImpl });
  const text = await res.text();
  assert.match(text, /event: text\ndata: {"t":"Yo"}/);
  assert.match(text, /event: done\ndata: {"stop":"end_turn"}/);
  assert.equal(seen.headers['x-api-key'], 'sk-secret');
  assert.equal(seen.body.stream, true);
  assert.equal(seen.body.model, 'claude-sonnet-5-5');
  assert.ok(!text.includes('sk-secret'));
});

test('weather: parses Open-Meteo, rejects junk, builds unit-aware URLs', () => {
  const d = parseForecast({ current: { temperature_2m: 27.6, apparent_temperature: 30, weather_code: 3, is_day: 0 }, daily: { temperature_2m_max: [31.2], temperature_2m_min: [22], precipitation_probability_max: [40] } });
  assert.equal(d.temp, 28); assert.equal(d.hi, 31); assert.equal(d.isDay, false);
  assert.throws(() => parseForecast({}));
  assert.match(forecastUrl({ lat: 1, lon: 2 }, 'f'), /temperature_unit=fahrenheit/);
});

test('events: upcoming drops past timed events, sorts, dedupes', () => {
  eventsStore.reset();
  events.create({ title: 'Past', date: 'today', time: '08:00' }, NOW);
  events.create({ title: 'Later', date: 'today', time: '15:00' }, NOW);
  events.create({ title: 'Tomorrow', date: 'tomorrow' }, NOW);
  assert.equal(events.create({ title: 'later', date: 'today', time: '15:00' }, NOW).existed, true);
  assert.deepEqual(events.upcoming(NOW).map((e) => e.title), ['Later', 'Tomorrow']);
  assert.equal(events.create({ title: 'x', date: 'nope' }, NOW).ok, false);
});

test('study progress: streak, accuracy and week bars come from logged data only', () => {
  study.reset();
  assert.equal(P.hasAnyData(), false);
  assert.equal(P.streak(NOW), 0);
  P.logFocus(25, NOW); P.logAnswers(4, 3, NOW);
  P.logFocus(30, new Date(2026, 9, 28, 10));
  assert.equal(P.today(NOW).focusMin, 25);
  assert.equal(P.streak(NOW), 2);
  assert.equal(P.accuracy(NOW).pct, 75);
  assert.equal(P.week(NOW).length, 7);
  assert.equal(P.week(NOW)[5].focusMin, 30);
});
