/* push.js — Web Push for DABSy reminders (payload-less, VAPID-signed).
   Flow: the app POSTs its upcoming reminders to /v1/push/schedule. A cron trigger (every minute) finds the due
   ones and sends an empty push to the phone's push service. The service worker wakes, asks
   /v1/push/pending for the text, and shows the notification — even when DABSy is closed.
   Needs: KV binding PUSH, vars VAPID_PUBLIC_KEY / VAPID_SUBJECT, secret VAPID_PRIVATE_JWK. */
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const MAX_ITEMS = 40, LATE_MS = 6 * 3600e3;

async function hashOf(endpoint) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(endpoint));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
function okEndpoint(e) {
  try { const u = new URL(e); return u.protocol === "https:" && HOSTS.some((r) => r.test(u.hostname)); } catch (_) { return false; }
}
async function vapidHeader(env, endpoint) {
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const pay = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com" })));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + pay));
  return "vapid t=" + head + "." + pay + "." + b64u(sig) + ", k=" + env.VAPID_PUBLIC_KEY;
}
async function sendPush(env, sub) {
  const r = await fetch(sub.endpoint, { method: "POST", headers: { Authorization: await vapidHeader(env, sub.endpoint), TTL: "3600", Urgency: "high" } });
  return r.status;
}
const clean = (s, n) => String(s || "").slice(0, n);

export async function handlePush(req, env, c, url, json) {
  if (!env.PUSH || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return json({ ok: false, error: "push-not-configured" }, 501, c.headers);
  if (url.pathname === "/v1/push/key" && req.method === "GET") return json({ ok: true, key: env.VAPID_PUBLIC_KEY }, 200, c.headers);
  if (req.method !== "POST") return json({ ok: false, error: "not-found" }, 404, c.headers);
  let body; try { body = await req.json(); } catch (_) { return json({ ok: false, error: "bad-json" }, 400, c.headers); }
  const sub = body.subscription;
  if (url.pathname === "/v1/push/subscribe") {
    if (!sub || !okEndpoint(sub.endpoint)) return json({ ok: false, error: "bad-subscription" }, 400, c.headers);
    const h = await hashOf(sub.endpoint);
    await env.PUSH.put("sched:" + h, JSON.stringify({ endpoint: sub.endpoint, items: [], pending: [] }), { expirationTtl: 60 * 86400 });
    return json({ ok: true, h }, 200, c.headers);
  }
  const h = sub && okEndpoint(sub.endpoint) ? await hashOf(sub.endpoint) : clean(body.h, 40);
  if (!/^[0-9a-f]{32}$/.test(h)) return json({ ok: false, error: "bad-id" }, 400, c.headers);
  const rec = JSON.parse((await env.PUSH.get("sched:" + h)) || "null");
  if (!rec) return json({ ok: false, error: "unknown-subscription" }, 404, c.headers);
  if (url.pathname === "/v1/push/schedule") {
    const now = Date.now();
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS)
      .map((i) => ({ id: clean(i.id, 80), at: Number(i.at), title: clean(i.title, 80), body: clean(i.body, 140) }))
      .filter((i) => i.id && Number.isFinite(i.at) && i.at > now - LATE_MS && i.at < now + 3 * 86400e3);
    const sent = new Set((rec.items || []).filter((i) => i.sent).map((i) => i.id));
    rec.items = items.map((i) => (sent.has(i.id) ? { ...i, sent: true } : i));
    await env.PUSH.put("sched:" + h, JSON.stringify(rec), { expirationTtl: 60 * 86400 });
    return json({ ok: true, count: rec.items.length }, 200, c.headers);
  }
  if (url.pathname === "/v1/push/pending") {            // called by the service worker after a push
    const pending = rec.pending || []; rec.pending = [];
    await env.PUSH.put("sched:" + h, JSON.stringify(rec), { expirationTtl: 60 * 86400 });
    return json({ ok: true, items: pending }, 200, c.headers);
  }
  if (url.pathname === "/v1/push/unsubscribe") { await env.PUSH.delete("sched:" + h); return json({ ok: true }, 200, c.headers); }
  return json({ ok: false, error: "not-found" }, 404, c.headers);
}

/* cron: every minute */
export async function runDue(env) {
  if (!env.PUSH || !env.VAPID_PRIVATE_JWK) return;
  const now = Date.now();
  const list = await env.PUSH.list({ prefix: "sched:", limit: 200 });
  for (const k of list.keys) {
    const rec = JSON.parse((await env.PUSH.get(k.name)) || "null"); if (!rec) continue;
    const due = (rec.items || []).filter((i) => !i.sent && i.at <= now && now - i.at < LATE_MS);
    if (!due.length) continue;
    due.forEach((i) => { i.sent = true; });
    rec.pending = (rec.pending || []).concat(due.map(({ id, title, body }) => ({ id, title, body }))).slice(-10);
    const status = await sendPush(env, rec).catch(() => 0);
    if (status === 404 || status === 410) { await env.PUSH.delete(k.name); continue; }   // subscription is gone
    await env.PUSH.put(k.name, JSON.stringify(rec), { expirationTtl: 60 * 86400 });
  }
}
