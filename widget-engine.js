/* ============================================================
   D.A.B.S.y — widget-engine.js   (v10.2: fluid liquid-glass widgets)
   An addable, removable, customisable widget system. Every widget shows REAL data only:

     clock    time + date from the device clock                          (always available)
     weather  current weather from Open-Meteo (free, no key). Needs location permission and a connection.
              Until then it shows a setup state; it never shows invented numbers.
     todos    today's tasks WITHOUT a subject, from DABSy's own task list (tick to complete)
     study    today's study tasks (tasks WITH a subject) + prepared study sessions
     next     the next upcoming task / reminder
     focus    study streak, finished study sessions, tasks done today (from DABSy's own stats)

   One of each type. Removing keeps its customisation, so it can be restored later.
   Customise: shape (rounded / pill / circle / blob / leaf), size (S / M / L), tint, drag to move.
   Double-tap: a liquid-glass bloom from the touch point + a light sheen + a gentle ripple, then the details sheet.
   Layout: widgets live in the band between the top buttons and DABSy's resting spots; they never overlap her,
   the chat dock or each other, and are hidden while chatting / studying (the keyboard never lands on them).
   Public API  DABSy.widgets: openAdd() list() add(type) remove(id) restore(type) open(id)
   ============================================================ */
(function(){
  "use strict";
  const D = window.DABSy, ui = D.ui, bus = D.bus, memory = D.memory, el = ui.el;
  const KEY = "widgets_v1", WKEY = "widgets_weather_v1";
  const layer = document.getElementById("widgets"), stage = document.getElementById("stage");
  if(!layer) return;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const GAP = 8, TOP = 64;

  /* ---------------- sizes & shapes (px at 1x; clamped to the band) ---------------- */
  const SHAPES = { round: "Rounded", pill: "Pill", circle: "Circle", blob: "Blob", leaf: "Leaf" };
  const SIZES = { s: "Small", m: "Medium", l: "Large" };
  const DIM = {
    round:  { s: [124, 96],  m: [176, 124], l: [256, 150] },
    pill:   { s: [156, 64],  m: [220, 72],  l: [304, 84] },
    circle: { s: [96, 96],   m: [132, 132], l: [176, 176] },
    blob:   { s: [128, 108], m: [176, 140], l: [244, 172] },
    leaf:   { s: [120, 108], m: [168, 136], l: [236, 168] },
  };
  const PAD = { round: .09, pill: .1, circle: .2, blob: .16, leaf: .14 };
  const TINTS = { clear: "Clear", lilac: "Lilac", mint: "Mint", peach: "Peach" };

  /* ---------------- tiny glyphs ---------------- */
  const svg = (inner, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const G = {
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
    cloud: svg('<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5 4.8 4.8 0 0 1 17.5 18H7Z"/>'),
    part: svg('<circle cx="8" cy="8" r="2.8"/><path d="M8 2.5v1M2.5 8h1M4 4l.7.7M12 4l-.7.7"/><path d="M9 19a3.5 3.5 0 0 1-.3-7A5 5 0 0 1 18 13a3.2 3.2 0 0 1 0 6H9Z"/>'),
    rain: svg('<path d="M7 14a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 4.5 4.8 4.8 0 0 1 17.5 14H7Z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>'),
    snow: svg('<path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9"/>'),
    storm: svg('<path d="M7 13a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 3.5 4.8 4.8 0 0 1 17.5 13H7Z"/><path d="m12 13-2 4h3l-2 4"/>'),
    fog: svg('<path d="M4 9h16M6 13h12M4 17h16"/>'),
    todo: svg('<path d="M5 6.5l1.6 1.6L9.5 5M5 12.5l1.6 1.6 2.9-3.1M5 18.5l1.6 1.6 2.9-3.1M13 7h6M13 13h6M13 19h6"/>'),
    book: svg('<path d="M12 6.5C10.5 5 8 4.5 4.5 4.5v13c3.5 0 6 .5 7.5 2 1.5-1.5 4-2 7.5-2v-13C16 4.5 13.5 5 12 6.5Z"/><path d="M12 6.5v13"/>'),
    next: svg('<path d="M5 12h12M13 6l6 6-6 6"/>'),
    flame: svg('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.2.8 2 1.6 2.4C10.5 8.5 11 5.5 12 3Z"/>'),
    pin: svg('<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.3"/>'),
  };
  const wxKind = c => c === 0 ? ["sun", "Clear"] : c <= 2 ? ["part", "Partly cloudy"] : c === 3 ? ["cloud", "Overcast"] : c <= 48 ? ["fog", "Fog"] : c <= 57 ? ["rain", "Drizzle"] : c <= 67 ? ["rain", "Rain"] : c <= 77 ? ["snow", "Snow"] : c <= 82 ? ["rain", "Showers"] : c <= 86 ? ["snow", "Snow showers"] : ["storm", "Thunderstorm"];

  /* ---------------- state ---------------- */
  let state = (() => { const s = memory.read(KEY, null); return s && Array.isArray(s.items) ? { items: s.items, removed: s.removed || [] } : { items: [], removed: [] }; })();
  const save = () => { memory.write(KEY, { v: 1, items: state.items, removed: state.removed }); };
  const dom = new Map();                 // id -> element
  let band = { l: GAP, t: TOP, w: 300, h: 0 }, hiddenNow = false, tickT = 0, lastTap = { t: 0, x: 0, y: 0, id: "" };

  /* ============================================================
     content renderers. Each returns HTML for a given fit {w,h,lines} and a `detail` flag
     ============================================================ */
  const fmtTime = (d, h24) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: !h24 }).replace(/\s?(am|pm)/i, m => m.toUpperCase());
  const lineCap = (fit, reserve) => Math.max(1, Math.floor((fit.h - reserve) / 22));
  const esc = ui.escapeHtml;
  const todayKey = () => ui.dateKey();
  const todayInst = () => { try{ return D.tasks.instancesForDate(todayKey()).filter(i => i.status !== "skipped" && i.status !== "cancelled"); }catch(e){ return []; } };
  const sessionsOpen = () => memory.read("sessions_v1", []).filter(s => s.status === "prepared" || s.status === "active" || s.status === "paused");
  const check = i => `<button class="wt-check${i.status === "done" ? " on" : ""}" type="button" data-act="toggle" data-task="${esc(i.taskId)}" data-key="${esc(i.dateKey)}" aria-label="${i.status === "done" ? "Mark not done: " : "Mark done: "}${esc(i.title)}" aria-pressed="${i.status === "done"}"></button>`;
  const rowHTML = (i, withTime) => `<li class="wt-row${i.status === "done" ? " done" : ""}">${check(i)}<span class="wt-t">${esc(i.title)}</span>${withTime ? `<span class="wt-sub">${esc(fmtTime(i.start))}</span>` : ""}</li>`;
  const empty = (msg, sub) => `<div class="wt-empty"><b>${esc(msg)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>`;

  const TYPES = {
    clock: {
      name: "Time & date", blurb: "The time and today's date from your phone.", icon: G.clock, needs: null,
      render(w, fit, detail){
        const d = new Date(), h24 = w.h24 === true || (w.h24 === undefined && !(Intl.DateTimeFormat().resolvedOptions().hour12));
        const t = fmtTime(d, h24), date = d.toLocaleDateString([], { weekday: fit.w < 140 ? "short" : "long", day: "numeric", month: fit.w < 140 ? "short" : "long" });
        const big = Math.round(clamp(Math.min(fit.w / (t.length * .62), fit.h * .42), 22, 56));
        return `<div class="wt-clock" style="font-size:${big}px">${esc(t)}</div><div class="wt-date">${esc(date)}</div>`;
      },
      details(w){ return `<p class="wd-line">Uses your phone's clock and time zone. Nothing is sent anywhere.</p>`; },
      options(w, patch){ return [toggleOpt("24-hour clock", w.h24 === true || (w.h24 === undefined && !Intl.DateTimeFormat().resolvedOptions().hour12), v => patch({ h24: v }))]; },
      live: true,
    },
    weather: {
      name: "Weather", blurb: "Current weather for where you are. Needs location permission and a connection.", icon: G.sun, needs: "location",
      render(w, fit){
        const c = wxCache(w), st = wxState;
        if(!w.lat){ return `<div class="wt-setup">${G.pin}<b>Set up weather</b>${fit.h > 96 ? `<span>Double-tap to allow your location</span>` : ""}</div>`; }
        if(!c){ return st === "error" ? `<div class="wt-setup">${G.cloud}<b>Can't reach the weather service</b>${fit.h > 96 ? "<span>Double-tap to retry</span>" : ""}</div>` : `<div class="wt-setup">${G.cloud}<b>Loading…</b></div>`; }
        const [k, label] = wxKind(c.code), t = tempStr(c.temp, w), big = Math.round(clamp(Math.min(fit.w / 3.4, fit.h * .46), 24, 52));
        return `<div class="wt-wx"><span class="wt-ico">${G[k]}</span><span class="wt-temp" style="font-size:${big}px">${esc(t)}</span></div><div class="wt-date">${esc(label)}${fit.h > 110 && c.hi != null ? ` · ${esc(tempStr(c.hi, w, true))}/${esc(tempStr(c.lo, w, true))}` : ""}</div>`;
      },
      details(w){
        const c = wxCache(w);
        if(!w.lat) return `<p class="wd-line">Weather needs your location (once) and an internet connection. Your coordinates, rounded to about 1 km, are sent to Open-Meteo, a free weather service, and kept only on this device. Nothing else is sent.</p><button class="btn primary" type="button" data-wact="locate">Use my location</button><div class="wd-msg" id="wd-msg"></div>`;
        if(!c) return `<p class="wd-line">${wxState === "error" ? "I couldn't reach the weather service. Check your connection." : "Loading…"}</p><button class="btn" type="button" data-wact="refresh">Try again</button>`;
        const [, label] = wxKind(c.code);
        return `<p class="wd-big">${esc(tempStr(c.temp, w))} <small>${esc(label)}</small></p><p class="wd-line">Feels like ${esc(tempStr(c.feels, w))} · wind ${Math.round(c.wind)} km/h · today ${esc(tempStr(c.hi, w, true))} / ${esc(tempStr(c.lo, w, true))}</p><p class="wd-line dim">Updated ${esc(fmtTime(new Date(c.at)))}${c.stale ? " (offline, last known)" : ""} · Open-Meteo</p><div class="wd-btns"><button class="btn sm" type="button" data-wact="refresh">Refresh</button><button class="btn sm ghost" type="button" data-wact="locate">Update my location</button><button class="btn sm ghost" type="button" data-wact="forget">Forget location</button></div><div class="wd-msg" id="wd-msg"></div>`;
      },
      options(w, patch){ return [toggleOpt("Show °F instead of °C", w.f === true, v => patch({ f: v }))]; },
      onOpen(w){ if(w.lat) weatherRefresh(w, false); },
    },
    todos: {
      name: "Today's to-dos", blurb: "Your to-dos for today from DABSy's task list. Tick to finish.", icon: G.todo, needs: null,
      render(w, fit){
        const items = todayInst().filter(i => !i.subject);
        if(!items.length) return empty("No to-dos today", fit.h > 90 ? "Tell DABSy what to remember" : "");
        const left = items.filter(i => i.status !== "done").length, cap = lineCap(fit, 34);
        const shown = items.slice().sort((a, b) => (a.status === "done") - (b.status === "done") || a.start - b.start).slice(0, cap);
        return `<div class="wt-h">${G.todo}<b>To-dos</b><span>${left} left</span></div><ul class="wt-list">${shown.map(i => rowHTML(i, fit.w > 150)).join("")}</ul>${items.length > shown.length ? `<div class="wt-more">+${items.length - shown.length} more</div>` : ""}`;
      },
      details(w){ const items = todayInst().filter(i => !i.subject); return items.length ? `<ul class="wt-list big">${items.map(i => rowHTML(i, true)).join("")}</ul>` : `<p class="wd-line">Nothing planned for today. Ask DABSy: "remind me to submit my form at 5".</p>`; },
      listens: ["tasks:changed"],
    },
    study: {
      name: "Today's study", blurb: "Today's study tasks and your prepared study sessions.", icon: G.book, needs: null,
      render(w, fit){
        const items = todayInst().filter(i => i.subject), open = sessionsOpen().length;
        if(!items.length) return empty(open ? open + " study session" + (open > 1 ? "s" : "") + " ready" : "No study planned", fit.h > 90 ? "Tell DABSy what to study" : "");
        const mins = items.filter(i => i.status !== "done").reduce((n, i) => n + (i.durationMin || 0), 0), cap = lineCap(fit, 34);
        return `<div class="wt-h">${G.book}<b>Study</b><span>${mins ? mins + " min" : "all done"}</span></div><ul class="wt-list">${items.slice(0, cap).map(i => rowHTML(i, fit.w > 150)).join("")}</ul>${items.length > cap ? `<div class="wt-more">+${items.length - cap} more</div>` : ""}`;
      },
      details(w){ const items = todayInst().filter(i => i.subject), open = sessionsOpen(); return (items.length ? `<ul class="wt-list big">${items.map(i => rowHTML(i, true) ).join("")}</ul>` : `<p class="wd-line">No study tasks today.</p>`) + (open.length ? `<p class="wd-line dim">${open.length} prepared session${open.length > 1 ? "s" : ""}: ${open.slice(-3).map(s => esc(s.goal || "Study session")).join(" · ")}</p>` : ""); },
      listens: ["tasks:changed"],
    },
    next: {
      name: "Up next", blurb: "The next task or reminder coming up.", icon: G.next, needs: null,
      render(w, fit){
        let n = null; try{ n = D.tasks.nextInstance(); }catch(e){}
        if(!n) return empty("Nothing coming up", "");
        const when = n.start.toDateString() === new Date().toDateString() ? fmtTime(n.start) : n.start.toLocaleDateString([], { weekday: "short" }) + " " + fmtTime(n.start);
        return `<div class="wt-h">${G.next}<b>Up next</b></div><div class="wt-next"><div class="wt-t2">${esc(n.title)}</div><div class="wt-date">${esc(when)}${n.durationMin ? " · " + n.durationMin + " min" : ""}</div></div>`;
      },
      details(w){ let n = null; try{ n = D.tasks.nextInstance(); }catch(e){} return n ? `<p class="wd-big">${esc(n.title)}</p><p class="wd-line">${esc(n.start.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" }))}${n.subject ? " · " + esc(n.subject) : ""}</p>` : `<p class="wd-line">No upcoming tasks or reminders.</p>`; },
      listens: ["tasks:changed"], live: true,
    },
    focus: {
      name: "Focus", blurb: "Your streak, finished study sessions and tasks done today.", icon: G.flame, needs: null,
      render(w, fit){
        const s = stats();
        return `<div class="wt-h">${G.flame}<b>Focus</b></div><div class="wt-stats"><div><b>${s.streak}</b><span>day streak</span></div>${fit.w > 120 || fit.h > 100 ? `<div><b>${s.sessions}</b><span>sessions</span></div>` : ""}${fit.h > 120 ? `<div><b>${s.today}</b><span>done today</span></div>` : ""}</div>`;
      },
      details(){ const s = stats(); return `<p class="wd-big">${s.streak} <small>day streak</small></p><p class="wd-line">${s.sessions} study session${s.sessions === 1 ? "" : "s"} finished · ${s.today} task${s.today === 1 ? "" : "s"} done today</p>`; },
      listens: ["tasks:changed", "tasks:completed"],
    },
  };
  function stats(){
    let streak = 0, sessions = 0, today = 0;
    try{ streak = memory.getPetStats().streak || 0; }catch(e){}
    try{ sessions = memory.read("sessions_v1", []).filter(s => s.status === "done").length; }catch(e){}
    try{ today = todayInst().filter(i => i.status === "done").length; }catch(e){}
    return { streak, sessions, today };
  }
  const toggleOpt = (label, on, fn) => ({ label, on, fn });

  /* ---------------- weather (real data only) ---------------- */
  let wxState = "idle";                               // idle | loading | ok | error
  const wxCache = w => { const c = memory.read(WKEY, null); return c && w.lat && c.lat === w.lat && c.lon === w.lon ? c : null; };
  const tempStr = (v, w, bare) => v == null ? "–" : Math.round(w.f ? v * 9 / 5 + 32 : v) + (bare ? "°" : "°" + (w.f ? "F" : "C"));
  async function weatherRefresh(w, force){
    if(!w.lat) return;
    const c = wxCache(w); if(!force && c && Date.now() - c.at < 20 * 60000) return;
    if(wxState === "loading") return; wxState = "loading";
    try{
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(u, { signal: ctl.signal }); clearTimeout(to);
      if(!r.ok) throw new Error("http " + r.status);
      const j = await r.json(), cu = j.current;
      memory.write(WKEY, { lat: w.lat, lon: w.lon, at: Date.now(), temp: cu.temperature_2m, feels: cu.apparent_temperature, code: cu.weather_code, wind: cu.wind_speed_10m, hi: j.daily.temperature_2m_max[0], lo: j.daily.temperature_2m_min[0] });
      wxState = "ok";
    }catch(e){
      wxState = "error";
      const old = memory.read(WKEY, null); if(old && old.lat === w.lat) { old.stale = true; memory.write(WKEY, old); wxState = "ok"; }
    }
    paintAll();
  }
  function locate(w, patch, msg){
    return new Promise(res => {
      if(!navigator.geolocation){ msg("This browser can't share a location."); return res(false); }
      msg("Asking for your location…");
      navigator.geolocation.getCurrentPosition(p => {
        patch({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) });
        wxState = "idle"; res(true);
      }, err => {
        msg(err && err.code === 1 ? "Location is blocked for this app. Allow it in your browser's site settings, then try again." : "I couldn't get your location. Try again outdoors or check that location is on.");
        res(false);
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
    });
  }

  /* ============================================================
     layout
     ============================================================ */
  const dims = w => {
    const base = (DIM[w.shape] || DIM.round)[w.size] || DIM.round.m;
    const maxW = Math.max(80, band.w), maxH = Math.max(0, band.h);
    const k = Math.min(1, maxW / base[0], maxH / base[1]);
    return [Math.round(base[0] * k), Math.round(base[1] * k)];
  };
  function measureBand(){
    const W = stage.clientWidth || innerWidth, H = stage.clientHeight || innerHeight;
    const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat")) || 0;
    let bottom;
    const world = D.world;
    if(world && world.active() && world.restTop) bottom = world.restTop();
    else {                                           // Classic: the floating eyes are the top of her; a worn hat adds height above them
      const e = document.getElementById("eye-left"), r = e && e.getBoundingClientRect();
      let hat = 0; try{ hat = D.outfits.current().acc.head ? 58 : 0; }catch(_){}
      bottom = r && r.height ? r.top - 22 - hat : H * .4;
    }
    const top = TOP + sat;
    band = { l: GAP, t: top, w: W - GAP * 2, h: Math.floor(bottom - GAP - top) };
  }
  const rectOf = w => { const [bw, bh] = dims(w); return { x: band.l + (w.x == null ? 0 : w.x) * Math.max(0, band.w - bw), y: band.t + (w.y == null ? 0 : w.y) * Math.max(0, band.h - bh), w: bw, h: bh }; };
  const hit = (a, b) => a.x < b.x + b.w + 6 && a.x + a.w + 6 > b.x && a.y < b.y + b.h + 6 && a.y + a.h + 6 > b.y;
  /* first free spot (rows, left to right), optionally starting near a wanted point; null if the band is full */
  function findFree(w, taken, want){                      // `taken` = array of rects already in use
    const [bw, bh] = dims(w); if(bh < 56 || band.h < 56) return null;
    const xs = [], ys = [];
    for(let x = band.l; x <= band.l + band.w - bw; x += 12) xs.push(x);
    for(let y = band.t; y <= band.t + band.h - bh; y += 12) ys.push(y);
    const cands = [];
    ys.forEach(y => xs.forEach(x => cands.push({ x, y })));
    if(want) cands.sort((a, b) => Math.hypot(a.x - want.x, a.y - want.y) - Math.hypot(b.x - want.x, b.y - want.y));
    for(const c of cands){ const r = { x: c.x, y: c.y, w: bw, h: bh }; if(!taken.some(t => hit(r, t))) return r; }
    return null;
  }
  const toFrac = (w, r) => { const [bw, bh] = dims(w); return { x: band.w - bw > 0 ? clamp((r.x - band.l) / (band.w - bw), 0, 1) : 0, y: band.h - bh > 0 ? clamp((r.y - band.t) / (band.h - bh), 0, 1) : 0 }; };

  function place(){
    measureBand();
    const placed = [];
    state.items.forEach(w => {
      const node = dom.get(w.id); if(!node) return;
      let r = null;
      if(w.x != null){ r = rectOf(w); if(placed.some(p => hit(r, p))) r = null; }
      if(!r) r = findFree(w, placed, null);
      if(r){ node.hidden = false; w.__r = r; placed.push(r); apply(node, w, r); }
      else { node.hidden = true; w.__r = null; }
    });
    state.items.forEach(w => { if(w.__r){ const f = toFrac(w, w.__r); if(w.x == null){ w.x = f.x; w.y = f.y; } } });
  }
  function apply(node, w, r){
    node.style.width = r.w + "px"; node.style.height = r.h + "px";
    node.style.transform = `translate3d(${Math.round(r.x)}px,${Math.round(r.y)}px,0)`;
    node.dataset.shape = w.shape; node.dataset.size = w.size; node.dataset.tint = w.tint;
    node.style.setProperty("--wt-pad", Math.round(Math.min(r.w, r.h) * (PAD[w.shape] || .1)) + "px");
    node._fit = { w: r.w, h: r.h };
  }

  /* ============================================================
     DOM
     ============================================================ */
  function build(w){
    const n = el("div", { class: "wgt", role: "group", tabindex: "0", "data-id": w.id, "data-type": w.type, "aria-label": TYPES[w.type].name + " widget. Double-tap to customise." });
    n.append(el("div", { class: "wgt-body" }));
    n.addEventListener("pointerdown", onDown);
    n.addEventListener("keydown", ev => { if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); openDetails(w.id); } });
    n.addEventListener("click", onAct);
    layer.append(n); dom.set(w.id, n);
    return n;
  }
  function paint(w){
    const n = dom.get(w.id); if(!n || !n._fit) return;
    const body = n.firstChild, T = TYPES[w.type];
    try{ body.innerHTML = T.render(w, n._fit, false); }catch(e){ body.innerHTML = empty("Couldn't show this", ""); }
  }
  function paintAll(){ state.items.forEach(paint); }

  function onAct(ev){
    const b = ev.target.closest && ev.target.closest("[data-act]"); if(!b) return;
    ev.stopPropagation();
    if(b.dataset.act === "toggle"){
      const done = b.getAttribute("aria-pressed") === "true";
      try{ if(done) D.tasks.reopen(b.dataset.task, b.dataset.key); else D.tasks.complete(b.dataset.task, b.dataset.key); }catch(e){}
    }
  }

  /* ---------------- touch: drag to move, double-tap to open ---------------- */
  let drag = null;
  function onDown(ev){
    if(ev.target.closest && ev.target.closest("[data-act]")) return;      // let the tick box be a normal button
    const n = ev.currentTarget, id = n.dataset.id, w = state.items.find(x => x.id === id); if(!w || !w.__r) return;
    drag = { id, n, w, sx: ev.clientX, sy: ev.clientY, r0: { ...w.__r }, moved: false, pid: ev.pointerId };
    n.addEventListener("pointermove", onMove); n.addEventListener("pointerup", onUp); n.addEventListener("pointercancel", onCancel);
  }
  function onMove(ev){
    if(!drag || ev.pointerId !== drag.pid) return;
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if(!drag.moved && Math.hypot(dx, dy) < 9) return;
    if(!drag.moved){ drag.moved = true; drag.n.classList.add("dragging"); try{ drag.n.setPointerCapture(ev.pointerId); }catch(e){} }
    const x = clamp(drag.r0.x + dx, band.l, band.l + band.w - drag.r0.w), y = clamp(drag.r0.y + dy, band.t, Math.max(band.t, band.t + band.h - drag.r0.h));
    drag.cur = { x, y, w: drag.r0.w, h: drag.r0.h };
    drag.n.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  }
  function endDrag(){ if(!drag) return; drag.n.removeEventListener("pointermove", onMove); drag.n.removeEventListener("pointerup", onUp); drag.n.removeEventListener("pointercancel", onCancel); drag.n.classList.remove("dragging"); }
  function onCancel(){ if(drag){ apply(drag.n, drag.w, drag.w.__r); } endDrag(); drag = null; }
  function onUp(ev){
    const d = drag; if(!d || ev.pointerId !== d.pid) return;
    endDrag(); drag = null;
    if(d.moved){
      // drop: if it overlaps another widget, take the nearest free spot; if there is none, spring back
      const others = state.items.filter(o => o !== d.w && o.__r).map(o => o.__r), want = d.cur;
      let r = want;
      if(others.some(o => hit(want, o))) r = findFree(d.w, others, want);
      if(!r) r = d.r0;
      d.w.__r = r; const f = toFrac(d.w, r); d.w.x = f.x; d.w.y = f.y; save(); apply(d.n, d.w, r);
      return;
    }
    // a tap: double-tap opens (guarded so a third tap can never start a second action)
    const now = performance.now(), isDbl = lastTap.id === d.id && now - lastTap.t < 340 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 42;
    if(isDbl && !d.n._busy){ lastTap = { t: 0, x: 0, y: 0, id: "" }; doubleTap(d.n, d.w, ev); }
    else lastTap = { t: now, x: ev.clientX, y: ev.clientY, id: d.id };
  }

  /* ---------------- the liquid-glass double-tap ---------------- */
  function doubleTap(n, w, ev){
    n._busy = true; ui.vibrate(12);
    const reduce = ui.reducedMotion(), lite = document.body.classList.contains("lite-gfx");
    const r = n.getBoundingClientRect();
    if(reduce){ n.classList.add("wgt-pulse"); setTimeout(() => { n.classList.remove("wgt-pulse"); n._busy = false; openDetails(w.id); }, 160); return; }
    const x = clamp(ev.clientX - r.left, 0, r.width), y = clamp(ev.clientY - r.top, 0, r.height);
    const glow = el("i", { class: "wgt-glow", "aria-hidden": "true" }); glow.style.left = x + "px"; glow.style.top = y + "px"; glow.style.setProperty("--s", (Math.max(r.width, r.height) * 1.5 / 40).toFixed(2));
    const sheen = el("i", { class: "wgt-sheen", "aria-hidden": "true" });
    n.append(glow); if(!lite) n.append(sheen);
    n.classList.add("wgt-ripple");
    setTimeout(() => { glow.remove(); sheen.remove(); n.classList.remove("wgt-ripple"); }, 760);
    setTimeout(() => { n._busy = false; openDetails(w.id); }, 430);        // the expected action: the details / customise sheet
  }

  /* ============================================================
     add / remove / restore
     ============================================================ */
  const uid = () => "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
  const has = type => state.items.some(w => w.type === type);
  function add(type){
    if(!TYPES[type]) return { ok: false, why: "unknown" };
    if(has(type)) return { ok: false, why: "dup" };
    const kept = state.removed.find(w => w.type === type);
    const w = kept ? Object.assign({}, kept) : { id: uid(), type, shape: type === "clock" ? "pill" : type === "focus" ? "circle" : "round", size: type === "clock" ? "m" : "s", tint: "clear", x: null, y: null };
    if(kept) state.removed = state.removed.filter(x => x !== kept);
    measureBand();
    const taken = state.items.filter(o => o.__r).map(o => o.__r);
    let r = null, shrunk = false;
    for(const sz of [w.size, "m", "s"].filter((v, i, a) => a.indexOf(v) === i && (v === w.size || (DIM.round[v] && ["l", "m", "s"].indexOf(v) > ["l", "m", "s"].indexOf(w.size))))){
      r = findFree(Object.assign({}, w, { x: null, size: sz }), taken, null);
      if(r){ if(sz !== w.size){ w.size = sz; shrunk = true; } break; }
    }
    if(!r){ if(kept) state.removed.push(kept); return { ok: false, why: "room" }; }
    w.x = null; w.y = null; state.items.push(w); build(w); save(); place(); paint(w);
    const n = dom.get(w.id); if(n){ n.classList.add("wgt-in"); setTimeout(() => n.classList.remove("wgt-in"), 700); }
    if(TYPES[type].onOpen) TYPES[type].onOpen(w);
    syncTick(); bus.emit("widgets:changed");
    return { ok: true, id: w.id, restored: !!kept, shrunk };
  }
  function remove(id){
    const w = state.items.find(x => x.id === id); if(!w) return false;
    state.items = state.items.filter(x => x !== w); delete w.__r;
    state.removed = state.removed.filter(x => x.type !== w.type).concat([w]);
    const n = dom.get(id); if(n){ n.classList.add("wgt-out"); setTimeout(() => n.remove(), 260); dom.delete(id); }
    save(); setTimeout(place, 280); syncTick(); bus.emit("widgets:changed"); return true;
  }
  function patch(id, p){
    const w = state.items.find(x => x.id === id); if(!w) return;
    Object.assign(w, p);
    if("shape" in p || "size" in p){ w.x = w.x; }           // keep the fractional position; place() re-fits it
    save(); place(); paint(w); const n = dom.get(id); if(n) n.classList.add("wgt-morph"), setTimeout(() => n.classList.remove("wgt-morph"), 520);
  }

  /* ============================================================
     sheets
     ============================================================ */
  function glyphShape(k){ const r = { round: 'rx="7"', pill: 'rx="9" height="12" y="6"', circle: 'rx="12" width="20" height="20" x="2" y="2"', blob: "", leaf: "" };
    if(k === "blob") return `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 3c5 0 9 3 9 8s-3 10-9 10S3 17 3 12 7 3 12 3Z" fill="currentColor" opacity=".85"/></svg>`;
    if(k === "leaf") return `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 12C4 7 8 4 12 4h8v8c0 5-4 8-8 8H4Z" fill="currentColor" opacity=".85"/></svg>`;
    return `<svg viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="${k === "pill" ? 7 : 3}" width="18" height="${k === "pill" ? 10 : 18}" ${r[k]} fill="currentColor" opacity=".85"/></svg>`; }
  function chips(label, map, cur, on, glyph){
    const wrap = el("div", { class: "wd-chips", role: "radiogroup", "aria-label": label });
    Object.entries(map).forEach(([k, t]) => wrap.append(el("button", { type: "button", role: "radio", class: "wd-chip" + (k === cur ? " on" : ""), "aria-checked": String(k === cur), "aria-label": t, "data-k": k,
      onclick: () => { [...wrap.children].forEach(c => { const o = c.dataset.k === k; c.classList.toggle("on", o); c.setAttribute("aria-checked", String(o)); }); on(k); } },
      glyph ? el("span", { class: "wd-glyph", html: glyph(k) }) : null, el("span", {}, t))));
    return wrap;
  }
  function openDetails(id){
    const w = state.items.find(x => x.id === id); if(!w) return;
    const T = TYPES[w.type];
    document.body.classList.add("wgt-editing");
    const sh = ui.sheet({ title: T.name, className: "wgt-sheet", onClose: () => { document.body.classList.remove("wgt-editing"); offs.forEach(f => f()); } });
    const offs = [];
    const live = el("div", { class: "wd-live" });
    const paintLive = () => { live.innerHTML = T.details(w); };
    paintLive(); (T.listens || []).forEach(e => offs.push(bus.on(e, paintLive)));
    live.addEventListener("click", async ev => {
      const b = ev.target.closest("[data-wact]"); if(!b) return;
      const msg = t => { const m = live.querySelector("#wd-msg"); if(m) m.textContent = t; };
      if(b.dataset.wact === "locate"){ const ok = await locate(w, p => patch(id, p), msg); if(ok){ await weatherRefresh(w, true); paintLive(); } }
      if(b.dataset.wact === "refresh"){ msg("Refreshing…"); await weatherRefresh(w, true); paintLive(); }
      if(b.dataset.wact === "forget"){ patch(id, { lat: null, lon: null }); memory.remove ? memory.remove(WKEY) : memory.write(WKEY, null); paintLive(); }
    });
    live.addEventListener("click", ev => { const b = ev.target.closest("[data-act]"); if(b){ onAct(ev); setTimeout(paintLive, 60); } });
    const opts = el("div", { class: "wd-opts" },
      el("div", { class: "section-title" }, "Shape"), chips("Shape", SHAPES, w.shape, k => patch(id, { shape: k }), glyphShape),
      el("div", { class: "section-title" }, "Size"), chips("Size", SIZES, w.size, k => patch(id, { size: k })),
      el("div", { class: "section-title" }, "Tint"), chips("Tint", TINTS, w.tint, k => patch(id, { tint: k })));
    (T.options ? T.options(w, p => patch(id, p)) : []).forEach(o => {
      const input = el("input", { type: "checkbox", "aria-label": o.label }); input.checked = !!o.on; input.addEventListener("change", () => o.fn(input.checked));
      opts.append(el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, o.label)), el("label", { class: "switch" }, input, el("i"))));
    });
    sh.body.append(live, opts, el("p", { class: "hint" }, "Drag a widget to move it. It stays above DABSy and out of the way of the chat."),
      el("div", { class: "popup-actions", style: "justify-content:space-between" },
        el("button", { class: "btn sm danger", type: "button", onclick: () => { remove(id); sh.close(); ui.toast({ text: T.name + " removed. Add it again from Settings → Widgets and it comes back as you left it." }); } }, "Remove"),
        el("button", { class: "btn sm primary", type: "button", onclick: () => sh.close() }, "Done")));
    if(T.onOpen) T.onOpen(w);
    return sh;
  }
  function openAdd(){
    document.body.classList.add("wgt-editing");
    const sh = ui.sheet({ title: "Widgets", className: "wgt-sheet", onClose: () => document.body.classList.remove("wgt-editing") });
    const list = el("div", { class: "wd-add" });
    const paintList = () => {
      list.innerHTML = "";
      Object.entries(TYPES).forEach(([type, T]) => {
        const on = has(type), kept = state.removed.some(x => x.type === type);
        const btn = el("button", { class: "btn sm" + (on ? " ghost" : " primary"), type: "button",
          onclick: () => {
            if(on){ const w = state.items.find(x => x.type === type); remove(w.id); ui.toast({ text: T.name + " removed." }); }
            else {
              const r = add(type);
              if(!r.ok) ui.toast({ text: r.why === "room" ? "No room above DABSy on this screen. Remove or shrink a widget first." : "Already added." });
              else ui.toast({ text: T.name + (r.restored ? " restored." : " added.") });
            }
            paintList();
          } }, on ? "Remove" : kept ? "Restore" : "Add");
        list.append(el("div", { class: "row wd-add-row" }, el("span", { class: "wd-add-ico", html: T.icon }), el("div", { class: "grow" }, el("div", { class: "t" }, T.name), el("div", { class: "s" }, T.blurb + (kept && !on ? " Your earlier look is kept." : ""))), btn));
      });
    };
    paintList();
    sh.body.append(list, el("div", { class: "popup-actions", style: "justify-content:flex-end" }, el("button", { class: "btn sm primary", type: "button", onclick: () => sh.close() }, "Done")));
    return sh;
  }

  /* ============================================================
     visibility, ticking, layout triggers
     ============================================================ */
  const HIDE = ["cmd-open", "kb-open", "study-active", "session-active", "live-talk", "eco-open", "booting", "mw-loading"];
  function syncVisible(){
    const c = document.body.classList;
    const hide = HIDE.some(k => c.contains(k)) || (c.contains("sheet-open") && !c.contains("wgt-editing"));
    if(hide === hiddenNow) return;
    hiddenNow = hide; layer.classList.toggle("off", hide);
    if(!hide){ place(); paintAll(); weatherMaybe(); }
    syncTick();
  }
  function weatherMaybe(){ const w = state.items.find(x => x.type === "weather"); if(w && w.lat) weatherRefresh(w, false); }
  function syncTick(){
    clearTimeout(tickT); tickT = 0;
    const need = !hiddenNow && !document.hidden && state.items.some(w => TYPES[w.type].live);
    if(!need) return;
    const next = 60000 - (Date.now() % 60000) + 150;
    tickT = setTimeout(() => { state.items.forEach(w => { if(TYPES[w.type].live) paint(w); }); syncTick(); }, next);
  }
  let raf = 0; const relayout = () => { if(raf) return; raf = requestAnimationFrame(() => { raf = 0; if(!hiddenNow){ place(); paintAll(); } }); };
  const obs = new MutationObserver(() => { clearTimeout(obs._t); obs._t = setTimeout(syncVisible, 40); });
  obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", relayout, { passive: true });
  document.addEventListener("dabsy:kbsettled", relayout);
  ["world:habitat", "world:prefs", "outfit:form", "outfit:changed", "settings:changed"].forEach(e => bus.on(e, () => setTimeout(relayout, 60)));
  bus.on("tasks:changed", () => { if(!hiddenNow) state.items.forEach(w => { const T = TYPES[w.type]; if(T.listens && T.listens.includes("tasks:changed")) paint(w); }); });
  bus.on("tasks:completed", () => { if(!hiddenNow) paintAll(); });
  bus.on("memory:wiped", () => { state = { items: [], removed: [] }; dom.forEach(n => n.remove()); dom.clear(); });
  document.addEventListener("visibilitychange", () => { if(!document.hidden){ if(!hiddenNow){ paintAll(); weatherMaybe(); } } syncTick(); });

  /* ---------------- boot ---------------- */
  function init(){
    state.items.forEach(w => { if(!TYPES[w.type]){ return; } if(!DIM[w.shape]) w.shape = "round"; if(!DIM.round[w.size]) w.size = "s"; if(!TINTS[w.tint]) w.tint = "clear"; build(w); });
    state.items = state.items.filter(w => dom.has(w.id));
    place(); paintAll(); syncVisible(); syncTick(); weatherMaybe();
    // positions depend on DABSy's layout, which settles a moment after load
    setTimeout(relayout, 700); setTimeout(relayout, 2200);
  }
  /* the always-visible entry point (top left, next to Day/Night) */
  const wbtn = document.getElementById("widgets-btn");
  if(wbtn){
    wbtn.innerHTML = svg('<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2.4"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="2.4"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2.4"/><path d="M16.75 14v6M13.75 17h6"/>', 22);
    wbtn.addEventListener("click", () => { try{ ui.vibrate(8); }catch(e){} openAdd(); });
  }
  /* upgrade/first run: if the user has never had widgets, put the clock on screen once so the feature is visible */
  function seedOnce(){
    if(memory.read("widgets_seeded_v1", false) || state.items.length || state.removed.length) return;
    memory.write("widgets_seeded_v1", true);
    const r = add("clock"); if(r.ok) setTimeout(() => ui.toast({ text: "I added a clock widget. Tap the widgets button (top left) to add more, or double-tap a widget to customise it." , timeout: 7000 }), 1500);
  }
  D.widgets = { openAdd, open: openDetails, add, remove, restore: add, list: () => state.items.map(w => ({ id: w.id, type: w.type, shape: w.shape, size: w.size, tint: w.tint, rect: w.__r && { ...w.__r } })), removed: () => state.removed.map(w => w.type), band: () => ({ ...band }), _state: () => state };
  init();
  setTimeout(seedOnce, 2600);
})();
