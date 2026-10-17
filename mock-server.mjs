// Local test server: the REAL dabsy-brain.js Worker code, with Google Gemini replaced by a scripted mock.
// Gemini timing is SIMULATED (first token after FIRST_MS, then a chunk every CHUNK_MS). Run: node tests/mock-server.mjs
import http from "node:http";
import worker from "../backend/dabsy-brain.js";
const ENV = { GEMINI_API_KEY: "TEST-KEY", ALLOWED_ORIGINS: "http://localhost:8090,http://127.0.0.1:8090", RATE_PER_MIN: "500", RATE_PER_DAY: "5000" };
const S = { scenario: "ok", legacy: false, first: 900, chunk: 220, thinkStall: 0, upstream: [], browser: [] };
const enc = new TextEncoder();
const REPLIES = [
  [/owl/i, { reply: "Owls can rotate their heads about 270 degrees, which lets them look behind without moving their bodies.", type: "chat", state: "HAPPY" }],
  [/laundry/i, { reply: "Added that to your list.", type: "task_add", state: "HAPPY", task: { title: "Pick up laundry", durationMin: 30 } }],
  [/Explain for a Class 11/i, { reply: "**What is Newton's second law?**\nForce: a push or pull on an object.\nThe acceleration of an object depends on the net force and its mass.\nF = m × a\n1. Write down the known values.\n2. Choose the formula F = m a.\n3. Substitute and solve.", state: "FOCUSED" }],
];
const pickReply = (txt) => (REPLIES.find(([re]) => re.test(txt)) || [0, { reply: "Sure, happy to help with that.", type: "chat", state: "IDLE" }])[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body), txt = body.contents[0].parts[0].text;
  S.upstream.push({ t: Date.now(), model: String(url).match(/models\/([^:]+)/)[1], stream: /stream/.test(url), len: txt.length });
  if (S.scenario === "quota") return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric requests per day" } }), { status: 429 });
  if (S.scenario === "503-once" && S.upstream.length % 2 === 1) return new Response("{}", { status: 503 });
  if (S.scenario === "503-always") return new Response("{}", { status: 503 });
  if (S.scenario === "429-short" && S.upstream.length % 2 === 1) return new Response(JSON.stringify({ error: { message: "per minute" } }), { status: 429, headers: { "Retry-After": "1" } });
  const full = JSON.stringify(pickReply(txt));
  const isStream = /stream/.test(url);
  await sleep(S.first);                                    // simulated time to first token
  if (!isStream) { await sleep(S.chunk * (full.match(/[\s\S]{1,14}/g).length - 1)); }   // a non-streaming call only returns when the WHOLE answer has been generated
  if (!isStream) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: full }] }, finishReason: "STOP" }] }), { status: 200 });
  const pieces = full.match(/[\s\S]{1,14}/g);
  const stream = new ReadableStream({ async start(c) { for (let i = 0; i < pieces.length; i++) { if (i) await sleep(S.chunk); c.enqueue(enc.encode("data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: pieces[i] }] }, ...(i === pieces.length - 1 ? { finishReason: "STOP" } : {}) }] }) + "\n\n")); } c.close(); } });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
};
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const buf = Buffer.concat(chunks);
  const u = new URL(req.url, "http://localhost:8787");
  if (u.pathname === "/__set") { Object.assign(S, JSON.parse(buf.toString())); S.upstream = []; S.browser = []; res.writeHead(200, { "access-control-allow-origin": "*" }); return res.end("{}"); }
  if (u.pathname === "/__stats") { res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); return res.end(JSON.stringify({ upstream: S.upstream, browser: S.browser })); }
  if (req.method === "POST") { let b = {}; try { b = JSON.parse(buf.toString()); } catch (_) {} S.browser.push({ t: Date.now(), path: u.pathname, stream: !!b.stream || u.pathname === "/v1/stream", len: String(b.message || b.prompt || "").length }); }
  // the "old Worker" emulation: ignore stream requests and answer with plain JSON
  let body = buf.length ? buf : undefined;
  if (S.legacy && body) { try { const o = JSON.parse(body.toString()); delete o.stream; body = Buffer.from(JSON.stringify(o)); } catch (_) {} }
  const r = new Request("http://w" + req.url, { method: req.method, headers: req.headers, body: req.method === "POST" ? body : undefined });
  const out = await worker.fetch(r, ENV);
  const h = {}; out.headers.forEach((v, k) => (h[k] = v)); res.writeHead(out.status, h);
  if (!out.body) return res.end();
  const rd = out.body.getReader(); res.on("close", () => rd.cancel().catch(() => {}));
  for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(value); } res.end();
});
server.listen(8787, () => console.log("mock ready"));
