/* ============================================================
   dabsy-brain — Cloudflare Worker (replacement, v2)
   DABSy app  ->  this Worker  ->  Google Gemini API

   Contract the app uses:  POST  { "message": "..." }  ->  { "reply": "..." }
   Errors come back as     { "ok": false, "error": "<code>", "detail": "<short reason>" }
   so the app (and you) can see the REAL cause instead of a vague message.

   SECRET (set in Cloudflare, never in the app):  GEMINI_API_KEY
   Optional variables:  GEMINI_MODEL (e.g. gemini-3.5-flash), ALLOWED_ORIGINS
   ============================================================ */

const DEFAULT_ORIGINS = ["https://swagatgaikwad92-boop.github.io"];

// Tried in order. If Google retires or doesn't know one (404), the next is used.
const MODEL_CHAIN = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

const LIMITS = { messageChars: 14000, maxOutputTokens: 4096, perMinute: 15, perDay: 300 };
const mem = new Map();

function getKey(env) {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GEMINI_KEY || env.API_KEY || "";
}
function allowedOrigins(env) {
  const extra = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  return extra.length ? extra : DEFAULT_ORIGINS;
}
function corsHeaders(env, req) {
  const origin = req.headers.get("Origin") || "";
  const ok = allowedOrigins(env).includes(origin);
  return {
    ok,
    origin,
    headers: ok
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" }
      : {},
  };
}
const send = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(extra || {}) } });

function limited(ip) {
  const now = Date.now();
  const mk = `m:${ip}:${Math.floor(now / 60000)}`, dk = `d:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const bump = (k) => { const v = (mem.get(k) || 0) + 1; mem.set(k, v); return v; };
  if (mem.size > 4000) mem.clear();
  return bump(mk) > LIMITS.perMinute || bump(dk) > LIMITS.perDay;
}

function modelList(env) {
  const first = String(env.GEMINI_MODEL || "").trim();
  return first ? [first, ...MODEL_CHAIN.filter((m) => m !== first)] : MODEL_CHAIN;
}

// Calls Gemini once for one model. Returns { ok, text } or { ok:false, status, reason }.
async function callGemini(model, key, message) {
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: message }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: LIMITS.maxOutputTokens },
      }),
    });
  } catch (e) {
    return { ok: false, status: 0, reason: "network: " + String(e && e.message || e).slice(0, 80) };
  }
  let d = null;
  try { d = await r.json(); } catch (_) {}
  if (!r.ok) {
    const reason = (d && d.error && (d.error.message || d.error.status)) || ("HTTP " + r.status);
    return { ok: false, status: r.status, reason: String(reason).slice(0, 160) };
  }
  const cand = d && d.candidates && d.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
  if (!text) {
    const why = (d && d.promptFeedback && d.promptFeedback.blockReason) || (cand && cand.finishReason) || "empty";
    return { ok: false, status: 200, reason: "empty-reply (" + why + ")", empty: true };
  }
  return { ok: true, text };
}

async function think(env, message) {
  const key = getKey(env);
  if (!key) return { ok: false, error: "no-api-key", detail: "The Worker has no GEMINI_API_KEY secret.", http: 500 };
  let last = null, sawQuota = null;
  for (const model of modelList(env)) {
    const res = await callGemini(model, key, message);
    if (res.ok) return { ok: true, reply: res.text, model };
    last = Object.assign({ model }, res);
    // Key problems: switching models will not help, so stop and report it.
    if (res.status === 400 && /api key/i.test(res.reason)) return { ok: false, error: "bad-api-key", detail: res.reason, http: 502 };
    if (res.status === 401 || res.status === 403) return { ok: false, error: "gemini-" + res.status, detail: model + ": " + res.reason, http: 502 };
    // Quota is counted per model, so another model may still have room: remember it and keep trying.
    if (res.status === 429) sawQuota = sawQuota || (model + ": " + res.reason);
    // 404 (retired/unknown model), 5xx, empty answer, network: try the next model.
  }
  if (sawQuota) return { ok: false, error: "gemini-quota", detail: sawQuota, http: 429 };
  return { ok: false, error: "gemini-" + (last ? last.status : "unknown"), detail: last ? `${last.model}: ${last.reason}` : "no model answered", http: 502 };
}

export default {
  async fetch(req, env) {
    const c = corsHeaders(env, req);
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
    if (c.origin && !c.ok) return send({ ok: false, error: "origin-not-allowed", detail: "Allowed: " + allowedOrigins(env).join(", ") }, 403);

    // Health: GET /  or  GET /health   (no key is ever shown, only yes/no)
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return send({ ok: true, worker: "dabsy-brain", version: 2, build: "2026-10-15", hasKey: !!getKey(env), models: modelList(env), allowedOrigins: allowedOrigins(env) }, 200, c.headers);
    }
    // Self-test: GET /test  asks Gemini one tiny question and shows the real result.
    if (req.method === "GET" && url.pathname === "/test") {
      if (limited("test:" + (req.headers.get("CF-Connecting-IP") || "x"))) return send({ ok: false, error: "rate-limited" }, 429, c.headers);
      const r = await think(env, "Reply with the single word: ready");
      return send(r.ok ? { ok: true, modelUsed: r.model, reply: r.reply } : { ok: false, error: r.error, detail: r.detail }, r.ok ? 200 : r.http, c.headers);
    }

    if (req.method !== "POST") return send({ ok: false, error: "use-POST" }, 405, c.headers);
    if (limited(req.headers.get("CF-Connecting-IP") || "unknown")) return send({ ok: false, error: "rate-limited", retryAfter: 30 }, 429, { ...c.headers, "Retry-After": "30" });

    let body;
    try { body = await req.json(); } catch (_) { return send({ ok: false, error: "bad-json" }, 400, c.headers); }
    const message = String((body && (body.message ?? body.prompt)) || "").trim();
    if (!message) return send({ ok: false, error: "empty-message" }, 400, c.headers);
    if (message.length > LIMITS.messageChars) return send({ ok: false, error: "message-too-long" }, 413, c.headers);

    try {
      const r = await think(env, message);
      if (r.ok) return send({ ok: true, reply: r.reply, model: r.model }, 200, c.headers);
      return send({ ok: false, error: r.error, detail: r.detail }, r.http || 502, c.headers);
    } catch (e) {
      return send({ ok: false, error: "worker-exception", detail: String(e && e.message || e).slice(0, 120) }, 500, c.headers);
    }
  },
};
