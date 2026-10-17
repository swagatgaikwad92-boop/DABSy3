import { handlePush, runDue } from "./push.js";
import { ytSearch, ytEmbeddable, pdfSearch, verifyPdf, fetchPdf } from "./search.js";
/* ============================================================
   DABSy AI proxy — Cloudflare Worker
   browser (DABSy PWA)  ->  this Worker  ->  AI provider + search API

   WHY: the PWA is public static files. Anything inside it (including a
   key) is readable by anyone. The secrets live HERE, as Worker secrets.

   Endpoints (JSON, POST unless noted)
     GET  /health        -> { ok, ai:boolean, search:boolean }
     POST /v1/generate   { task, system, prompt, json?, image? } -> { ok, text }
     POST /v1/research   { query, subject?, level?, maxResults?, maxMinutes?, wantPdf? }   (keyless: YouTube + PDFs, verified)
     GET  /v1/pdf?url=…  streams a PDF (https only, ≤25 MB, SSRF-guarded) so Study Space can read it despite CORS
                         -> { ok, results:[{title,url,source,description,type,durationMin,relevance}] }

   Secrets / vars (see wrangler.toml and BACKEND.md)
     ANTHROPIC_API_KEY   (secret)  AI provider key      — OR —  GEMINI_API_KEY
     BRAVE_API_KEY       (secret)  real web search (research falls back to "no search" without it)
     ALLOWED_ORIGINS     (var)     comma list, e.g. https://you.github.io
     AI_MODEL            (var, optional)
     RATE (KV namespace, optional) per-IP daily budget that survives isolate restarts

   Nothing here is "free unlimited AI": every call costs the key owner
   money. Limits below exist to protect that budget.
   ============================================================ */

const LIMITS = { perMinute: 12, perDay: 150, promptChars: 6000, systemChars: 3000, imageBytes: 1_500_000, maxTokens: 900 };
const TASKS = new Set(["chat", "intent", "explain", "doubt", "conflict", "recall", "rank"]);
const mem = new Map(); // per-isolate fallback when no KV is bound

function cors(env, req) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin); // exact match only; "*" is deliberately not supported for an AI proxy
  return { ok, headers: ok ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } : {} };
}
const json = (obj, status, extra) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(extra || {}) } });

async function rateLimit(env, ip) {
  const now = Date.now(), minKey = `m:${ip}:${Math.floor(now / 60000)}`, dayKey = `d:${ip}:${new Date().toISOString().slice(0, 10)}`;
  async function bump(key, ttl) {
    if (env.RATE) { const v = Number(await env.RATE.get(key)) || 0; await env.RATE.put(key, String(v + 1), { expirationTtl: ttl }); return v + 1; }
    const v = (mem.get(key) || 0) + 1; mem.set(key, v); if (mem.size > 5000) mem.clear(); return v;
  }
  const m = await bump(minKey, 120), d = await bump(dayKey, 90000);
  if (m > LIMITS.perMinute) return { limited: true, retryAfter: 30 };
  if (d > LIMITS.perDay) return { limited: true, retryAfter: 3600 };
  return { limited: false };
}

/* ---------------- model call ---------------- */
async function callModel(env, { system, prompt, json: wantJson, image }) {
  const sys = (system || "") + (wantJson ? "\nRespond with valid JSON only. No markdown." : "");
  if (env.ANTHROPIC_API_KEY) {
    const content = [];
    if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
    content.push({ type: "text", text: prompt });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.AI_MODEL || "claude-haiku-4-5", max_tokens: LIMITS.maxTokens, system: sys, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) throw new Error("provider-" + r.status);
    const d = await r.json();
    return (d.content || []).map((p) => p.text || "").join("");
  }
  if (env.GEMINI_API_KEY) {
    // v10.3: gemini-2.0-flash was shut down on 1 June 2026. Defaults below follow Google's deprecations page (2026-10-12).
    // For streaming, retries and per-task models use dabsy-brain.js (the standalone AI Worker) instead.
    const parts = [{ text: prompt }];
    if (image) parts.push({ inline_data: { mime_type: "image/jpeg", data: image } });
    let model = env.AI_MODEL && !/^gemini-2\.0/.test(env.AI_MODEL) ? env.AI_MODEL : "gemini-3.5-flash-lite";
    const gen = { temperature: 0.7, maxOutputTokens: LIMITS.maxTokens };
    if (wantJson) gen.responseMimeType = "application/json";
    if (/^gemini-3/.test(model)) gen.thinkingConfig = { thinkingLevel: /3\.8|3\.1-pro/.test(model) ? "low" : "minimal" };
    else if (/^gemini-2\.5/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
    const body = { contents: [{ role: "user", parts }], generationConfig: gen };
    if (sys.trim()) body.systemInstruction = { parts: [{ text: sys }] };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("provider-" + r.status);
    const d = await r.json();
    return ((d.candidates || [])[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  }
  throw new Error("no-provider");
}

/* ---------------- search ---------------- */
function mins(v) {
  if (!v) return null;
  if (typeof v === "number") return Math.round(v / 60) || null;
  const p = String(v).split(":").map(Number).filter((n) => !isNaN(n));
  if (!p.length) return null;
  const s = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
  return Math.max(1, Math.round(s / 60));
}
async function brave(env, path, q, count) {
  const u = new URL("https://api.search.brave.com/res/v1/" + path);
  u.searchParams.set("q", q); u.searchParams.set("count", String(count)); u.searchParams.set("safesearch", "strict");
  const r = await fetch(u, { headers: { "X-Subscription-Token": env.BRAVE_API_KEY, Accept: "application/json" } });
  if (!r.ok) throw new Error("search-" + r.status);
  return r.json();
}

async function research(env, body) {
  const q = String(body.query || "").slice(0, 200).trim();
  if (!q) return { ok: false, error: "bad-request" };
  const max = Math.min(12, Math.max(3, Number(body.maxResults) || 8));
  const maxMin = Number(body.maxMinutes) || 60;
  // keyless discovery (YouTube + optional PDFs); Brave adds general web results only when its key is set
  const jobs = [ytSearch(q + " explained", 14).catch(() => null), body.wantPdf ? pdfSearch(q, 8).catch(() => null) : Promise.resolve([]),
    env.BRAVE_API_KEY ? brave(env, "web/search", q, 8).catch(() => null) : Promise.resolve(null)];
  const [yt, pdfs, web] = await Promise.all(jobs);
  if (yt === null && pdfs === null && web === null) return { ok: false, error: "search-unavailable" };
  const items = [];
  (yt || []).forEach((v) => { if (!v.durationMin || v.durationMin <= maxMin) items.push(Object.assign({ kind: "video", snippet: v.description }, v)); });
  ((web && web.web && web.web.results) || []).forEach((r) => items.push({ title: r.title, url: r.url, snippet: (r.description || "").replace(/<[^>]+>/g, ""), source: r.meta_url?.hostname || "", durationMin: null, kind: "web" }));
  (pdfs || []).forEach((p) => items.push(Object.assign({ kind: "pdf", snippet: p.description }, p)));
  // verify what we're about to recommend (parallel, capped)
  const checked = await Promise.all(items.slice(0, 22).map(async (it) => {
    if (it.kind === "video") { const ok = await ytEmbeddable(it.videoId); if (ok === false) return null; it.embeddable = ok === true; }
    else if (it.kind === "pdf") { const v = await verifyPdf(it.url); if (!v) return null; it.pdfVerified = true; it.sizeBytes = v.bytes; }
    return it;
  }));
  const clean = checked.filter((i) => i && /^https?:\/\//.test(i.url || "")).slice(0, 16);
  if (!clean.length) return { ok: true, results: [] };
  let ranked = null;
  if (env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY) {
    try {
      const list = clean.map((r, i) => `${i}. ${r.title} | ${r.source} | ${(r.snippet || "").slice(0, 160)}`).join("\n");
      const text = await callModel(env, { system: "You rank study resources. You never invent items.", json: true,
        prompt: `Student wants: ${q}${body.level ? " (" + body.level + ")" : ""}.\nCandidates:\n${list}\nReturn JSON {"items":[{"i":<index>,"relevance":0..1,"type":"video|article|practice|notes|pdf|course","description":"<=140 chars, factual from the snippet only"}]} with only the best ${max}, best first. Drop spam, ads, paywalled or off-topic items.` });
      const o = JSON.parse(text.replace(/^```json|```$/g, "").trim());
      ranked = Array.isArray(o.items) ? o.items : null;
    } catch (e) { ranked = null; }
  }
  const out = (it, rel, type, desc) => ({ title: it.title, url: it.url, source: it.source, description: desc || it.snippet, type: type || (it.kind === "video" ? "video" : it.kind === "pdf" ? "pdf" : undefined), durationMin: it.durationMin, relevance: rel,
    embeddable: it.embeddable, pdfVerified: it.pdfVerified, sizeBytes: it.sizeBytes, videoId: it.videoId });
  const results = ranked
    ? ranked.filter((x) => clean[x.i]).map((x) => out(clean[x.i], Math.max(0, Math.min(1, Number(x.relevance) || 0.5)), x.type, x.description))
    : clean.slice(0, max).map((r, i) => out(r, Math.max(0.3, 0.9 - i * 0.05)));
  return { ok: true, results: results.slice(0, max) };
}

/* ---------------- router ---------------- */
export default {
  async fetch(req, env) {
    const c = cors(env, req);
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
    if (!c.ok && req.headers.get("Origin")) return json({ ok: false, error: "origin-not-allowed" }, 403);

    if (url.pathname === "/health" && req.method === "GET")
      return json({ ok: true, ai: !!(env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY), search: true, brave: !!env.BRAVE_API_KEY, pdfProxy: true }, 200, c.headers);

    if (url.pathname.startsWith("/v1/push/")) return handlePush(req, env, c, url, json);   // own limits; does not use the AI quota

    if (url.pathname === "/v1/pdf" && req.method === "GET") {
      const rl0 = await rateLimit(env, (req.headers.get("CF-Connecting-IP") || "unknown") + ":pdf");
      if (rl0.limited) return json({ ok: false, error: "rate-limited" }, 429, c.headers);
      const r = await fetchPdf(url.searchParams.get("url") || "");
      if (r.error) return json({ ok: false, error: r.error }, r.status, c.headers);
      return new Response(r.body, { status: 200, headers: { "Content-Type": "application/pdf", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", ...c.headers } });
    }
    if (req.method !== "POST") return json({ ok: false, error: "not-found" }, 404, c.headers);
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(env, ip);
    if (rl.limited) return json({ ok: false, error: "rate-limited", retryAfter: rl.retryAfter }, 429, { ...c.headers, "Retry-After": String(rl.retryAfter) });

    let body; try { body = await req.json(); } catch (e) { return json({ ok: false, error: "bad-json" }, 400, c.headers); }

    try {
      if (url.pathname === "/v1/generate") {
        const task = String(body.task || "chat");
        if (!TASKS.has(task)) return json({ ok: false, error: "bad-task" }, 400, c.headers);
        const prompt = String(body.prompt || ""), system = String(body.system || "");
        if (!prompt || prompt.length > LIMITS.promptChars || system.length > LIMITS.systemChars) return json({ ok: false, error: "bad-size" }, 400, c.headers);
        let image = body.image ? String(body.image) : undefined;
        if (image && image.length > LIMITS.imageBytes) return json({ ok: false, error: "image-too-large" }, 413, c.headers);
        const text = await callModel(env, { system, prompt, json: !!body.json, image });
        return json({ ok: true, text }, 200, c.headers);
      }
      if (url.pathname === "/v1/research") return json(await research(env, body), 200, c.headers);
    } catch (e) {
      return json({ ok: false, error: String(e.message || "upstream").slice(0, 60) }, 502, c.headers);
    }
    return json({ ok: false, error: "not-found" }, 404, c.headers);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runDue(env)); },
};
