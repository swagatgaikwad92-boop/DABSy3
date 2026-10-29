// Anthropic Messages API adapter → DABSy's normalised event stream.
// To use another provider, add a sibling module exporting the same two functions and select it in ../index.js.
import { SSEParser } from '../../src/ai/sse.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

export function buildRequest({ model, maxTokens, system, messages, tools }) {
  const body = { model, max_tokens: maxTokens, stream: true, system, messages };
  if (tools?.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  return body;
}

/** Stateful normaliser: feed parsed Anthropic events, get zero or more normalised events back. */
export function createNormalizer() {
  const blocks = new Map(); // index -> { type, id, name, json }
  let stop = 'end_turn';
  return function normalize(type, data) {
    const out = [];
    switch (type) {
      case 'content_block_start': {
        const b = data.content_block || {};
        blocks.set(data.index, { type: b.type, id: b.id, name: b.name, json: '' });
        break;
      }
      case 'content_block_delta': {
        const d = data.delta || {};
        const b = blocks.get(data.index);
        if (d.type === 'text_delta' && d.text) out.push({ type: 'text', data: { t: d.text } });
        else if (d.type === 'input_json_delta' && b) b.json += d.partial_json || '';
        break;
      }
      case 'content_block_stop': {
        const b = blocks.get(data.index);
        if (b?.type === 'tool_use') {
          let input = {};
          try { input = b.json ? JSON.parse(b.json) : {}; } catch { input = { __parse_error: true }; }
          out.push({ type: 'tool', data: { id: b.id, name: b.name, input } });
        }
        blocks.delete(data.index);
        break;
      }
      case 'message_delta':
        if (data.delta?.stop_reason) stop = data.delta.stop_reason;
        break;
      case 'message_stop':
        out.push({ type: 'done', data: { stop } });
        break;
      case 'error':
        out.push({ type: 'error', data: { code: data.error?.type || 'upstream', message: friendly(data.error?.type, data.error?.message) } });
        break;
      default: break; // message_start, ping, thinking blocks…
    }
    return out;
  };
}

function friendly(type, message) {
  if (type === 'overloaded_error') return 'The AI service is busy right now. Please try again in a moment.';
  if (type === 'rate_limit_error') return 'Too many requests — give it a moment and try again.';
  if (type === 'authentication_error' || type === 'permission_error') return 'The backend is not authorised with the AI provider.';
  return message || 'The AI service reported an error.';
}

/** Stream a completion. Yields normalised events: {type:'text'|'tool'|'done'|'error', data}. */
export async function* stream({ env, request, signal, fetchImpl = fetch }) {
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': API_VERSION },
    body: JSON.stringify(buildRequest(request)),
    signal,
  });
  if (!res.ok) {
    let type = '', message = '';
    try { const j = await res.json(); type = j.error?.type || ''; message = j.error?.message || ''; } catch { /* ignore */ }
    yield { type: 'error', data: { code: type || 'upstream_' + res.status, message: friendly(type, res.status >= 500 ? '' : message) } };
    return;
  }
  const normalize = createNormalizer();
  const parser = new SSEParser();
  const dec = new TextDecoder();
  const reader = res.body.getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(dec.decode(value, { stream: true }))) {
        let data;
        try { data = JSON.parse(ev.data); } catch { continue; }
        for (const out of normalize(ev.event, data)) {
          if (out.type === 'done' || out.type === 'error') finished = true;
          yield out;
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  if (!finished) yield { type: 'error', data: { code: 'truncated', message: 'The AI service closed the stream early.' } };
}
