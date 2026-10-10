/* ============================================================
   D.A.B.S.y — sw.js
   Offline shell + notification relay. All paths are relative to this
   file's scope, so it works at a domain root or under a GitHub Pages
   project path (username.github.io/repo/).

   Strategy: network-first (3 s) with cache fallback, so a deploy is
   picked up on the next load while the app still opens offline.
   AI proxy calls and other origins are never cached.
   ============================================================ */
const CACHE_VERSION = "dabsy-v8.3.1";
const SCOPE = self.registration.scope;

const SHELL_FILES = ["./",
  "./agent-engine.js",
  "./ai-engine.js",
  "./animations.css",
  "./app.js",
  "./apple-touch-icon.png",
  "./boot.js",
  "./cards.css",
  "./center.css",
  "./context-engine.js",
  "./core.css",
  "./creature.css",
  "./dabsy-config.js",
  "./dabsy-core.js",
  "./director-engine.js",
  "./easter-engine.js",
  "./ecosystem-engine.js",
  "./ecosystem.css",
  "./emotion-engine.js",
  "./entertainment-engine.js",
  "./face-engine.js",
  "./fur-engine.js",
  "./fur3d-engine.js",
  "./floating-engine.js",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./index.html",
  "./interaction-engine.js",
  "./learning-engine.js",
  "./manifest.json",
  "./memory-engine.js",
  "./notification-center.js",
  "./notify-engine.js",
  "./onboarding-engine.js",
  "./outfit-engine.js",
  "./outfits-data.js",
  "./permissions-engine.js",
  "./pet-engine.js",
  "./planner-engine.js",
  "./projection-engine.js",
  "./projection.css",
  "./pwa-engine.js",
  "./reactions.js",
  "./research-service.js",
  "./resource-cards.js",
  "./schedule-engine.js",
  "./session.css",
  "./settings-engine.js",
  "./settings.css",
  "./study-blob-engine.js",
  "./study-engine.js",
  "./study-session.js",
  "./study-space-bridge.js",
  "./task-engine.js",
  "./theme-engine.js",
  "./theme.css",
  "./tour.css",
  "./ui-kit.js",
  "./ui.css",
  "./vision-engine.js",
  "./voice-engine.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // one missing optional file must not break the install
      Promise.all(SHELL_FILES.map((f) => cache.add(new URL(f, SCOPE).toString()).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // never touch the AI proxy or other apps
  event.respondWith(
    new Promise((resolve) => {
      let settled = false;
      const fromCache = () => caches.match(req, { ignoreSearch: true }).then((c) => c || caches.match(new URL("./index.html", SCOPE).toString()));
      const timer = setTimeout(() => { if (!settled) fromCache().then((c) => { if (c && !settled) { settled = true; resolve(c); } }); }, 3000);
      fetch(req).then((res) => {
        clearTimeout(timer);
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        if (!settled) { settled = true; resolve(res); }
      }).catch(() => {
        clearTimeout(timer);
        fromCache().then((c) => { if (!settled) { settled = true; resolve(c || Response.error()); } });
      });
    })
  );
});

/* ---- notification buttons -> page ---- */
self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const msg = { type: "dabsy-notif-action", id: data.id, action: event.action || "" };
    if (all.length) {
      const c = all.find((x) => "focus" in x) || all[0];
      try { await c.focus(); } catch (e) {}
      c.postMessage(msg);
    } else {
      const u = new URL("./index.html", SCOPE);
      if (data.id) u.searchParams.set("notif", data.id);
      u.searchParams.set("action", event.action || "open");
      await self.clients.openWindow(u.toString());
    }
  })());
});
self.addEventListener("notificationclose", (event) => {
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    all.forEach((c) => c.postMessage({ type: "dabsy-notif-close", id: data.id }));
  })());
});
