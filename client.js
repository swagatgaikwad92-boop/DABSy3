// Streaming chat client. Provider-agnostic: it speaks DABSy's own small SSE protocol to the backend
// (see worker/), so swapping the model provider never touches the app.
//
// Backend events:  text {t} · tool {id,name,input} · done {stop} · error {code,message}
import { SSEParser } from './sse.js';

export class AIError extends Error {
  constructor(kind, message, { status = 0, retryable = false, code = '' } = {}) {
    super(message);
    this.name = 'AIError';
    this.kind = kind;           // config | network | timeout | http | server | truncated | aborted
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

const DEFAULT_TIMEOUTS = { connect: 25000, idle: 45000, total: 240000 };
const RETRY_STATUS = new Set([502, 503, 504, 529]);

/** Accept https:// URLs, or http:// for localhost / private LAN testing. Returns normalised base URL or null. */
export function normalizeApiUrl(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin + u.pathname.replace(/\/+$/, '');
  return null;
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new AIError('aborted', 'Stopped')); }, { once: true });
});

async function attempt({ url, body, signal, onEvent, timeouts, fetchImpl }) {
  const ctrl = new AbortController();
  let reason = null;
  const abort = (r) => { reason = reason || r; ctrl.abort(); };
  const onUserAbort = () => abort('user');
  if (signal?.aborted) throw new AIError('aborted', 'Stopped');
  signal?.addEventListener('abort', onUserAbort, { once: true });

  let connectTimer = setTimeout(() => abort('connect'), timeouts.connect);
  const totalTimer = setTimeout(() => abort('total'), timeouts.total);
  let idleTimer = null;
  const bump = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => abort('idle'), timeouts.idle); };

  let sawEvent = false;
  let finished = false;
  try {
    let res;
    try {
      res = await fetchImpl(`${url}/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body), signal: ctrl.signal, cache: 'no-store',
      });
    } catch (e) {
      if (reason === 'user') throw new AIError('aborted', 'Stopped');
      if (reason) throw new AIError('timeout', 'The connection timed out.', { retryable: true });
      throw new AIError('network', 'Could not reach the server.', { retryable: true });
    }
    clearTimeout(connectTimer);
    connectTimer = null;

    if (!res.ok) {
      let msg = `Server returned ${res.status}.`, code = '';
      try { const j = await res.json(); msg = j?.error?.message || msg; code = j?.error?.code || ''; } catch { /* non-JSON error body */ }
      throw new AIError('http', msg, { status: res.status, code, retryable: RETRY_STATUS.has(res.status) });
    }
    if (!res.body) throw new AIError('server', 'The server sent no stream.');

    bump();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const parser = new SSEParser();
    try {
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); } catch {
          if (reason === 'user') throw new AIError('aborted', 'Stopped');
          if (reason) throw new AIError('timeout', 'The response stalled.', { retryable: !sawEvent });
          throw new AIError('network', 'The connection dropped.', { retryable: !sawEvent });
        }
        if (chunk.done) break;
        bump();
        for (const ev of parser.push(dec.decode(chunk.value, { stream: true }))) {
          let data;
          try { data = JSON.parse(ev.data); } catch { continue; }
          sawEvent = true;
          if (ev.event === 'error') throw new AIError('server', data.message || 'The model reported an error.', { code: data.code || '', retryable: false });
          if (ev.event === 'done') finished = true;
          onEvent(ev.event, data);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    if (!finished) throw new AIError('truncated', 'The response ended unexpectedly.', { retryable: false });
  } finally {
    clearTimeout(connectTimer);
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    signal?.removeEventListener('abort', onUserAbort);
    // Release the connection whenever we stop reading early (timeouts, errors).
    if (!finished) ctrl.abort();
  }
}

/**
 * Stream one model turn. Retries once, transparently, if the connection fails before any event arrived.
 * `onEvent(type, data)` is called for text / tool / done. Throws AIError on failure.
 */
export async function streamChat({ url, body, signal, onEvent, onRetry, timeouts = {}, fetchImpl = globalThis.fetch.bind(globalThis), retries = 1 }) {
  if (!url) throw new AIError('config', 'DABSy is not connected to an AI backend yet.');
  const t = { ...DEFAULT_TIMEOUTS, ...timeouts };
  let seen = false;
  const wrapped = (type, data) => { seen = true; onEvent(type, data); };
  for (let n = 0; ; n++) {
    try {
      return await attempt({ url, body, signal, onEvent: wrapped, timeouts: t, fetchImpl });
    } catch (e) {
      if (!(e instanceof AIError)) throw new AIError('network', e?.message || 'Request failed.', { retryable: true });
      if (e.retryable && !seen && n < retries && !signal?.aborted) {
        onRetry?.(n + 1);
        await sleep(700 * (n + 1), signal);
        continue;
      }
      throw e;
    }
  }
}

/** Health probe for Settings → "Test connection". */
export async function testConnection(url, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const base = normalizeApiUrl(url);
  if (!base) return { ok: false, message: 'Use an https:// address (http:// works only for localhost / local network).' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetchImpl(`${base}/health`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return { ok: false, message: `Server answered ${res.status}.` };
    const j = await res.json().catch(() => ({}));
    if (j.ok !== true) return { ok: false, message: 'That address responded, but it does not look like a DABSy backend.' };
    return { ok: true, message: j.model ? `Connected · model ${j.model}` : 'Connected', model: j.model || '' };
  } catch {
    return { ok: false, message: 'Could not reach that address.' };
  } finally { clearTimeout(t); }
}
