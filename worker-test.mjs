// Worker tests with a mock Gemini (no network, no real key). Run: node tests/worker-test.mjs
import worker from "../backend/dabsy-brain.js";
let pass = 0, fail = 0; const ok = (n, c, e = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, e); };
const ENV = { GEMINI_API_KEY: "SECRET-KEY-123", ALLOWED_ORIGINS: "https://me.github.io" };
const ORIGIN = { Origin: "https://me.github.io", "content-type": "application/json" };
let calls = [], script = [];
const enc = new TextEncoder();
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body); calls.push({ url: String(url), body, key: init.headers["x-goog-api-key"], t: Date.now() });
  const step = script.shift() || { status: 200, json: { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] } };
  if (step.delay) await new Promise(r => setTimeout(r, step.delay));
  if (step.sse) {
    let cancelled = false; const stream = new ReadableStream({ async start(c) { for (const ev of step.sse) { if (cancelled) return; if (ev.wait) await new Promise(r => setTimeout(r, ev.wait)); if (ev.err) { c.error(new Error("x")); return; } c.enqueue(enc.encode("data: " + JSON.stringify(ev.d) + "\n\n")); } c.close(); }, cancel() { cancelled = true; step.cancelled && step.cancelled(); } });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  return new Response(typeof step.json === "string" ? step.json : JSON.stringify(step.json), { status: step.status, headers: { "content-type": "application/json", ...(step.headers || {}) } });
};
const post = (path, body, env = ENV, headers = ORIGIN) => worker.fetch(new Request("https://w.test" + path, { method: "POST", headers, body: JSON.stringify(body) }), env);
const okJson = t => ({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: "STOP" }] });
const reset = () => { calls = []; script = []; };

// 1 fast model + thinking + systemInstruction + legacy contract
reset(); let r = await post("/", { message: "hello there" }); let j = await r.json();
ok("legacy {message} -> {reply}", r.status === 200 && j.reply === "hi" && j.ok);
ok("chat uses FAST model with minimal thinking", /gemini-3\.5-flash-lite:generateContent/.test(calls[0].url) && calls[0].body.generationConfig.thinkingConfig.thinkingLevel === "minimal", calls[0].url);
ok("API key sent only upstream in header, never in the response", calls[0].key === "SECRET-KEY-123" && !JSON.stringify(j).includes("SECRET"));
// 2 smart
reset(); r = await post("/v1/generate", { task: "explain", system: "You are DABSy", prompt: "explain gravity", json: true }); j = await r.json();
ok("explain uses SMART model, thinkingLevel low, JSON mime, systemInstruction", /gemini-3\.8-flash:generateContent/.test(calls[0].url) && calls[0].body.generationConfig.thinkingConfig.thinkingLevel === "low" && calls[0].body.generationConfig.responseMimeType === "application/json" && calls[0].body.systemInstruction.parts[0].text.includes("DABSy") && j.text === "hi");
// 3 one 503 then success, fallback model
reset(); script = [{ status: 503, json: { error: { status: "UNAVAILABLE" } } }]; let t0 = Date.now(); r = await post("/v1/generate", { task: "chat", prompt: "x" }); j = await r.json();
ok("503 then success: exactly 2 upstream calls, answer returned", calls.length === 2 && j.ok, `calls=${calls.length} ms=${Date.now() - t0}`);
ok("capacity retry uses the fallback model", /gemini-3\.6-flash:/.test(calls[1].url), calls[1].url);
// 4 two 503s -> bounded
reset(); script = [{ status: 503, json: {} }, { status: 503, json: {} }, { status: 503, json: {} }]; r = await post("/v1/generate", { task: "chat", prompt: "x" }); j = await r.json();
ok("persistent 503: stops after 2 calls, honest 'busy' error with HTTP 503", calls.length === 2 && r.status === 503 && j.error === "busy");
// 5 daily quota
reset(); script = [{ status: 429, json: { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric generate_requests_per_day" } } }]; r = await post("/v1/generate", { task: "chat", prompt: "x" }); j = await r.json();
ok("daily quota: NOT retried, error=quota (not 'busy')", calls.length === 1 && j.error === "quota" && r.status === 429);
// 6 per-minute 429 with short Retry-After retried once and respected
reset(); script = [{ status: 429, json: { error: { message: "rate limit per minute" } }, headers: { "Retry-After": "1" } }]; t0 = Date.now(); r = await post("/v1/generate", { task: "chat", prompt: "x" }); j = await r.json();
ok("429 + Retry-After:1 -> waits >=1s, one retry, succeeds", calls.length === 2 && j.ok && Date.now() - t0 >= 1000, `ms=${Date.now() - t0}`);
// 7 long Retry-After
reset(); script = [{ status: 429, json: { error: { message: "rate limit per minute" } }, headers: { "Retry-After": "30" } }]; r = await post("/v1/generate", { task: "chat", prompt: "x" }); j = await r.json();
ok("429 + Retry-After:30 -> no pointless wait; error=rate with retryAfter=30 and header", calls.length === 1 && j.error === "rate" && j.retryAfter === 30 && r.headers.get("Retry-After") === "30");
// 8 400
reset(); script = [{ status: 400, json: { error: { message: "bad" } } }]; r = await post("/v1/generate", { task: "chat", prompt: "x" }); j = await r.json();
ok("400 invalid request: no retry, error=bad-request (not overload)", calls.length === 1 && j.error === "bad-request" && r.status === 400);
// 8b 404 retired model / 403 key
reset(); script = [{ status: 404, json: {} }]; r = await post("/v1/generate", { task: "chat", prompt: "x" }); j = await r.json(); ok("404 -> model-unavailable, no retry", j.error === "model-unavailable" && calls.length === 1);
reset(); script = [{ status: 403, json: { error: { message: "API key SECRET-KEY-123 invalid" } } }]; r = await post("/v1/generate", { task: "chat", prompt: "x" }); const txt = await r.text(); ok("403: error body never echoes provider text or the key", !txt.includes("SECRET") && JSON.parse(txt).error === "auth");
// 9 timeouts: slow upstream
reset(); script = [{ delay: 100, status: 200, json: okJson("late") }]; r = await post("/v1/generate", { task: "chat", prompt: "x" }); ok("slow-but-valid answer is returned", (await r.json()).ok);
// 10 stream
const chunk = (t, extra = {}) => ({ d: { candidates: [{ content: { parts: [{ text: t, ...extra }] } }] } });
reset(); script = [{ sse: [chunk("thinking...", { thought: true }), { wait: 150, ...chunk("Hel") }, { wait: 150, ...chunk("lo ") }, { wait: 150, d: { candidates: [{ content: { parts: [{ text: "world" }] }, finishReason: "STOP" }] } }] }];
t0 = Date.now(); r = await post("/v1/stream", { task: "chat", prompt: "x" });
ok("stream: SSE content-type, no-transform", /text\/event-stream/.test(r.headers.get("content-type")) && /no-transform/.test(r.headers.get("cache-control")));
const rd = r.body.getReader(), dec = new TextDecoder(); let got = [], first = 0, buf = "";
for (;;) { const { value, done } = await rd.read(); if (done) break; if (!first) first = Date.now() - t0; buf += dec.decode(value); }
got = buf.split("\n\n").filter(Boolean).map(l => JSON.parse(l.slice(5)));
ok("stream: chunks arrive incrementally, thought text excluded, ends with done", got.map(g => g.t || (g.done && "DONE")).join("|") === "Hel|lo |world|DONE", JSON.stringify(got));
ok("stream: first text reached browser after ~1st upstream chunk, not after the whole answer", first < 300, `first=${first}ms (total ~${Date.now() - t0}ms)`);
// 11 mid-stream error: no retry
reset(); script = [{ sse: [chunk("part"), { wait: 80, err: true }] }]; r = await post("/v1/stream", { task: "chat", prompt: "x" }); buf = ""; const rd2 = r.body.getReader(); for (;;) { const { value, done } = await rd2.read(); if (done) break; buf += dec.decode(value); }
ok("mid-stream failure: single upstream call, error event after partial text, no retry/duplicate", calls.length === 1 && buf.includes('"t":"part"') && buf.includes('"error"'));
// 12 cancellation
reset(); let cancelled = false; script = [{ cancelled: () => cancelled = true, sse: [chunk("a"), { wait: 800, ...chunk("b") }, { wait: 800, ...chunk("c") }] }];
r = await post("/v1/stream", { task: "chat", prompt: "x" }); const rd3 = r.body.getReader(); await rd3.read(); await rd3.cancel(); await new Promise(r => setTimeout(r, 100));
ok("client cancel propagates: upstream stream cancelled", cancelled);
// 13 CORS / origin
reset(); r = await post("/v1/generate", { task: "chat", prompt: "x" }, ENV, { Origin: "https://evil.example", "content-type": "application/json" }); ok("foreign origin rejected, no upstream call", r.status === 403 && calls.length === 0);
r = await worker.fetch(new Request("https://w.test/health", { headers: { Origin: "https://me.github.io" } }), ENV); j = await r.json(); ok("/health reports models, never the key", j.ok && j.models.fast && !JSON.stringify(j).includes("SECRET"), JSON.stringify(j));
// 14 retired model env ignored
reset(); await post("/v1/generate", { task: "chat", prompt: "x" }, { ...ENV, AI_MODEL: "gemini-2.0-flash" }); ok("AI_MODEL=gemini-2.0-flash (shut down 1 Jun 2026) is ignored", /gemini-3\.5-flash-lite/.test(calls[0].url));
reset(); await post("/v1/generate", { task: "chat", prompt: "x" }, { ...ENV, AI_MODEL_FAST: "gemini-2.5-flash" }); ok("2.5 model gets thinkingBudget, not thinkingLevel", calls[0].body.generationConfig.thinkingConfig.thinkingBudget === 0 && !("thinkingLevel" in calls[0].body.generationConfig.thinkingConfig));
// 15 app rate limit
reset(); const E2 = { ...ENV, RATE_PER_MIN: "3" }; let last; for (let i = 0; i < 5; i++) last = await post("/v1/generate", { task: "chat", prompt: "x" }, E2, { ...ORIGIN, "CF-Connecting-IP": "9.9.9.9" }); j = await last.json(); ok("app rate limit gives error=app-rate-limited with retryAfter", last.status === 429 && j.error === "app-rate-limited" && j.retryAfter > 0);
console.log(`SUMMARY ${pass}/${pass + fail}`);
