// Quick visual smoke: screenshots of home and chat on a phone viewport. Usage: node tests/e2e/smoke.mjs <outdir>
import { chromium } from 'playwright';
import { createStaticServer } from '../../scripts/serve.mjs';
import { createMockBackend } from './mock-backend.mjs';

const out = process.argv[2] || '/tmp';
const web = createStaticServer().listen(0);
const mock = createMockBackend();
mock.server.listen(0);
const base = `http://localhost:${web.address().port}`;
const api = `http://localhost:${mock.server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((apiUrl) => { try { localStorage.setItem('dabsy3:prefs', JSON.stringify({ v: 1, data: { apiUrl } })); } catch {} }, api);
await ctx.route('**/api.open-meteo.com/**', (r) => r.fulfill({ json: { current: { temperature_2m: 27.4, apparent_temperature: 29, weather_code: 2, is_day: 1, wind_speed_10m: 9, relative_humidity_2m: 60 }, daily: { temperature_2m_max: [31], temperature_2m_min: [22], precipitation_probability_max: [20], weather_code: [2] } } }));
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[console]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + '/?e2e=1');
await page.waitForSelector('.dabsy[data-ready="1"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/home.png` });
await page.fill('.composer__input', 'long please');
await page.keyboard.press('Enter').catch(() => {});
await page.click('.send');
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/chat-streaming.png` });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/chat-done.png` });
await browser.close();
web.close(); mock.server.close();
