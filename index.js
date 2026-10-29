// DABSy backend: a thin, stateless streaming proxy. Holds the provider API key (as a Worker secret — never in the
// browser), validates input, enforces an origin allowlist, and streams normalised events back to the app.
//
//   POST /chat    { system, messages, tools?, maxTokens? } → text/event-stream  (text · tool · done · error)
//   GET  /health  → { ok: true, model }
import * as provider from './providers/anthropic.js';
import { sseFrame } from '../src/ai/sse.js';

const MAX_BODY = 300_000;
const DEFAULTS = { MODEL: 'claude-sonnet-5-5', MAX_TOKENS: '2048' };

export function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*') || list.includes(origin)) return origin;
  if (!list.length && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin; // dev default
  return null;
}

const cors = (origin) => (origin ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } : { vary: 'Origin' });
const json = (status, body, origin) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) } });
const fail = (status, code, message, origin) => json(status, { error: { code, message } }, origin);

/** Validate and clamp the client's request. Returns { ok, value } or { ok: false, message }. */
export function validate(body, env) {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Body must be a JSON object.' };
  const { system, messages, tools } = body;
  if (typeof system !== 'string' || !system || system.length > 40_000) return { ok: false, message: 'system must be a string up to 40k characters.' };
  if (!Array.isArray(messages) || !messages.length || messages.length > 100) return { ok: false, message: 'messages must be 1–100 items.' };
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || (typeof m.content !== 'string' && !Array.isArray(m.content))) return { ok: false, message: 'Each message needs a role (user|assistant) and content.' };
  }
  if (messages[0].role !== 'user') return { ok: false, message: 'The first message must be from the user.' };
  if (tools != null && (!Array.isArray(tools) || tools.length > 20 || tools.some((t) => !t?.name || typeof t.input_schema !== 'object'))) return { ok: false, message: 'tools must be up to 20 items with name and input_schema.' };
  const cap = Number(env.MAX_TOKENS || DEFAULTS.MAX_TOKENS);
  const maxTokens = Math.min(Math.max(Number(body.maxTokens) || cap, 64), cap);
  return { ok: true, value: { model: env.MODEL || DEFAULTS.MODEL, maxTokens, system, messages, tools: tools || [] } };
}

export async function handle(request, env, { fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);

  if (request.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) });
  if (request.headers.get('origin') && !origin) return fail(403, 'forbidden_origin', 'This origin is not allowed.', null);

  if (url.pathname === '/health' && request.method === 'GET') return json(200, { ok: true, model: env.MODEL || DEFAULTS.MODEL, configured: !!env.ANTHROPIC_API_KEY }, origin);
  if (url.pathname !== '/chat') return fail(404, 'not_found', 'Not found.', origin);
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', origin);
  if (!env.ANTHROPIC_API_KEY) return fail(500, 'misconfigured', 'The backend has no API key configured.', origin);

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return fail(413, 'too_large', 'Request too large.', origin);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return fail(413, 'too_large', 'Request too large.', origin);
    body = JSON.parse(text);
  } catch { return fail(400, 'bad_json', 'Body is not valid JSON.', origin); }
  const v = validate(body, env);
  if (!v.ok) return fail(400, 'bad_request', v.message, origin);

  const enc = new TextEncoder();
  const upstream = new AbortController();
  request.signal?.addEventListener('abort', () => upstream.abort());
  let ping;
  const out = new ReadableStream({
    async start(controller) {
      ping = setInterval(() => { try { controller.enqueue(enc.encode(': ping\n\n')); } catch { /* closed */ } }, 10_000);
      try {
        for await (const ev of provider.stream({ env, request: v.value, signal: upstream.signal, fetchImpl })) {
          controller.enqueue(enc.encode(sseFrame(ev.type, ev.data)));
        }
      } catch (e) {
        if (!upstream.signal.aborted) controller.enqueue(enc.encode(sseFrame('error', { code: 'proxy', message: 'The connection to the AI service failed.' })));
      } finally {
        clearInterval(ping);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() { clearInterval(ping); upstream.abort(); },
  });
  return new Response(out, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', ...cors(origin) } });
}

export default { fetch: (request, env) => handle(request, env) };
