/* ============================================================
   D.A.B.S.y — dabsy-config.js
   Deploy-time configuration + the lazy module loader.

   This is the ONLY file you normally need to edit when you deploy:
     - ai.proxyUrl      : the URL of your deployed DABSy AI proxy
                          (see BACKEND.md). Never put an API key here.
     - ecosystem.apps   : where the other PWAs live. Paths are relative
                          to this page, so "../Ghibli-Calander/" works
                          when both apps sit side-by-side on the same
                          github.io account.

   DABSy.require("name") loads a feature module the first time it is
   needed (and returns a promise for it), so the first paint only pays
   for the creature, gestures and tasks — not the whole app.
   ============================================================ */

(function(){
  window.DABSy = window.DABSy || {};

  const CONFIG = {
    version: "8.2.0",

    ai: {
      // e.g. "https://dabsy-ai.YOUR-SUBDOMAIN.workers.dev"
      // Empty = DABSy runs in "limited mode" (everything local still works).
      proxyUrl: "",
      requestTimeoutMs: 25000,
    },

    ecosystem: {
      apps: [
        { id: "study",      name: "Study Space",     url: "../StudySpace/",      icon: "book",    handoff: "studyspace" },
        { id: "calendar",   name: "Ghibli Calendar", url: "../Ghibli-Calander/", icon: "leaf",    handoff: "core-calendar" },
        { id: "solvecount", name: "SolveCount",      url: "../SolveCount/",      icon: "count",   handoff: "summary" },
        { id: "settings",   name: "Settings",        builtin: true,              icon: "sliders" },
      ],
    },

    notifications: {
      quietFrom: "22:00",
      quietTo: "07:00",
      dailyLimit: 6,
    },
  };

  // Developer override for the proxy URL (Settings → About → tap version 7×).
  // It is a plain URL, not a secret, and is only ever read from this device.
  try {
    const dev = localStorage.getItem("dabsy_dev_proxy");
    if (dev && /^https:\/\//i.test(dev)) CONFIG.ai.proxyUrl = dev;
  } catch (e) {}

  /* ---------------- lazy module registry ---------------- */
  // name -> files (loaded in order) + optional stylesheet + dependencies.
  // Every file must assign window.DABSy[name].
  const LAZY = {
    learning:    { js: ["learning-engine.js"] },
    planner:     { js: ["planner-engine.js"], deps: ["learning"] },
    research:    { js: ["research-service.js"], deps: ["learning"] },
    cards:       { js: ["resource-cards.js"], css: ["cards.css"], deps: ["learning"] },
    bridge:      { js: ["study-space-bridge.js"] },
    session:     { js: ["study-session.js"], css: ["session.css"], deps: ["learning", "bridge"] },
    agent:       { js: ["agent-engine.js"], deps: ["planner", "research", "cards", "bridge", "session"] },
    notifcenter: { js: ["notification-center.js"], css: ["center.css"] },
    settings:    { js: ["settings-engine.js"], css: ["settings.css"], deps: ["learning", "floating"] },
    onboarding:  { js: ["onboarding-engine.js"], css: ["tour.css"] },
    easter:      { js: ["easter-engine.js"] },
    games:       { js: ["entertainment-engine.js"] },
    floating:    { js: ["floating-engine.js"] },
    vision:      { js: ["vision-engine.js"] },
  };

  const cache = {};

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "./" + src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  function loadCSS(href) {
    return new Promise((resolve) => {
      if (document.querySelector(`link[data-lazy="${href}"]`)) return resolve();
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = "./" + href;
      l.dataset.lazy = href;
      l.onload = resolve;
      l.onerror = resolve; // a missing stylesheet must never block the feature
      document.head.appendChild(l);
    });
  }

  function require(name) {
    if (window.DABSy[name] && !LAZY[name]) return Promise.resolve(window.DABSy[name]);
    if (cache[name]) return cache[name];
    const def = LAZY[name];
    if (!def) {
      if (window.DABSy[name]) return Promise.resolve(window.DABSy[name]);
      return Promise.reject(new Error("Unknown module: " + name));
    }
    cache[name] = (async () => {
      for (const dep of def.deps || []) await require(dep);
      await Promise.all((def.css || []).map(loadCSS));
      if (!window.DABSy[name]) for (const f of def.js) await loadScript(f);
      return window.DABSy[name];
    })();
    cache[name].catch(() => { delete cache[name]; });
    return cache[name];
  }

  // Warm modules during idle time so first use is instant, without
  // competing with first paint or the wake-up animation.
  function warm(names) {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    let i = 0;
    (function next() {
      if (i >= names.length) return;
      idle(() => { require(names[i++]).catch(() => {}).then(next); }, { timeout: 4000 });
    })();
  }

  window.DABSy.config = CONFIG;
  window.DABSy.require = require;
  window.DABSy.warm = warm;
  window.DABSy.loadCSS = loadCSS;
})();
