/* ============================================================
   dabsy-brain.js — DABSy's AI Worker, single file (v10.3 "turbo")
   Paste this whole file into Cloudflare → Workers & Pages → dabsy-brain → Edit code → Deploy.
   (If you use wrangler, it is also a valid `main` file: no imports.)

   Browser (DABSy PWA)  ->  this Worker  ->  Google Gemini API
   The API key lives ONLY in a Worker secret. It is never sent to the browser, never logged, never in an error.

   Routes
     GET  /health                      -> { ok, ai, models }
     POST /                            { message, stream?, json?, task? } -> { ok, reply }    (the original dabsy-brain contract)
     POST /                            …with stream:true                  -> text/event-stream (see below)
     POST /v1/generate                 { task, system, prompt, json?, image? } -> { ok, text }
     POST /v1/stream                   same body                           -> text/event-stream
   Stream format (Server-Sent Events, one JSON object per `data:` line):
     {"t":"text chunk"}  …repeated…   then   {"done":true}   or   {"error":"<kind>"}

   CHANGE THE MODEL HERE (one place), or with Worker variables without editing code:
     AI_MODEL_FAST  AI_MODEL_SMART  THINK_FAST  THINK_SMART  ALLOWED_ORIGINS  RATE_PER_MIN  RATE_PER_DAY
   ============================================================ */

const CONFIG = {
  // Model ids checked against Google's deprecations page (updated 2026-10-12):
  //   gemini-2.0-flash was SHUT DOWN on 1 June 2026, so it is never used here.
  //   Google recommends gemini-3.5-flash-lite / gemini-3.8-flash for new work.
  FAST_MODEL: "gemini-3.5-flash-lite",    // chat, intent, task categorisation, rankings (answers in about a second)
  FAST_THINKING: "minimal",               // gemini-3.5-flash-lite thinks "minimal" by default; we say so explicitly
  SMART_MODEL: "gemini-3.8-flash",        // study explanations and doubts: real reasoning when it matters
  SMART_THINKING: "low",                  // 3.8 Flash levels: low | medium | high (default medium = slower)
  FALLBACK_MODEL: "gemini-3.6-flash",     // ONE capacity fallback for "busy" errors only ("" turns the fallback off)
  maxTokens: { fast: 900, smart: 2200 },  // output tokens INCLUDING thinking tokens
  timeoutMs: 22000,                       // hard wall-clock limit for one user request (all attempts together)
  retry: { max: 1, baseMs: 350, capMs: 2500 },   // at most ONE retry, only for transient errors, with jitter
  limits: { perMinute: 30, perDay: 600, messageChars: 7000, systemChars: 3500, imageChars: 1_500_000 },
  defaultOrigins: ["https://swagatgaikwad92-boop.github.io"],   // used if ALLOWED_ORIGINS is not set
};
const TASKS = new Set(["chat", "intent", "explain", "doubt", "conflict", "recall", "rank"]);
const SMART_TASKS = new Set(["explain", "doubt"]);
const mem = new Map();                    // per-isolate rate counters (bind a KV namespace named RATE to make them permanent)

/* ---------------- small helpers ---------------- */
const keyOf = (env) => env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GEMINI_KEY || env.API_KEY || "";
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function corsFor(env, req) {
  const origin = req.headers.get("Origin") || "";
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = list.length ? list : CONFIG.defaultOrigins;
  const ok = !origin || allowed.includes(origin);       // no Origin = not a browser (curl / tests); allowed
  return { ok, headers: origin && ok ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } : {} };
}
const json = (obj, status, extra) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(extra || {}) } });
function log(ev) { try { console.log(JSON.stringify(ev)); } catch (_) {} }      // structured, never contains messages, prompts or keys

/* ---------------- which model, how much thinking ---------------- */
function pickModel(env, task) {
  const forced = env.AI_MODEL && !/^gemini-2\.0/.test(env.AI_MODEL) ? env.AI_MODEL : "";   // an old AI_MODEL=gemini-2.0-* would 404, so it is ignored
  const smart = SMART_TASKS.has(task);
  return {
    model: forced || (smart ? env.AI_MODEL_SMART || CONFIG.SMART_MODEL : env.AI_MODEL_FAST || CONFIG.FAST_MODEL),
    level: smart ? env.THINK_SMART || CONFIG.SMART_THINKING : env.THINK_FAST || CONFIG.FAST_THINKING,
    maxTokens: smart ? CONFIG.maxTokens.smart : CONFIG.maxTokens.fast,
  };
}
// Gemini 3.x takes `thinkingLevel`; Gemini 2.5 takes a token `thinkingBudget`. Levels a model does not accept are moved to the nearest allowed one.
function thinkingConfigFor(model, level) {
  if (/^gemini-3\.8-flash/.test(model) || /^gemini-3\.1-pro/.test(model)) return { thinkingLevel: level === "minimal" ? "low" : level };
  if (/^gemini-3/.test(model)) return { thinkingLevel: level };
  if (/^gemini-2\.5-pro/.test(model)) return { thinkingBudget: { minimal: 128, low: 512, medium: 2048, high: 8192 }[level] || 512 };
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: { minimal: 0, low: 1024, medium: 4096, high: 8192 }[level] ?? 1024 };
  return null;                                           // unknown model family: send no thinking settings rather than guess
}
function buildBody({ system, prompt, json: wantJson, image }, pick, model) {
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: "image/jpeg", data: image } });
  const gen = { temperature: 0.7, maxOutputTokens: pick.maxTokens };
  if (wantJson) gen.responseMimeType = "application/json";
  const tc = thinkingConfigFor(model, pick.level); if (tc) gen.thinkingConfig = tc;
  const body = { contents: [{ role: "user", parts }], generationConfig: gen };
  const sys = (system || "") + (wantJson ? "\nRespond with valid JSON only. No markdown." : "");
  if (sys.trim()) body.systemInstruction = { parts: [{ text: sys }] };
  return body;
}

/* ---------------- classify provider failures (so a real quota is not reported as a passing overload) ---------------- */
function retryAfterMs(res, text) {
  const h = res.headers.get("Retry-After");
  if (h) { const s = Number(h); if (Number.isFinite(s)) return s * 1000; const d = Date.parse(h); if (d) return Math.max(0, d - Date.now()); }
  const m = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(text || ""); return m ? Number(m[1]) * 1000 : 0;
}
function classify(status, text, res) {
  const ra = retryAfterMs(res, text);
  if (status === 429) {
    const daily = /per\s*day|daily|quota exceeded for quota metric.*day|RequestsPerDay/i.test(text || "") && !/per\s*minute/i.test(text || "");
    if (daily || /billing|exhausted.*quota/i.test(text || "") && !ra) return { kind: "quota", retryable: false, retryAfter: ra };
    return { kind: "rate", retryable: true, retryAfter: ra };         // per-minute style limit: worth ONE short retry
  }
  if (status === 400) return { kind: "bad-request", retryable: false };
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (status === 404) return { kind: "model-unavailable", retryable: false };
  if (status === 408 || status === 504) return { kind: "timeout", retryable: true, retryAfter: ra };
  if (status >= 500) return { kind: "busy", retryable: true, retryAfter: ra };
  return { kind: "upstream", retryable: false };
}
const HTTP_FOR = { quota: 429, rate: 429, "app-rate-limited": 429, busy: 503, timeout: 504, "bad-request": 400, blocked: 400, auth: 502, "model-unavailable": 502, upstream: 502, "no-provider": 503 };
const fail = (kind, c, extra) => json({ ok: false, error: kind, ...(extra || {}) }, HTTP_FOR[kind] || 502, { ...c.headers, ...(extra && extra.retryAfter ? { "Retry-After": String(Math.ceil(extra.retryAfter)) } : {}) });

/* ---------------- one Gemini call with a small, bounded retry ----------------
   Retries ONLY before any answer bytes exist, ONLY for transient kinds, at most CONFIG.retry.max times, with
   exponential backoff + jitter, honouring Retry-After (if it is short enough). Generation has no side effects
   (tasks are created in the app from the finished answer), so a retry can never duplicate a task or event. */
async function callGemini(env, req0, { stream, signal }) {
  const key = keyOf(env); if (!key) return { ok: false, kind: "no-provider" };
  const t0 = Date.now(), deadline = t0 + CONFIG.timeoutMs;
  const pick = pickModel(env, req0.task);
  let model = pick.model, lastKind = "upstream", lastRA = 0;
  for (let attempt = 0; attempt <= CONFIG.retry.max; attempt++) {
    const left = deadline - Date.now(); if (left < 1500) break;
    const ctl = new AbortController(), onAbort = () => ctl.abort(); signal && signal.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ctl.abort(), left);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      const res = await fetch(url, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify(buildBody(req0, pick, model)), signal: ctl.signal });
      if (res.ok) { clearTimeout(timer); log({ ev: "ai", task: req0.task, model, status: res.status, attempt, stream: !!stream, ms: Date.now() - t0 }); return { ok: true, res, model, timer: null, ctl, off: () => signal && signal.removeEventListener("abort", onAbort) }; }
      const text = await res.text().catch(() => ""); clearTimeout(timer); signal && signal.removeEventListener("abort", onAbort);
      const c = classify(res.status, text, res); lastKind = c.kind; lastRA = c.retryAfter || 0;
      log({ ev: "ai-error", task: req0.task, model, status: res.status, kind: c.kind, attempt, ms: Date.now() - t0 });
      if (!c.retryable || attempt >= CONFIG.retry.max) break;
      const jitter = Math.random() * 250;
      let wait = c.retryAfter ? c.retryAfter + jitter : Math.min(CONFIG.retry.capMs, CONFIG.retry.baseMs * 2 ** attempt + jitter);
      if (wait > CONFIG.retry.capMs + 300 || Date.now() + wait > deadline - 2000) break;           // asked to wait too long: stop, tell the user honestly
      if (c.kind === "busy" && CONFIG.FALLBACK_MODEL && !env.AI_MODEL && model !== CONFIG.FALLBACK_MODEL) model = env.AI_MODEL_FALLBACK || CONFIG.FALLBACK_MODEL;   // capacity problem: try the sibling model once
      await sleep(wait);
    } catch (e) {
      clearTimeout(timer); signal && signal.removeEventListener("abort", onAbort);
      if (signal && signal.aborted) return { ok: false, kind: "cancelled" };
      lastKind = ctl.signal.aborted ? "timeout" : "upstream";
      log({ ev: "ai-error", task: req0.task, model, kind: lastKind, attempt, ms: Date.now() - t0 });
      if (lastKind === "timeout" || attempt >= CONFIG.retry.max) break;
      await sleep(Math.min(CONFIG.retry.capMs, CONFIG.retry.baseMs * 2 ** attempt + Math.random() * 250));
    }
  }
  return { ok: false, kind: lastKind, retryAfter: lastRA ? Math.ceil(lastRA / 1000) : undefined };
}
const textOf = (d) => ((d.candidates || [])[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
const blockedOf = (d) => !!(d.promptFeedback && d.promptFeedback.blockReason) || ((d.candidates || [])[0]?.finishReason === "SAFETY");

async function generate(env, req0, c, signal) {
  const r = await callGemini(env, req0, { stream: false, signal });
  if (!r.ok) return { err: r };
  const d = await r.res.json().catch(() => null); r.off && r.off();
  if (!d) return { err: { kind: "upstream" } };
  if (blockedOf(d)) return { err: { kind: "blocked" } };
  const text = textOf(d);
  if (!text.trim()) return { err: { kind: "upstream" } };
  return { text, model: r.model };
}

/* ---------------- streaming: Gemini SSE -> our minimal SSE ---------------- */
function streamResponse(upstream, c, ctl, off) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const reader = upstream.body.getReader();
  let buf = "", finished = false, sawText = false;
  const send = (o) => enc.encode("data: " + JSON.stringify(o) + "\n\n");
  const body = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) { if (!finished) controller.enqueue(send(sawText ? { done: true, incomplete: true } : { error: "upstream" })); controller.close(); off && off(); return; }
          buf += dec.decode(value, { stream: true });
          let i, out = false;
          while ((i = buf.indexOf("\n\n")) >= 0 || (i = buf.indexOf("\r\n\r\n")) >= 0) {
            const evt = buf.slice(0, i); buf = buf.slice(i + (buf[i] === "\r" ? 4 : 2));
            const line = evt.split(/\r?\n/).find((l) => l.startsWith("data:")); if (!line) continue;
            let d; try { d = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
            const t = textOf(d); if (t) { sawText = true; controller.enqueue(send({ t })); out = true; }
            if (blockedOf(d)) { finished = true; controller.enqueue(send({ error: "blocked" })); }
            const fr = (d.candidates || [])[0]?.finishReason;
            if (fr && !finished) { finished = true; controller.enqueue(send(fr === "MAX_TOKENS" ? { done: true, incomplete: true } : { done: true })); }
          }
          if (out || finished) return;                      // hand the chunk to the browser now; pull() runs again for more
        }
      } catch (e) { try { controller.enqueue(send({ error: "upstream" })); controller.close(); } catch (_) {} off && off(); }
    },
    cancel() { try { reader.cancel(); } catch (_) {} try { ctl.abort(); } catch (_) {} off && off(); },   // the browser went away: stop paying for tokens
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", ...c.headers } });
}

/* ---------------- app-level rate limit ---------------- */
async function rateLimit(env, ip) {
  const perMin = num(env.RATE_PER_MIN, CONFIG.limits.perMinute), perDay = num(env.RATE_PER_DAY, CONFIG.limits.perDay);
  const now = Date.now(), minKey = `m:${ip}:${Math.floor(now / 60000)}`, dayKey = `d:${ip}:${new Date().toISOString().slice(0, 10)}`;
  async function bump(key, ttl) {
    if (env.RATE) { const v = Number(await env.RATE.get(key)) || 0; await env.RATE.put(key, String(v + 1), { expirationTtl: ttl }); return v + 1; }
    const v = (mem.get(key) || 0) + 1; mem.set(key, v); if (mem.size > 4000) mem.clear(); return v;
  }
  const m = await bump(minKey, 120), d = await bump(dayKey, 90000);
  if (m > perMin) return { limited: true, retryAfter: 20 };
  if (d > perDay) return { limited: true, retryAfter: 3600 };
  return { limited: false };
}

/* ---------------- router ---------------- */
export default {
  async fetch(req, env) {
    const c = corsFor(env, req), url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
    if (!c.ok) return json({ ok: false, error: "origin-not-allowed" }, 403);
    if (req.method === "GET" && url.pathname === "/health") {
      const f = pickModel(env, "chat"), s = pickModel(env, "explain");
      return json({ ok: true, ai: !!keyOf(env), search: false, stream: true, models: { fast: f.model, smart: s.model } }, 200, c.headers);
    }
    if (req.method !== "POST") return json({ ok: false, error: "not-found" }, 404, c.headers);

    let body; try { body = await req.json(); } catch (_) { return json({ ok: false, error: "bad-request", detail: "bad-json" }, 400, c.headers); }
    const legacy = url.pathname === "/" || url.pathname === "";
    const wantStream = url.pathname === "/v1/stream" || (legacy && body && body.stream === true);
    if (!legacy && url.pathname !== "/v1/generate" && url.pathname !== "/v1/stream") return json({ ok: false, error: "not-found" }, 404, c.headers);

    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(env, ip);
    if (rl.limited) return fail("app-rate-limited", c, { retryAfter: rl.retryAfter });

    // normalise the two request shapes
    let r0;
    if (legacy) {                                         // { message } — the original dabsy-brain contract (persona + prompt already joined by the app)
      const message = String(body.message || "");
      if (!message.trim() || message.length > CONFIG.limits.messageChars) return fail("bad-request", c);
      r0 = { task: TASKS.has(body.task) ? body.task : "chat", system: "", prompt: message, json: !!body.json };
    } else {
      const task = String(body.task || "chat"); if (!TASKS.has(task)) return fail("bad-request", c);
      const prompt = String(body.prompt || ""), system = String(body.system || "");
      if (!prompt.trim() || prompt.length > CONFIG.limits.messageChars || system.length > CONFIG.limits.systemChars) return fail("bad-request", c);
      const image = body.image ? String(body.image) : undefined;
      if (image && image.length > CONFIG.limits.imageChars) return json({ ok: false, error: "image-too-large" }, 413, c.headers);
      r0 = { task, system, prompt, json: !!body.json, image };
    }

    if (wantStream) {
      const r = await callGemini(env, r0, { stream: true, signal: req.signal });
      if (!r.ok) return r.kind === "cancelled" ? new Response(null, { status: 499 }) : fail(r.kind, c, { retryAfter: r.retryAfter });
      return streamResponse(r.res, c, r.ctl, r.off);
    }
    const g = await generate(env, r0, c, req.signal);
    if (g.err) return fail(g.err.kind, c, { retryAfter: g.err.retryAfter });
    return json(legacy ? { ok: true, reply: g.text.trim() } : { ok: true, text: g.text }, 200, c.headers);
  },
};
