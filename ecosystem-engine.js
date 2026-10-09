/* ============================================================
   D.A.B.S.y — ecosystem-engine.js
   Double-tap DABSy -> app bubbles float out (Study Space, Ghibli
   Calendar, SolveCount, Settings). Apps are DATA — register() adds
   another one without touching this file:

       DABSy.ecosystem.register({ id, name, url, icon, hub(sheet) })

   Cross-app messaging uses a same-origin BroadcastChannel
   ("dabsy-ecosystem") + shared localStorage. That only works when the
   apps share an origin (all under username.github.io). Nothing here
   pretends otherwise: every bubble shows a real reachability dot.
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const ui = window.DABSy.ui;
  const cfg = window.DABSy.config.ecosystem;
  const apps = cfg.apps.map(a => Object.assign({}, a));

  /* ---------------- messaging ---------------- */
  let chan = null; const handlers = {};
  try{ chan = new BroadcastChannel("dabsy-ecosystem"); chan.onmessage = e => { const m = e.data || {}; (handlers[m.type] || []).forEach(fn => { try{ fn(m.data, m); }catch(err){ console.error(err); } }); (handlers["*"] || []).forEach(fn => fn(m.data, m)); }; }catch(e){}
  function post(type, data){ try{ chan && chan.postMessage({ type, data, from: "dabsy", at: Date.now() }); return !!chan; }catch(e){ return false; } }
  function on(type, fn){ (handlers[type] ||= []).push(fn); return () => { handlers[type] = handlers[type].filter(f => f !== fn); }; }

  function register(app){
    const i = apps.findIndex(a => a.id === app.id);
    if(i >= 0) apps[i] = Object.assign(apps[i], app); else apps.splice(Math.max(0, apps.length - 1), 0, app);
    bus.emit("eco:registered", { id: app.id });
  }

  /* ---------------- reachability (real fetch, cached) ---------------- */
  const reach = {};
  async function probe(app){
    if(app.builtin) return true;
    const c = reach[app.id]; if(c && Date.now() - c.at < 5 * 60000) return c.ok;
    let ok = false;
    try{
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(new URL("manifest.json", new URL(app.url, document.baseURI)).toString(), { cache: "no-store", signal: ctl.signal });
      clearTimeout(t); ok = r.ok;
    }catch(e){ ok = false; }
    reach[app.id] = { ok, at: Date.now() };
    return ok;
  }
  const urlOf = app => new URL(app.url, document.baseURI).toString();
  function openApp(app, extra){
    const u = new URL(urlOf(app)); if(extra) Object.keys(extra).forEach(k => u.searchParams.set(k, extra[k]));
    window.open(u.toString(), "_blank", "noopener");
  }

  /* ---------------- bubble overlay ---------------- */
  let root = null, isOpen = false;
  function ensureRoot(){
    if(root) return root;
    root = ui.el("div", { id: "eco", "aria-hidden": "true", role: "dialog", "aria-label": "My apps" },
      ui.el("div", { id: "eco-backdrop", onclick: close }),
      ui.el("div", { id: "eco-hint" }, "Pick an app · tap anywhere to close"));
    document.body.append(root);
    root.addEventListener("keydown", e => { if(e.key === "Escape") close(); });
    return root;
  }
  function badgeFor(app){
    if(app.id === "study"){ const n = (window.DABSy.bridge ? 0 : 0); return n; }
    return 0;
  }
  async function open(){
    if(isOpen) return; isOpen = true;
    const r = ensureRoot();
    r.querySelectorAll(".eco-bubble").forEach(n => n.remove());
    r.setAttribute("aria-hidden", "false");
    r.classList.add("open"); document.body.classList.add("eco-open");
    const face = document.getElementById("face").getBoundingClientRect();
    const cx = face.left + face.width / 2, cy = face.top + face.height / 2;
    const W = innerWidth, H = innerHeight;
    // arc around the creature; fewer apps -> wider spacing
    const n = apps.length, R = Math.min(W * .40, 150);
    const startA = -165, endA = -15;
    apps.forEach((a, i) => {
      const ang = (n === 1 ? -90 : startA + (endA - startA) * i / (n - 1)) * Math.PI / 180;
      let x = cx + Math.cos(ang) * (R + 40), y = cy + Math.sin(ang) * (R + 30) - 10;
      x = Math.max(56, Math.min(W - 56, x)); y = Math.max(96, Math.min(H - 150, y));
      const b = ui.el("button", { class: "eco-bubble", type: "button", "data-app": a.id, "aria-label": a.name, onclick: () => choose(a) },
        ui.el("span", { html: ui.icon(a.icon || "sparkle", 26) }), a.name.split(" ").length > 1 ? ui.el("span", {}, a.name) : ui.el("span", {}, a.name),
        a.builtin ? null : ui.el("i", { class: "dotst", "aria-hidden": "true" }));
      b.style.left = x + "px"; b.style.top = y + "px";
      b.style.setProperty("--fx", (cx - x) + "px"); b.style.setProperty("--fy", (cy - y) + "px"); b.style.setProperty("--d", i * 55 + "ms");
      r.append(b);
    });
    await ui.nextFrame();
    r.classList.add("show");
    r.querySelector(".eco-bubble")?.focus({ preventScroll: true });
    bus.emit("eco:opened");
    // fill in real reachability dots
    apps.filter(a => !a.builtin).forEach(a => probe(a).then(ok => {
      const d = r.querySelector(`.eco-bubble[data-app="${a.id}"] .dotst`); if(d) d.classList.toggle("on", ok);
      const b = r.querySelector(`.eco-bubble[data-app="${a.id}"]`); if(b) b.setAttribute("aria-label", a.name + (ok ? ", available" : ", not reachable from here"));
    }));
  }
  function close(){
    if(!isOpen) return; isOpen = false;
    root.classList.remove("show"); root.setAttribute("aria-hidden", "true");
    setTimeout(() => { if(!isOpen){ root.classList.remove("open"); document.body.classList.remove("eco-open"); } }, 320);
    document.getElementById("face").focus({ preventScroll: true });
    bus.emit("eco:closed");
  }
  const toggle = () => (isOpen ? close() : open());

  function choose(app){
    close();
    setTimeout(() => {
      if(app.id === "settings") return window.DABSy.require("settings").then(s => s.open()).catch(err => ui.toast({ title: "Couldn't open Settings", text: String(err.message || err) }));
      if(app.hub) return app.hub(app);
      hubFor(app);
    }, 200);
  }

  /* ---------------- hubs ---------------- */
  function hubFor(app){
    if(app.id === "study") return studyHub(app);
    if(app.id === "calendar") return calendarHub(app);
    if(app.id === "solvecount") return solveHub(app);
    return genericHub(app);
  }
  function statusRow(app, ok){
    return ui.el("div", { class: "row" }, ui.el("span", { html: ui.icon(app.icon || "sparkle", 22) }),
      ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, app.name),
        ui.el("div", { class: "s" }, ok ? "Reachable from here" : "Couldn't reach it from here. It may live on a different site or not be installed yet.")),
      ui.el("span", { class: "chip " + (ok ? "ok" : "warn") }, ok ? "Available" : "Not reachable"));
  }
  function openBtn(app, extra){ return ui.el("button", { class: "btn primary", type: "button", onclick: () => openApp(app, extra) }, "Open " + app.name); }

  async function genericHub(app){
    const sh = ui.sheet({ title: app.name });
    const ok = await probe(app);
    sh.body.append(statusRow(app, ok), openBtn(app));
  }

  async function studyHub(app){
    const sh = ui.sheet({ title: "Study Space" });
    const ok = await probe(app);
    sh.body.append(statusRow(app, ok));
    const bridge = await window.DABSy.require("bridge").catch(() => null);
    const sessions = window.DABSy.memory.read("sessions_v1", []).filter(s => s.status !== "done" && s.status !== "cancelled").slice(-5).reverse();
    sh.body.append(ui.el("div", { class: "section-title" }, "Prepared sessions"));
    if(!sessions.length) sh.body.append(ui.el("p", { class: "hint" }, "Nothing prepared yet. Tell me what you want to study (long-press me) and I'll plan it with you."));
    sessions.forEach(s => {
      const st = bridge ? bridge.status(s.id) : "none";
      sh.body.append(ui.el("div", { class: "row" }, ui.el("div", { class: "grow" },
        ui.el("div", { class: "t" }, (s.goal && (s.goal.subject || s.goal.topic)) || "Study session"),
        ui.el("div", { class: "s" }, `${s.plan ? s.plan.totalMin : "?"} min · ${st === "opened" ? "opened in Study Space" : st === "waiting" ? "waiting in Study Space's inbox" : "ready here"}`)),
        ui.el("button", { class: "btn sm primary", type: "button", onclick: () => { sh.close(); window.DABSy.require("session").then(m => m.open(s.id)); } }, "Open")));
    });
    sh.body.append(openBtn(app));
    sh.body.append(ui.el("p", { class: "hint" }, "Plans, material and tasks go to Study Space through a shared inbox. DABSy only says “opened” once Study Space confirms it."));
  }

  async function calendarHub(app){
    const Core = window.DABSyCore;
    const sh = ui.sheet({ title: "Ghibli Calendar" });
    const ok = await probe(app);
    sh.body.append(statusRow(app, ok));
    const conn = Core.getConnections().calendar;
    const sw = ui.el("input", { type: "checkbox", "aria-label": "Let DABSy use Ghibli Calendar" }); sw.checked = !!conn.enabled;
    sw.addEventListener("change", () => { Core.setConnection("calendar", { enabled: sw.checked }); sh.close(); calendarHub(app); });
    sh.body.append(ui.el("div", { class: "row" }, ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, "Connect to DABSy"), ui.el("div", { class: "s" }, "Off by default. Lets me see your events when finding free time, and add events if you allow it.")),
      ui.el("label", { class: "switch" }, sw, ui.el("i"))));
    if(conn.enabled){
      const key = Core.todayKeyOffset(0);
      const evs = Core.getEventsForDate(key).filter(e => e.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
      sh.body.append(ui.el("div", { class: "section-title" }, "Today"));
      if(!evs.length) sh.body.append(ui.el("p", { class: "hint" }, "No timed events today."));
      evs.forEach(e => sh.body.append(ui.el("div", { class: "row" }, ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, e.title), ui.el("div", { class: "s" }, e.startTime + (e.endTime ? " – " + e.endTime : ""))))));
    }
    sh.body.append(openBtn(app));
  }

  async function solveHub(app){
    const sh = ui.sheet({ title: "SolveCount" });
    const ok = await probe(app);
    sh.body.append(statusRow(app, ok));
    let sum = null; try{ sum = JSON.parse(localStorage.getItem("dabsy_eco_solvecount") || "null"); }catch(e){}
    sh.body.append(ui.el("div", { class: "section-title" }, "Progress"));
    if(sum && sum.data){
      const d = sum.data;
      [["Solved today", d.solvedToday], ["Streak", d.streak != null ? d.streak + " days" : null], ["Total", d.total]].forEach(([k, v]) => {
        if(v != null) sh.body.append(ui.el("div", { class: "row" }, ui.el("div", { class: "grow t" }, k), ui.el("div", {}, String(v))));
      });
      sh.body.append(ui.el("p", { class: "hint" }, "Last update " + ui.relTime(sum.at || Date.now())));
    } else {
      sh.body.append(ui.el("p", { class: "hint" }, "No live numbers yet. SolveCount keeps its data in its own database, so it needs the small adapter in integrations/solvecount-adapter.js to share a summary with me."));
    }
    sh.body.append(openBtn(app));
  }

  bus.on("face:doubletap", () => toggle());
  bus.on("face:tap", () => { if(isOpen) close(); });

  window.DABSy.ecosystem = { open, close, toggle, register, apps: () => apps.slice(), post, on, probe, openApp, isOpen: () => isOpen };
})();
