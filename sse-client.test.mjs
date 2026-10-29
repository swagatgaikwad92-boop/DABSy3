import test from 'node:test';
import assert from 'node:assert/strict';
import { SSEParser, sseFrame } from '../../src/ai/sse.js';
import { streamChat, AIError, normalizeApiUrl } from '../../src/ai/client.js';

test('SSE parser handles split chunks, CRLF, comments and multi-line data', () => {
  const p = new SSEParser();
  const out = [];
  for (const c of ['event: text\r\nda', 'ta: {"t":"hi"}\r\n\r', '\n: ping\n\nevent: done\ndata: a\ndata: b\n\n']) out.push(...p.push(c));
  assert.deepEqual(out, [{ event: 'text', data: '{"t":"hi"}' }, { event: 'done', data: 'a\nb' }]);
});

const streamOf = (chunks, { delay = 0 } = {}) => new ReadableStream({
  async start(c) { for (const ch of chunks) { if (delay) await new Promise((r) => setTimeout(r, delay)); c.enqueue(new TextEncoder().encode(ch)); } c.close(); },
});
const okRes = (chunks, opts) => ({ ok: true, status: 200, body: streamOf(chunks, opts) });

test('streamChat delivers text, tool and done events in order', async () => {
  const got = [];
  const fetchImpl = async () => okRes([sseFrame('text', { t: 'Hel' }), sseFrame('text', { t: 'lo' }), sseFrame('tool', { id: 't1', name: 'x', input: {} }), sseFrame('done', { stop: 'tool_use' })]);
  await streamChat({ url: 'https://x', body: {}, onEvent: (t, d) => got.push([t, d]), fetchImpl });
  assert.deepEqual(got.map((g) => g[0]), ['text', 'text', 'tool', 'done']);
});

test('no url → config error', async () => {
  await assert.rejects(streamChat({ url: '', body: {}, onEvent() {} }), (e) => e instanceof AIError && e.kind === 'config');
});

test('connection failure before any event retries once, then succeeds', async () => {
  let n = 0, retried = 0;
  const fetchImpl = async () => { if (n++ === 0) throw new TypeError('network'); return okRes([sseFrame('done', { stop: 'end_turn' })]); };
  await streamChat({ url: 'https://x', body: {}, onEvent() {}, onRetry: () => retried++, fetchImpl });
  assert.equal(n, 2); assert.equal(retried, 1);
});

test('503 is retried; 400 is not', async () => {
  let n = 0;
  const f503 = async () => { n++; return { ok: false, status: 503, json: async () => ({ error: { message: 'busy' } }) }; };
  await assert.rejects(streamChat({ url: 'https://x', body: {}, onEvent() {}, fetchImpl: f503 }), (e) => e.kind === 'http' && e.status === 503);
  assert.equal(n, 2);
  n = 0;
  const f400 = async () => { n++; return { ok: false, status: 400, json: async () => ({ error: { message: 'bad' } }) }; };
  await assert.rejects(streamChat({ url: 'https://x', body: {}, onEvent() {}, fetchImpl: f400 }), (e) => e.status === 400 && e.message === 'bad');
  assert.equal(n, 1);
});

test('server error event surfaces as AIError(server) and is never retried', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return okRes([sseFrame('error', { code: 'x', message: 'Model busy' })]); };
  await assert.rejects(streamChat({ url: 'https://x', body: {}, onEvent() {}, fetchImpl }), (e) => e.kind === 'server' && e.message === 'Model busy');
  assert.equal(n, 1);
});

test('stream that ends without done is reported as truncated (not silently accepted)', async () => {
  const fetchImpl = async () => okRes([sseFrame('text', { t: 'partial' })]);
  await assert.rejects(streamChat({ url: 'https://x', body: {}, onEvent() {}, fetchImpl }), (e) => e.kind === 'truncated');
});

test('user abort mid-stream throws aborted and stops delivering text', async () => {
  const ctl = new AbortController();
  const got = [];
  const fetchImpl = async (u, { signal }) => ({
    ok: true, status: 200,
    body: new ReadableStream({
      async start(c) {
        signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        for (let i = 0; i < 50; i++) { c.enqueue(new TextEncoder().encode(sseFrame('text', { t: 'x' }))); await new Promise((r) => setTimeout(r, 10)); }
      },
    }),
  });
  setTimeout(() => ctl.abort(), 60);
  await assert.rejects(streamChat({ url: 'https://x', body: {}, signal: ctl.signal, onEvent: (t) => got.push(t), fetchImpl }), (e) => e.kind === 'aborted');
  const n = got.length;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(got.length, n);
  assert.ok(n > 0 && n < 50);
});

test('idle timeout aborts a stalled stream', async () => {
  const fetchImpl = async (u, { signal }) => ({ ok: true, status: 200, body: new ReadableStream({ start(c) { signal.addEventListener('abort', () => c.error(new DOMException('a', 'AbortError'))); } }) });
  await assert.rejects(streamChat({ url: 'https://x', body: {}, onEvent() {}, fetchImpl, timeouts: { idle: 60 }, retries: 0 }), (e) => e.kind === 'timeout');
});

test('normalizeApiUrl accepts https and local http only', () => {
  assert.equal(normalizeApiUrl('https://a.workers.dev/'), 'https://a.workers.dev');
  assert.equal(normalizeApiUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeApiUrl('http://192.168.1.5:8787/'), 'http://192.168.1.5:8787');
  assert.equal(normalizeApiUrl('http://evil.com'), null);
  assert.equal(normalizeApiUrl('javascript:alert(1)'), null);
  assert.equal(normalizeApiUrl(''), null);
});
