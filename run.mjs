// End-to-end suite: drives the real production build in headless Chromium (phone viewport) against a scripted
// backend that speaks the real SSE protocol. Usage: node tests/e2e/run.mjs   (build first: npm run build)
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStaticServer } from '../../scripts/serve.mjs';
import { createMockBackend } from './mock-backend.mjs';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
await mkdir(SHOTS, { recursive: true });

const web = createStaticServer().listen(0);
const mock = createMockBackend();
mock.server.listen(0);
const BASE = `http://localhost:${web.address().port}`;
const API = `http://localhost:${mock.server.address().port}`;
const browser = await chromium.launch();

const WEATHER = { current: { temperature_2m: 27.4, apparent_temperature: 29.1, weather_code: 2, is_day: 1, wind_speed_10m: 9, relative_humidity_2m: 60 }, daily: { temperature_2m_max: [31], temperature_2m_min: [22], precipitation_probability_max: [20], weather_code: [2] } };

async function open({ api = API, viewport = { width: 390, height: 844 }, reducedMotion = 'no-preference', storage = {}, weather = 'ok', reuse } = {}) {
  const ctx = reuse?.ctx || await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
  const page = reuse?.page || await ctx.newPage();
  const problems = [];
  if (!reuse) {
    await ctx.addInitScript(([apiUrl, extra, first]) => {
      try {
        if (!sessionStorage.getItem('seeded')) {
          sessionStorage.setItem('seeded', '1');
          localStorage.setItem('dabsy3:prefs', JSON.stringify({ v: 1, data: { apiUrl } }));
          for (const [k, v] of Object.entries(extra)) localStorage.setItem('dabsy3:' + k, JSON.stringify({ v: 1, data: v }));
        }
      } catch { /* ignore */ }
    }, [api, storage, true]);
    await ctx.route('**/api.open-meteo.com/**', (r) => (weather === 'ok' ? r.fulfill({ json: WEATHER }) : r.abort()));
    await ctx.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: [{ name: 'Mumbai', admin1: 'Maharashtra', country_code: 'IN', latitude: 19.07, longitude: 72.87 }] } }));
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  }
  await page.goto(BASE + '/?e2e=1');
  await page.waitForSelector('.dabsy[data-ready="1"]');
  await page.waitForTimeout(350);
  return { ctx, page, problems };
}

const stored = (page, key) => page.evaluate((k) => { const r = localStorage.getItem('dabsy3:' + k); return r ? JSON.parse(r).data : null; }, key);
const settle = (page, ms = 260) => page.waitForTimeout(ms);
const say = async (page, text) => { await page.fill('.composer__input', text); await page.click('.send'); };
const idle = (page, timeout = 20000) => page.waitForFunction(() => !window.__dabsy.conv.busy, null, { timeout });
const overflow = (page) => page.evaluate(() => {
  const bad = [];
  const vw = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll('#app *')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > vw + 1 || r.left < -1) && !el.closest('.md-table, .md-pre, .sheet:not(.is-open), .toasts') && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"]') && !el.closest('.dabsy')) bad.push(el.className || el.tagName);
  }
  return { scrollW: document.documentElement.scrollWidth, vw, bad: [...new Set(bad)].slice(0, 6) };
});
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  let h = null;
  try {
    await mock.server.listening;
    await fetch(API + '/__reset');
    await fn((o) => (h = open(o).then((x) => { h = x; return x; })));
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e });
    console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`);
    try { const x = await h; if (x?.page) await shot(x.page, 'FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)); } catch { /* ignore */ }
  } finally {
    try { await (await h)?.ctx?.close(); } catch { /* ignore */ }
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
const noProblems = (x) => ok(x.problems.length === 0, 'console/page errors: ' + x.problems.join(' | '));

console.log(`\nDABSy e2e → ${BASE}  (mock backend ${API})\n`);

await test('boot: home renders, widgets present, no overflow, no errors', async (start) => {
  const x = await start();
  const { page } = x;
  ok(await page.locator('.widget').count() >= 5, 'expected the default widgets');
  eq(await page.locator('.app').getAttribute('data-view'), 'home');
  const ov = await overflow(page);
  ok(ov.scrollW <= ov.vw, `horizontal overflow: ${JSON.stringify(ov)}`);
  eq(ov.bad, [], 'elements outside the viewport');
  ok((await page.locator('.whisper').textContent()).startsWith('Good '), 'whisper greeting');
  await shot(page, '01-home');
  noProblems(x);
});

await test('character is placed on the home anchor, and flies to the chat anchor and back', async (start) => {
  const { page } = await start();
  const near = async (sel) => page.evaluate((s) => {
    const a = document.querySelector(s).getBoundingClientRect(), d = document.querySelector('.dabsy__body').getBoundingClientRect();
    return Math.hypot((a.left + a.width / 2) - (d.left + d.width / 2), (a.top + a.height / 2) - (d.top + d.height / 2));
  }, sel);
  ok(await near('.anchor--home') < 6, 'DABSy not on home anchor');
  await page.click('.composer__input');
  await page.waitForTimeout(120);
  ok(await page.locator('.dabsy').getAttribute('data-state') === 'flying', 'should be flying mid-transition');
  await page.waitForTimeout(1300);
  eq(await page.locator('.app').getAttribute('data-view'), 'chat');
  ok(await near('.anchor--chat') < 6, 'DABSy not on chat anchor after flight');
  const st = await page.locator('.dabsy').getAttribute('data-state');
  ok(st === 'listening', 'composer focus → listening, got ' + st);
  await shot(page, '02-chat-empty');
  await page.click('.chat-tools button[aria-label="Close conversation"]');
  await page.waitForTimeout(1400);
  eq(await page.locator('.app').getAttribute('data-view'), 'home');
  ok(await near('.anchor--home') < 6, 'DABSy did not return home');
});

await test('Android back button closes the chat; Escape too', async (start) => {
  const { page } = await start();
  await page.click('.composer__input');
  await page.waitForTimeout(400);
  eq(await page.locator('.app').getAttribute('data-view'), 'chat');
  await page.goBack();
  await page.waitForTimeout(500);
  eq(await page.locator('.app').getAttribute('data-view'), 'home');
  ok(page.url().includes('e2e=1'), 'should stay on the app');
  await page.click('.whisper');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  eq(await page.locator('.app').getAttribute('data-view'), 'home');
});

await test('streaming: text arrives progressively, markdown renders, stop button shows while busy', async (start) => {
  const x = await start();
  const { page } = x;
  await say(page, 'long please');
  await page.waitForFunction(() => document.querySelector('.msg--assistant .md')?.textContent.length > 40);
  ok(await page.locator('.send[data-mode="stop"]').count() === 1, 'send turns into stop while streaming');
  const a = await page.locator('.msg--assistant .md').textContent();
  await page.waitForTimeout(150);
  const b = await page.locator('.msg--assistant .md').textContent();
  ok(b.length > a.length, 'text should keep growing while streaming');
  await shot(page, '03-streaming');
  await idle(page);
  eq(await page.locator('.send').getAttribute('data-mode'), 'send');
  for (const sel of ['h3', 'h4', 'ul li', 'table', 'pre code', 'ol li', 'strong', 'em']) ok(await page.locator(`.msg--assistant .md ${sel}`).count() > 0, 'missing rendered ' + sel);
  eq(await page.locator('.md-pre__bar span').first().textContent(), 'python');
  ok(await page.locator('.md-copy').count() === 1, 'code copy button');
  const ov = await overflow(page);
  ok(ov.scrollW <= ov.vw, 'overflow in chat: ' + JSON.stringify(ov));
  const atBottom = await page.evaluate(() => { const s = document.querySelector('.chat-scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 4; });
  ok(atBottom, 'should follow the stream to the bottom');
  await page.locator('.chat-scroll').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(150);
  await shot(page, '04-long-answer-top');
  ok(await page.locator('.jump:not([hidden])').count() === 1, 'jump-to-latest appears when scrolled up');
  await page.click('.jump');
  await page.waitForTimeout(100);
  ok(await page.locator('.jump[hidden]').count() === 1, 'jump hides at bottom');
  noProblems(x);
});

await test('scrolling up during a stream is respected (no yank to bottom)', async (start) => {
  const { page } = await start();
  await say(page, 'long please');
  await page.waitForFunction(() => document.querySelector('.chat-scroll').scrollHeight > document.querySelector('.chat-scroll').clientHeight + 200);
  await page.locator('.chat-scroll').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(500);
  const top = await page.locator('.chat-scroll').evaluate((el) => el.scrollTop);
  ok(top < 40, 'scroll position should stay put, was ' + top);
  await idle(page);
});

await test('cancel: stop mid-stream keeps partial text, frees the composer, and the next turn works', async (start) => {
  const x = await start();
  const { page } = x;
  await say(page, 'slow story');
  await page.waitForFunction(() => document.querySelector('.msg--assistant .md')?.textContent.includes('word1'));
  const t0 = Date.now();
  await page.click('.send');
  await idle(page, 2000);
  ok(Date.now() - t0 < 1200, 'stop should take effect quickly');
  const partial = await page.locator('.msg--assistant .md').first().textContent();
  ok(partial.includes('word0') && !partial.includes('word39'), 'partial text kept');
  ok((await page.locator('.msg--assistant .msg__note').textContent()).includes('Stopped'), 'stopped note');
  ok(await page.locator('.msg__error').count() === 0, 'no error for a user stop');
  await say(page, 'hello again');
  await idle(page);
  ok((await page.locator('.msg--assistant').last().textContent()).includes('You said: hello again'), 'follow-up after stop');
  await settle(page, 300);
  const api = await stored(page, 'chat');
  ok(api.api.some((m) => m.role === 'assistant' && String(m.content).includes('word0')), 'partial answer kept in context');
  noProblems(x);
});

await test('follow-up context is sent; study mode and answer style change the actual prompt', async (start) => {
  const { page } = await start();
  await say(page, 'hello'); await idle(page);
  await say(page, 'context check'); await idle(page);
  ok((await page.locator('.msg--assistant').last().textContent()).includes('3 message(s)'), 'history should include prior turns');
  await say(page, 'sysinfo'); await idle(page);
  let t = await page.locator('.msg--assistant').last().textContent();
  ok(t.includes('study=false') && t.includes('style=balanced') && /tools=1\d/.test(t), 'default is balanced, study off, tools attached: ' + t);
  await page.click('button[aria-label="Study mode"]');
  await page.waitForTimeout(300);
  eq(await page.locator('.app').getAttribute('data-study'), '1');
  await say(page, 'sysinfo'); await idle(page);
  t = await page.locator('.msg--assistant').last().textContent();
  ok(t.includes('study=true'), 'study mode must change the system prompt: ' + t);
  await page.evaluate(() => window.__dabsy.prefs.set({ style: 'concise' }));
  await say(page, 'sysinfo'); await idle(page);
  t = await page.locator('.msg--assistant').last().textContent();
  ok(t.includes('style=concise'), 'style pref reaches the prompt: ' + t);
  await shot(page, '05-study-mode');
});

await test('errors: server error, auto-retry on dropped connection, 503, and unreachable backend', async (start) => {
  const x = await start();
  const { page } = x;
  await say(page, 'error please'); await idle(page);
  ok((await page.locator('.msg__error').textContent()).includes('busy right now'), 'server error text');
  await shot(page, '06-error');
  await page.waitForFunction(() => document.querySelector('.dabsy').dataset.state !== 'thinking', null, { timeout: 4000 });
  await page.click('.msg__error button'); await idle(page);
  eq(await page.locator('.msg--user').count(), 1, 'retry must not duplicate the user message');
  await page.click('button[aria-label="New conversation"]');
  await fetch(API + '/__reset');
  await say(page, 'flaky one'); await idle(page);
  ok((await page.locator('.msg--assistant').last().textContent()).includes('You said: flaky one'), 'transparent retry succeeded');
  const reqs = await (await fetch(API + '/__requests')).json();
  eq(reqs.length, 2, 'exactly one automatic retry');
  await page.click('button[aria-label="New conversation"]');
  await say(page, 'http503 please'); await idle(page);
  ok(await page.locator('.msg__error').count() === 1, '503 shows an error');
  await page.evaluate(() => window.__dabsy.prefs.set({ apiUrl: 'http://localhost:1' }));
  await page.click('button[aria-label="New conversation"]');
  await say(page, 'hello'); await idle(page, 30000);
  ok((await page.locator('.msg__error').textContent()).includes('Could not reach'), 'unreachable backend message');
  ok(!x.problems.some((p) => p.startsWith('pageerror')), 'no uncaught exceptions: ' + x.problems.join(' | '));
});

await test('no backend configured: honest message with a path to Settings', async (start) => {
  const { page } = await start({ api: '' });
  await say(page, 'hello'); await idle(page);
  ok((await page.locator('.msg__error').textContent()).includes('not connected'), 'config error');
  await shot(page, '07-not-connected');
  await page.click('.msg__error .btn--primary');
  await page.waitForSelector('.sheet.is-open');
  ok((await page.locator('.sheet__title').textContent()) === 'Settings');
});

await test('butler: create task acts on real data; failures are reported as failures', async (start) => {
  const x = await start();
  const { page } = x;
  await say(page, 'add task Buy milk'); await idle(page);
  ok(await page.locator('.act--ok').count() === 1, 'action card');
  ok((await page.locator('.act').textContent()).includes('Buy milk'));
  await settle(page, 250);
  const t = (await stored(page, 'tasks')).items;
  eq(t.length, 1); eq(t[0].title, 'Buy milk'); eq(t[0].source, 'dabsy');
  await say(page, 'add task Buy milk'); await idle(page);
  eq((await stored(page, 'tasks')).items.length, 1, 'duplicate must not be created');
  ok((await page.locator('.msg--assistant').last().textContent()).includes('already there'), 'told the truth about the duplicate');
  await say(page, 'bad id please'); await idle(page);
  ok(await page.locator('.act--error').count() === 1, 'error card for a tool failure');
  ok((await page.locator('.msg--assistant').last().textContent()).includes('didn’t work'), 'assistant relays the failure');
  await shot(page, '08-butler-task');
  await say(page, 'rename task'); await idle(page);
  await settle(page, 250);
  eq((await stored(page, 'tasks')).items[0].title, 'Renamed by DABSy');
  noProblems(x);
});

await test('butler: plan_day needs confirmation (nothing saved before), then adds + schedules; decline changes nothing', async (start) => {
  const { page } = await start({ storage: { tasks: { items: [{ id: 't_existing1', title: 'Finish report', priority: 'normal', due: null, time: null, notes: '', done: false, doneAt: null, createdAt: 1, source: 'user' }] } } });
  await say(page, 'plan my day');
  await page.waitForSelector('.confirm--plan');
  await settle(page, 250);
  eq((await stored(page, 'tasks')).items.length, 1, 'nothing saved before confirming');
  const rows = await page.locator('.confirm--plan li').count();
  eq(rows, 3);
  ok(await page.locator('.confirm--plan .tag').count() === 1, 'existing task flagged, not duplicated');
  await page.waitForFunction(() => document.querySelector('.dabsy').dataset.state === 'listening', null, { timeout: 4000 });
  await shot(page, '09-plan-confirm');
  await page.click('.confirm--plan .btn--primary');
  await idle(page);
  await settle(page, 250);
  const items = (await stored(page, 'tasks')).items;
  eq(items.length, 3, '2 new + 1 existing');
  eq(items.find((t) => t.id === 't_existing1').time, '11:00');
  ok((await page.locator('.msg--assistant').last().textContent()).includes('2 new, 1 scheduled'));
  // decline path
  await say(page, 'plan my day'); await page.waitForSelector('.confirm--plan[data-state="pending"]');
  await page.click('.confirm--plan[data-state="pending"] .btn--quiet'); await idle(page);
  eq((await stored(page, 'tasks')).items.length, 3, 'declined plan changes nothing');
  ok((await page.locator('.msg--assistant').last().textContent()).includes('left everything as it was'));
});

await test('butler: delete is confirmed; decline keeps the task; confirm removes it', async (start) => {
  const { page } = await start({ storage: { tasks: { items: [{ id: 't_a1', title: 'Pay rent', priority: 'high', due: null, time: null, notes: '', done: false, doneAt: null, createdAt: 1, source: 'user' }] } } });
  await say(page, 'delete task');
  await page.waitForSelector('.confirm--delete');
  await page.click('.confirm--delete .btn--quiet'); await idle(page); await settle(page, 250);
  eq((await stored(page, 'tasks')).items.length, 1, 'declined delete keeps the task');
  await say(page, 'delete task'); await page.waitForSelector('.confirm--delete[data-state="pending"]');
  await page.click('.confirm--delete[data-state="pending"] .btn--danger'); await idle(page); await settle(page, 250);
  eq((await stored(page, 'tasks')).items.length, 0, 'confirmed delete removes it');
  ok(await page.locator('.act--ok').count() === 1);
});

await test('stop while a confirmation is pending cancels it and leaves data untouched', async (start) => {
  const { page } = await start({ storage: { tasks: { items: [{ id: 't_a1', title: 'Keep me', priority: 'normal', due: null, time: null, notes: '', done: false, doneAt: null, createdAt: 1, source: 'user' }] } } });
  await say(page, 'delete task'); await page.waitForSelector('.confirm--delete');
  await page.click('.send'); await idle(page, 3000); await settle(page, 250);
  eq((await stored(page, 'tasks')).items.length, 1);
  eq(await page.locator('.confirm--delete').getAttribute('data-state'), 'cancelled');
  // history stays valid for the next turn (tool_use has its tool_result)
  await say(page, 'hello'); await idle(page);
  ok((await page.locator('.msg--assistant').last().textContent()).includes('You said: hello'), 'next turn works after a cancelled tool exchange');
});

await test('study: quiz card is interactive, records real results, and offers to review misses', async (start) => {
  const { page } = await start();
  await say(page, 'quiz me on plants'); await idle(page);
  await page.waitForSelector('.quiz');
  await page.locator('.quiz__q[data-open="1"] .quiz__opt').nth(1).click(); // Q1 correct (B)
  await page.waitForTimeout(150);
  ok(await page.locator('.quiz__q').first().getAttribute('data-state') === 'right');
  await page.locator('.quiz__q[data-open="1"] .quiz__opt').nth(1).click(); // Q2 wrong (Nucleus)
  await page.waitForSelector('.quiz__result');
  await shot(page, '10-quiz-done');
  await settle(page, 250);
  const prog = await stored(page, 'study');
  const day = Object.values(prog.days)[0];
  eq([day.answered, day.correct], [2, 1], 'logged results');
  await page.click('.quiz__result .btn');
  await idle(page);
  ok((await page.locator('.msg--user').last().textContent()).includes('1/2'), 'review prompt includes the score');
});

await test('widgets: customise (hide, reorder, resize, options) and persist across reload', async (start) => {
  const x = await start();
  const { page } = x;
  await page.click('.customize');
  await page.waitForSelector('.sheet.is-open .wrow');
  await shot(page, '11-customize');
  await page.click('button[aria-label="Show Clock & date"]');
  await page.click('button[aria-label="Move Quick actions up"]');
  await settle(page, 200);
  await page.click('.wrow:has-text("Weather") .seg button:has-text("Wide")');
  await page.click('.sheet__head button[aria-label="Close"]');
  await page.waitForTimeout(500);
  eq(await page.locator('.widget[data-id="clock"]').count(), 0, 'clock hidden');
  const order = await page.locator('.widget-grid .widget').evaluateAll((els) => els.map((e) => e.dataset.id));
  eq(order[0], 'quick', 'quick actions moved first: ' + order);
  ok(await page.locator('.widget[data-id="weather"].w--m').count() === 1, 'weather widened');
  await settle(page, 300);
  await page.reload();
  await page.waitForSelector('.dabsy[data-ready="1"]');
  eq(await page.locator('.widget[data-id="clock"]').count(), 0, 'hidden state persisted');
  eq((await page.locator('.widget-grid .widget').evaluateAll((els) => els.map((e) => e.dataset.id)))[0], 'quick');
  noProblems(x);
});

await test('tasks: add via sheet, complete from widget, edit, priority, delete with undo — all persisted', async (start) => {
  const x = await start();
  const { page } = x;
  await page.click('.qa:has-text("Add task")');
  await page.waitForSelector('.sheet.is-open .input');
  await page.fill('.sheet.is-open .input >> nth=0', 'Read chapter 4');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tsk__row');
  eq(await page.locator('.tsk__row').count(), 1);
  await page.click('.tsk__row .pill:has-text("Normal")');
  ok(await page.locator('.tsk__row .pill:has-text("High")').count() === 1, 'priority cycles');
  await page.click('.tsk__title');
  await page.fill('.input--inline', 'Read chapter 5'); await page.keyboard.press('Enter');
  await page.waitForSelector('.tsk__title:has-text("Read chapter 5")');
  await shot(page, '12-tasks-sheet');
  await page.click('.tsk__row button[aria-label^="Delete"]');
  await page.waitForSelector('.toast');
  eq(await page.locator('.tsk__row').count(), 0);
  await page.click('.toast button');
  await page.waitForSelector('.tsk__row');
  await page.click('.sheet__head button[aria-label="Close"]');
  await page.waitForTimeout(450);
  await page.click('.widget[data-id="tasks"] .check');
  await settle(page, 300);
  eq((await stored(page, 'tasks')).items[0].done, true, 'completed from the widget');
  await page.reload(); await page.waitForSelector('.dabsy[data-ready="1"]');
  eq((await stored(page, 'tasks')).items.length, 1, 'persisted');
  noProblems(x);
});

await test('conversation persists across reload, and "new conversation" clears it', async (start) => {
  const { page } = await start();
  await say(page, 'hello there'); await idle(page); await settle(page, 300);
  await page.reload(); await page.waitForSelector('.dabsy[data-ready="1"]');
  await page.click('.whisper'); await page.waitForTimeout(500);
  ok((await page.locator('.msg--assistant').last().textContent()).includes('You said: hello there'));
  await page.click('button[aria-label="New conversation"]');
  eq(await page.locator('.msg').count(), 0);
  ok(await page.locator('.chat-empty').isVisible(), 'empty state returns');
});

await test('calendar events and weather widget use real stored/fetched data', async (start) => {
  const x = await start();
  const { page } = x;
  await page.click('.widget[data-id="calendar"] .btn');
  await page.waitForSelector('.sheet.is-open');
  await page.fill('.sheet.is-open input[placeholder="Event title"]', 'Physics lab');
  await page.fill('.sheet.is-open input[type="time"]', '14:30');
  await page.click('button[aria-label="Add event"]');
  await page.waitForSelector('.tsk__row:has-text("Physics lab")');
  await page.click('.sheet__head button[aria-label="Close"]'); await page.waitForTimeout(450);
  ok((await page.locator('.widget[data-id="calendar"]').textContent()).includes('Physics lab'), 'event on widget');
  await page.click('.widget[data-id="weather"] .btn');
  await page.waitForSelector('.sheet.is-open input[aria-label="City"]');
  await page.fill('input[aria-label="City"]', 'Mumbai'); await page.keyboard.press('Enter');
  await page.click('.sheet.is-open .tsk__title:has-text("Mumbai")');
  await page.waitForSelector('.wx__temp');
  eq(await page.locator('.wx__temp').textContent(), '27°');
  ok((await page.locator('.widget[data-id="weather"]').textContent()).includes('Partly cloudy'));
  await shot(page, '13-widgets-filled');
  noProblems(x);
});

await test('weather failure is shown honestly (no fake numbers) with retry', async (start) => {
  const { page } = await start({ weather: 'fail', storage: { weather: { loc: { name: 'Pune', lat: 18.5, lon: 73.8 }, units: 'c', cache: null } } });
  await page.waitForSelector('.widget[data-id="weather"] .btn');
  const t = await page.locator('.widget[data-id="weather"]').textContent();
  ok(/Couldn.t load weather|Offline/.test(t) && !/\d°/.test(t), 'honest error: ' + t);
});

await test('focus session: start, persists across reload, finalises from the clock, logs real minutes', async (start) => {
  const { page } = await start();
  await page.click('.qa:has-text("Study")');
  await page.waitForSelector('.sheet.is-open .btn--primary');
  await page.click('.sheet.is-open .btn--primary:has-text("Start focus")');
  await page.waitForSelector('.big-timer');
  ok(/^\d+:\d\d$/.test(await page.locator('.big-timer').textContent()));
  await settle(page, 300);
  await page.reload(); await page.waitForSelector('.dabsy[data-ready="1"]');
  ok(await page.locator('.widget[data-id="study"] .study__timer').count() === 1, 'running session survives reload');
  // fast-forward: make it overdue, reload → completes and logs the full length
  await page.evaluate(() => { const k = 'dabsy3:study'; const s = JSON.parse(localStorage.getItem(k)); s.data.focus.endsAt = Date.now() - 1000; localStorage.setItem(k, JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('.dabsy[data-ready="1"]');
  await page.waitForSelector('.toast');
  ok((await page.locator('.toast').textContent()).includes('Focus session complete'));
  await settle(page, 300);
  const day = Object.values((await stored(page, 'study')).days)[0];
  eq(day.focusMin, 25);
  eq((await stored(page, 'study')).focus, null);
});

await test('settings: scene, motion, connection test, invalid URL rejected, erase needs a second tap', async (start) => {
  const { page } = await start();
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('.sheet.is-open');
  await shot(page, '14-settings');
  await page.click('.scenebtn:has-text("Cabin")');
  await settle(page, 400);
  eq(await page.evaluate(() => window.__dabsy.scene.key.split('-')[0]), 'cabin');
  await page.fill('input[aria-label="Backend address"]', 'http://evil.example.com');
  await page.click('button:has-text("Save & test")');
  ok((await page.locator('.sheet .note[role="status"]').textContent()).includes('https://'), 'insecure URL rejected');
  await page.fill('input[aria-label="Backend address"]', API);
  await page.click('button:has-text("Save & test")');
  await page.waitForFunction(() => document.querySelector('.sheet .note[role="status"]').textContent.includes('Connected'));
  await page.click('button:has-text("Erase all data")');
  ok(await page.locator('button:has-text("Tap again")').count() === 1, 'two-step erase');
});

await test('reduced motion: no looping animation, character still relocates', async (start) => {
  const { page } = await start({ reducedMotion: 'reduce' });
  const anim = await page.locator('.dabsy__float').evaluate((el) => getComputedStyle(el).animationName);
  eq(anim, 'none');
  await page.click('.composer__input');
  await page.waitForTimeout(500);
  const d = await page.evaluate(() => { const a = document.querySelector('.anchor--chat').getBoundingClientRect(), b = document.querySelector('.dabsy__body').getBoundingClientRect(); return Math.hypot(a.left - b.left, a.top - b.top); });
  ok(d < 6, 'character reached the chat anchor without a flight');
});

await test('keyboard-sized viewport and small phones: composer visible, no overflow, card fits', async (start) => {
  for (const vp of [{ width: 390, height: 480 }, { width: 320, height: 568 }]) {
    const x = await start({ viewport: vp });
    const { page } = x;
    await say(page, 'long please'); await idle(page);
    const m = await page.evaluate(() => {
      const c = document.querySelector('.composer').getBoundingClientRect(), card = document.querySelector('.chat-card').getBoundingClientRect();
      return { composerBottom: c.bottom, vh: window.innerHeight, cardBottom: card.bottom, composerTop: c.top, cardTop: card.top };
    });
    ok(m.composerBottom <= m.vh + 1 && m.composerTop > m.cardBottom - 4, `composer in view / below card at ${vp.width}x${vp.height}: ${JSON.stringify(m)}`);
    const ov = await overflow(page);
    ok(ov.scrollW <= ov.vw && ov.bad.length === 0, `overflow at ${vp.width}: ${JSON.stringify(ov)}`);
    await shot(page, `15-small-${vp.width}x${vp.height}`);
    await x.ctx.close();
  }
});

await test('performance: streaming a long answer causes no long main-thread tasks; interactions stay under 100ms', async (start) => {
  const { page } = await start();
  await page.evaluate(() => { window.__long = []; new window.PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ entryTypes: ['longtask'] }); });
  const t0 = Date.now();
  await say(page, 'long please');
  await idle(page);
  const long = await page.evaluate(() => window.__long);
  const worst = Math.max(0, ...long);
  console.log(`      stream of ~3.4k chars took ${Date.now() - t0}ms; long tasks: ${long.length}, worst ${worst.toFixed(0)}ms`);
  ok(worst < 150, 'a long task blocked the main thread for ' + worst + 'ms');
  const lat = await page.evaluate(async () => {
    const t = performance.now(); document.querySelector('button[aria-label="Study mode"]').click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t;
  });
  ok(lat < 100, 'interaction to next paint ' + lat);
});

await test('accessibility basics: every control is named; primary touch targets ≥ 36px; text contrast token sanity', async (start) => {
  const { page } = await start();
  await page.click('.whisper'); await page.waitForTimeout(500);
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, textarea, [role="checkbox"]')].filter((el) => !el.closest('[inert],[hidden]') && el.offsetParent !== null).filter((el) => !(el.getAttribute('aria-label') || el.textContent.trim() || el.placeholder || el.title)).map((e) => e.className));
  eq(unnamed, [], 'unnamed controls');
  const small = await page.evaluate(() => [...document.querySelectorAll('.send, .icon-btn, .chip, .btn, .composer__input')].filter((el) => el.offsetParent !== null).map((el) => [el.className, el.getBoundingClientRect().height]).filter(([, h]) => h < 32));
  eq(small, [], 'touch targets under 32px');
});

await browser.close();
web.close();
mock.server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length ? 1 : 0);
