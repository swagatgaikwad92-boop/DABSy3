/* ============================================================
   DABSy AI proxy — Cloudflare Worker
   browser (DABSy PWA)  ->  this Worker  ->  AI provider + search API

   WHY: the PWA is public static files. Anything inside it (including a
   key) is readable by anyone. The secrets live HERE, as Worker secrets.

   Endpoints (JSON, POST unless noted)
     GET  /health        -> { ok, ai:boolean, search:boolean }
     POST /v1/generate   { task, system, prompt, json?, image? } -> { ok, text }
     POST /v1/research   { query, subject?, level?, maxResults? }
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
    const parts = [{ text: sys + "\n\n" + prompt }];
    if (image) parts.push({ inline_data: { mime_type: "image/jpeg", data: image } });
    const model = env.AI_MODEL || "gemini-2.0-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.7, maxOutputTokens: LIMITS.maxTokens } }),
    });
    if (!r.ok) throw new Error("provider-" + r.status);
    const d = await r.json();
    return ((d.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
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
  if (!env.BRAVE_API_KEY) return { ok: false, error: "no-search" };
  const max = Math.min(10, Math.max(3, Number(body.maxResults) || 8));
  const [web, vid] = await Promise.all([brave(env, "web/search", q, 10).catch(() => null), brave(env, "videos/search", q, 6).catch(() => null)]);
  const items = [];
  ((web && web.web && web.web.results) || []).forEach((r) => items.push({ title: r.title, url: r.url, snippet: (r.description || "").replace(/<[^>]+>/g, ""), source: r.meta_url?.hostname || "", durationMin: null, kind: "web" }));
  ((vid && vid.results) || []).forEach((r) => items.push({ title: r.title, url: r.url, snippet: (r.description || "").replace(/<[^>]+>/g, ""), source: r.meta_url?.hostname || "", durationMin: mins(r.video?.duration), kind: "video" }));
  const clean = items.filter((i) => /^https?:\/\//.test(i.url || "")).slice(0, 16);
  if (!clean.length) return { ok: true, results: [] };

  // The model may only RANK and DESCRIBE what search returned. URLs never come from the model.
  let ranked = null;
  if (env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY) {
    try {
      const list = clean.map((r, i) => `${i}. ${r.title} | ${r.source} | ${r.snippet.slice(0, 160)}`).join("\n");
      const text = await callModel(env, {
        system: "You rank study resources. You never invent items.", json: true,
        prompt: `Student wants: ${q}${body.level ? " (" + body.level + ")" : ""}.\nCandidates:\n${list}\nReturn JSON {"items":[{"i":<index>,"relevance":0..1,"type":"video|article|practice|notes|pdf|course","description":"<=140 chars, factual from the snippet only"}]} with only the best ${max}, best first. Drop spam, ads, paywalled or off-topic items.`,
      });
      const o = JSON.parse(text.replace(/^```json|```$/g, "").trim());
      ranked = Array.isArray(o.items) ? o.items : null;
    } catch (e) { ranked = null; }
  }
  const results = ranked
    ? ranked.filter((x) => clean[x.i]).map((x) => ({ title: clean[x.i].title, url: clean[x.i].url, source: clean[x.i].source, description: x.description || clean[x.i].snippet, type: x.type, durationMin: clean[x.i].durationMin, relevance: Math.max(0, Math.min(1, Number(x.relevance) || 0.5)) }))
    : clean.slice(0, max).map((r, i) => ({ title: r.title, url: r.url, source: r.source, description: r.snippet, type: r.kind === "video" ? "video" : undefined, durationMin: r.durationMin, relevance: Math.max(0.3, 0.9 - i * 0.06) }));
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
      return json({ ok: true, ai: !!(env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY), search: !!env.BRAVE_API_KEY }, 200, c.headers);

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
};
