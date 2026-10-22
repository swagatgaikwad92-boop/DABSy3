/* ============================================================
   D.A.B.S.y — widget-engine.js   (v11.1: classic floating glass widgets, with optional customisation)
   DABSy.widgets = { edit(), done(), isEditing(), add(id), remove(id), list(), available(), enable(bool), enabled(), refresh() }

   Widgets (all show REAL data; none is ever invented):
     clock     local time
     date      local weekday + date
     tasks     today's tasks from DABSy.tasks (+ how many still need a time)
     weather   Open-Meteo (free, no key) for the coordinates you allow; shows "unavailable" when it can't be reached
     calendar  Ghibli Calendar events when connected; otherwise a "Connect" prompt (no fake events)

   Behaviour
     - They float around DABSy in the upper part of the screen (never over her face) and appear one by one after she wakes.
     - They hide while you chat / type, open a panel, study (Study Mode stays distraction-free) or talk live.
     - Customise: press and hold any widget (or Settings → Widgets, or say "customise widgets") -> drag to another slot,
       ✕ to remove, tap a name in the bar to add one back. Resizing is deliberately not offered.
     - Arrangement persists in localStorage via memory ("widgets_v1"). Location (weather) stays on this device.
   ============================================================ */
(function(){
  "use strict";
  const D = window.DABSy, bus = D.bus, ui = D.ui, memory = D.memory, el = ui.el;
  const KEY = "widgets_v1", WKEY = "weather_cache_v1";
  const stage = document.getElementById("stage");
  const SLOTS = 6;                                          // 0..3 upper rows (always), 4..5 third row (only when the screen is tall enough)
  const DEFS = {
    clock:    { name: "Clock",    ico: "🕐" },
    date:     { name: "Date",     ico: "📅" },
    tasks:    { name: "Tasks",    ico: "✅" },
    weather:  { name: "Weather",  ico: "⛅" },
    calendar: { name: "Calendar", ico: "🗓️" },
  };
  const ORDER = ["clock", "date", "tasks", "weather", "calendar"];
  const connected = () => { try{ const c = window.DABSyCore && window.DABSyCore.getConnections().calendar; return !!(c && c.enabled); }catch(e){ return false; } };

  /* ---------------- persisted state ---------------- */
  let st = memory.read(KEY, null);
  function defaults(){
    const items = [{ id: "clock", slot: 0 }, { id: "date", slot: 1 }, { id: "tasks", slot: 2 }, { id: "weather", slot: 3 }];
    if(connected()) items.push({ id: "calendar", slot: 4 });
    return { on: true, items };
  }
  if(!st || !Array.isArray(st.items)) st = defaults();
  st.items = st.items.filter(i => DEFS[i.id] && Number.isInteger(i.slot) && i.slot >= 0 && i.slot < SLOTS);
  const save = () => { try{ memory.write(KEY, st); }catch(e){} };

  /* ---------------- DOM ---------------- */
  const root = el("div", { id: "widgets", "aria-label": "Widgets", role: "group" });
  const slotEls = [];
  for(let i = 0; i < SLOTS; i++){ const s = el("div", { class: "wg-slot s" + i + (i >= 4 ? " r2" : ""), "data-slot": String(i) }); slotEls.push(s); root.append(s); }
  const bar = el("div", { id: "wg-bar", hidden: "", role: "toolbar", "aria-label": "Customise widgets" });
  stage.append(root, bar);
  const cards = {};                                          // id -> { card, body }
  let editing = false, introduced = false;
  const tall = () => window.matchMedia("(min-height: 720px)").matches;
  const allowed = slot => slot < 4 || tall();

  /* the slot a widget is actually shown in (a saved third-row slot falls back to a free upper one on short screens; never persisted) */
  function effectiveSlots(){
    const used = new Set(), out = {};
    st.items.forEach(i => { if(allowed(i.slot) && !used.has(i.slot)){ out[i.id] = i.slot; used.add(i.slot); } });
    st.items.forEach(i => { if(out[i.id] != null) return; for(let s = 0; s < SLOTS; s++){ if(allowed(s) && !used.has(s)){ out[i.id] = s; used.add(s); break; } } });
    return out;
  }

  /* ---------------- renderers (pure: they read real data) ---------------- */
  const t12 = d => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const clean = s => String(s || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  function dk(d){ return ui.dateKey(d); }
  const R = {
    clock(b){ const n = new Date(); const p = n.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?(am|pm)$/i, m => "\u0000" + m.trim()); const [t, ap] = p.split("\u0000"); b.textContent = ""; b.append(el("div", { class: "wg-big" }, t, ap ? el("small", { text: ap.toUpperCase() }) : null)); },
    date(b){ const n = new Date(); b.textContent = ""; b.append(el("div", { class: "wg-mid", text: n.toLocaleDateString([], { weekday: "long" }) }), el("div", { class: "wg-sub", text: n.toLocaleDateString([], { day: "numeric", month: "long" }) })); },
    tasks(b){
      const now = new Date(), inst = D.tasks.instancesForDate(dk(now)).filter(i => i.status === "pending" || i.status === "active");
      const un = D.tasks.unscheduled().length; b.textContent = "";
      b.append(el("div", { class: "wg-head", text: inst.length ? `${inst.length} left today` : un ? "Today" : "All clear" }));
      inst.slice(0, 3).forEach(i => b.append(el("div", { class: "wg-line" + (i.end < now ? " late" : "") }, el("span", { class: "wg-t", text: t12(i.start) }), el("span", { class: "wg-x", text: clean(i.title) }))));
      if(inst.length > 3) b.append(el("div", { class: "wg-sub", text: `+${inst.length - 3} more` }));
      if(un) b.append(el("div", { class: "wg-sub", text: `${un} need${un === 1 ? "s" : ""} a time` }));
      if(!inst.length && !un) b.append(el("div", { class: "wg-sub", text: "Nothing planned" }));
    },
    calendar(b){
      b.textContent = "";
      if(!connected()){ b.append(el("div", { class: "wg-head", text: "Calendar" }), el("div", { class: "wg-sub", text: "Tap to connect Ghibli Calendar" })); return; }
      const C = window.DABSyCore, now = new Date(), today = dk(now);
      let ev = []; try{ ev = C.getEventsForDate(today).slice().sort((a, c) => String(a.startTime || "").localeCompare(String(c.startTime || ""))); }catch(e){}
      b.append(el("div", { class: "wg-head", text: ev.length ? "Today" : "Calendar" }));
      if(ev.length){ ev.slice(0, 3).forEach(e => b.append(el("div", { class: "wg-line" }, el("span", { class: "wg-t", text: e.startTime || "all day" }), el("span", { class: "wg-x", text: clean(e.title) })))); if(ev.length > 3) b.append(el("div", { class: "wg-sub", text: `+${ev.length - 3} more` })); return; }
      let next = null; try{ next = C.getCalendarEvents().filter(e => e.date > today).sort((a, c) => (a.date + (a.startTime || "")).localeCompare(c.date + (c.startTime || "")))[0]; }catch(e){}
      b.append(el("div", { class: "wg-sub", text: next ? `Next: ${clean(next.title)}, ${ui.dayLabel(new Date(next.date + "T00:00:00")).toLowerCase()}` : "No events today" }));
    },
    weather(b){
      b.textContent = "";
      const w = weather;
      if(w.state === "noloc"){ b.append(el("div", { class: "wg-head", text: "Weather" }), el("div", { class: "wg-sub", text: "Tap to use my location" })); return; }
      if(w.state === "loading" && !w.data){ b.append(el("div", { class: "wg-head", text: "Weather" }), el("div", { class: "wg-sub", text: "Checking the sky…" })); return; }
      if(w.state === "denied"){ b.append(el("div", { class: "wg-head", text: "Weather" }), el("div", { class: "wg-sub", text: "Location is blocked. Allow it in the browser's site settings, then tap." })); return; }
      if(!w.data){ b.append(el("div", { class: "wg-head", text: "Weather" }), el("div", { class: "wg-sub", text: "Unavailable right now" })); return; }
      const d = w.data, info = wxInfo(d.code, d.isDay);
      b.append(el("div", { class: "wg-wx" }, el("span", { class: "wg-ic", html: info.svg }), el("div", {}, el("div", { class: "wg-big", text: Math.round(d.temp) + "°" }), el("div", { class: "wg-sub", text: info.label }))));
      if(d.max != null) b.append(el("div", { class: "wg-sub", text: `H ${Math.round(d.max)}° · L ${Math.round(d.min)}°${w.stale ? " · offline" : ""}` }));
    },
  };

  /* ---------------- weather (real data only) ---------------- */
  const weather = { state: "noloc", data: null, stale: false, at: 0 };
  function wxInfo(code, isDay){
    const sun = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>';
    const moon = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>';
    const cloud = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5h9.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 18.5Z"/></svg>';
    const rain = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h9.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 15Z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/></svg>';
    const snow = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/></svg>';
    const bolt = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14.5h-.2A3.8 3.8 0 0 1 7 7a5.5 5.5 0 0 1 10.4 1.5A3.5 3.5 0 0 1 17 14.5"/><path d="M12.5 11l-2.5 4h3.5L11.5 20"/></svg>';
    const fog = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 9h16M3 13h18M5 17h14"/></svg>';
    if(code === 0) return { label: isDay ? "Clear" : "Clear night", svg: isDay ? sun : moon };
    if(code <= 2) return { label: "Partly cloudy", svg: isDay ? sun : moon };
    if(code === 3) return { label: "Cloudy", svg: cloud };
    if(code === 45 || code === 48) return { label: "Foggy", svg: fog };
    if(code >= 51 && code <= 57) return { label: "Drizzle", svg: rain };
    if(code >= 61 && code <= 67) return { label: "Rain", svg: rain };
    if(code >= 71 && code <= 77 || code === 85 || code === 86) return { label: "Snow", svg: snow };
    if(code >= 80 && code <= 82) return { label: "Showers", svg: rain };
    if(code >= 95) return { label: "Thunderstorm", svg: bolt };
    return { label: "Weather", svg: cloud };
  }
  const loc = () => (st.loc && isFinite(st.loc.lat) && isFinite(st.loc.lon)) ? st.loc : null;
  async function fetchWeather(force){
    const l = loc(); if(!l){ weather.state = "noloc"; return; }
    const cached = memory.read(WKEY, null);
    if(cached && cached.data && !weather.data) { weather.data = cached.data; weather.at = cached.at; }
    if(!force && weather.data && Date.now() - weather.at < 30 * 60000){ weather.state = "ok"; return; }
    if(!navigator.onLine){ weather.stale = !!weather.data; weather.state = weather.data ? "ok" : "fail"; return; }
    weather.state = "loading";
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
    try{
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
      const r = await fetch(u, { signal: ctl.signal }); if(!r.ok) throw new Error("http " + r.status);
      const j = await r.json(), c = j.current;
      if(!c || typeof c.temperature_2m !== "number") throw new Error("bad data");
      weather.data = { temp: c.temperature_2m, code: c.weather_code, isDay: c.is_day === 1, max: j.daily && j.daily.temperature_2m_max ? j.daily.temperature_2m_max[0] : null, min: j.daily && j.daily.temperature_2m_min ? j.daily.temperature_2m_min[0] : null };
      weather.at = Date.now(); weather.stale = false; weather.state = "ok"; memory.write(WKEY, { data: weather.data, at: weather.at });
    }catch(e){ weather.stale = !!weather.data; weather.state = weather.data ? "ok" : "fail"; }
    finally{ clearTimeout(t); }
  }
  function askLocation(){
    if(!navigator.geolocation){ weather.state = "fail"; paint("weather"); return; }
    weather.state = "loading"; paint("weather");
    navigator.geolocation.getCurrentPosition(async pos => {
      st.loc = { lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) }; save();      // 2 decimals (~1 km): enough for weather, kept on this device
      await fetchWeather(true); paint("weather");
    }, err => { weather.state = err && err.code === 1 ? "denied" : "fail"; paint("weather"); }, { timeout: 10000, maximumAge: 600000 });
  }

  /* ---------------- build / paint ---------------- */
  function ensureCard(id){
    if(cards[id]) return cards[id];
    const body = el("div", { class: "wg-body" });
    const x = el("button", { type: "button", class: "wg-x-btn", "aria-label": "Remove " + DEFS[id].name + " widget", text: "✕", onclick: ev => { ev.stopPropagation(); remove(id); } });
    const card = el("div", { class: "wg-card wg-" + id, "data-id": id, tabindex: "-1" }, x, body);
    card.addEventListener("click", () => onTap(id));
    wireDrag(card, id);
    cards[id] = { card, body };
    return cards[id];
  }
  function paint(id){
    const c = cards[id]; if(!c) return;
    try{ R[id](c.body); }catch(e){ c.body.textContent = ""; c.body.append(el("div", { class: "wg-sub", text: "Unavailable" })); }
  }
  function onTap(id){
    if(editing || dragMoved) return;
    if(id === "tasks") D.require("notifcenter").then(c => c.openTasks()).catch(() => {});
    else if(id === "weather"){ if(!loc() || weather.state === "denied" || weather.state === "fail") askLocation(); else fetchWeather(true).then(() => paint("weather")); }
    else if(id === "calendar"){ if(!connected()) D.ecosystem && D.ecosystem.open(); }
  }
  function layout(first){
    const eff = effectiveSlots(), ids = new Set(st.items.map(i => i.id));
    Object.keys(cards).forEach(id => { if(!ids.has(id)){ cards[id].card.remove(); delete cards[id]; } });
    st.items.forEach(i => {
      const c = ensureCard(i.id), slot = slotEls[eff[i.id]]; if(!slot) return;
      if(c.card.parentNode !== slot) slot.append(c.card);
      paint(i.id);
    });
    root.dataset.count = String(st.items.length);
    if(introduced) Object.keys(cards).forEach(id => cards[id].card.classList.add("in"));
    if(editing) paintBar();
  }
  function refresh(){ if(!st.on) return; Object.keys(cards).forEach(paint); }

  /* ---------------- gradual introduction ---------------- */
  function introduce(){
    if(introduced || !st.on) return; introduced = true;
    const ids = st.items.map(i => i.id), reduce = ui.reducedMotion();
    ids.forEach((id, n) => setTimeout(() => { const c = cards[id]; if(c) c.card.classList.add("in"); }, reduce ? 0 : 500 + n * 650));
  }

  /* ---------------- customise mode ---------------- */
  function paintBar(){
    bar.textContent = "";
    const hidden = ORDER.filter(id => !st.items.some(i => i.id === id));
    bar.append(el("div", { class: "wg-bar-t", text: "Drag to rearrange" }));
    const row = el("div", { class: "wg-bar-row" });
    hidden.forEach(id => row.append(el("button", { type: "button", class: "wg-chip", "aria-label": "Add " + DEFS[id].name + " widget", onclick: () => add(id) }, "＋ " + DEFS[id].name)));
    if(!hidden.length) row.append(el("span", { class: "wg-bar-s", text: "All widgets are on screen" }));
    bar.append(row, el("button", { type: "button", class: "wg-done", text: "Done", onclick: done }));
  }
  function edit(){
    if(!st.on){ st.on = true; save(); applyOn(); }
    if(editing) return; editing = true;
    root.classList.add("editing"); document.body.classList.add("wg-editing");
    bar.hidden = false; introduced = true; Object.keys(cards).forEach(id => cards[id].card.classList.add("in")); paintBar();
    ui.vibrate(12); ui.announce("Widget customisation on. Drag a widget to move it, or use the buttons below.");
  }
  function done(){
    if(!editing) return; editing = false;
    root.classList.remove("editing"); document.body.classList.remove("wg-editing"); bar.hidden = true; save();
    ui.announce("Widgets saved.");
  }
  function add(id){
    if(!DEFS[id] || st.items.some(i => i.id === id)) return false;
    const used = new Set(effectiveSlots() && Object.values(effectiveSlots())); let slot = -1;
    for(let s = 0; s < SLOTS; s++){ if(allowed(s) && !used.has(s)){ slot = s; break; } }
    if(slot < 0){ ui.toast && ui.toast({ text: "There's no free spot. Remove a widget first." }); return false; }
    st.items.push({ id, slot }); save(); layout(); if(id === "weather" && !loc()) { /* wait for the user's tap: no surprise permission prompt */ }
    if(introduced) setTimeout(() => cards[id] && cards[id].card.classList.add("in"), 30);
    return true;
  }
  function remove(id){
    const i = st.items.findIndex(x => x.id === id); if(i < 0) return false;
    st.items.splice(i, 1); save(); layout(); return true;
  }

  /* drag a card to another slot (swap if occupied); long-press anywhere on a card enters customise mode */
  let dragMoved = false;
  function wireDrag(card, id){
    let sx = 0, sy = 0, down = false, dragging = false, pressT = 0, pid = null;
    card.addEventListener("pointerdown", e => {
      if(e.target.closest(".wg-x-btn")) return;
      down = true; dragging = false; dragMoved = false; sx = e.clientX; sy = e.clientY; pid = e.pointerId;
      clearTimeout(pressT);
      if(!editing) pressT = setTimeout(() => { if(down && !dragging){ edit(); dragMoved = true; } }, 650);
    });
    card.addEventListener("pointermove", e => {
      if(!down || e.pointerId !== pid) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if(!editing){ if(Math.hypot(dx, dy) > 10) clearTimeout(pressT); return; }
      if(!dragging && Math.hypot(dx, dy) > 6){ dragging = true; dragMoved = true; try{ card.setPointerCapture(pid); }catch(_){} card.classList.add("dragging"); }
      if(dragging){ card.style.transform = `translate3d(${dx}px,${dy}px,0) scale(1.04)`; e.preventDefault(); }
    }, { passive: false });
    const end = e => {
      if(e && e.pointerId !== pid) return;
      clearTimeout(pressT);
      if(down && dragging){
        const r = card.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let best = -1, bd = 1e9;
        slotEls.forEach((s, n) => { if(!allowed(n)) return; const q = s.getBoundingClientRect(), d = Math.hypot(cx - (q.left + q.width / 2), cy - (q.top + q.height / 2)); if(d < bd){ bd = d; best = n; } });
        const eff = effectiveSlots(), from = eff[id];
        if(best >= 0 && best !== from){
          const other = st.items.find(i => eff[i.id] === best), me = st.items.find(i => i.id === id);
          if(other) other.slot = from; me.slot = best;
          // positions that were only "effective" (short screen) become real now, so a saved layout never has two widgets in one slot
          st.items.forEach(i => { if(i !== me && i !== other) i.slot = eff[i.id]; });
          save();
        }
        card.classList.remove("dragging"); card.style.transform = "";
        layout();
      }
      down = false; dragging = false; pid = null;
      setTimeout(() => { dragMoved = false; }, 60);
    };
    card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
    card.addEventListener("contextmenu", e => e.preventDefault());
  }

  /* ---------------- on/off + lifecycle ---------------- */
  function applyOn(){ root.hidden = !st.on; if(st.on){ layout(); if(introduced) refresh(); else if(!document.body.classList.contains("booting")) setTimeout(introduce, 1200); } }
  function enable(v){ st.on = !!v; save(); if(!st.on && editing) done(); applyOn(); bus.emit("widgets:changed", { on: st.on }); return st.on; }

  let tickT = 0;
  function tick(){
    clearTimeout(tickT);
    if(!document.hidden && st.on){ paint("clock"); paint("date"); paint("tasks"); if(cards.calendar) paint("calendar"); }
    const n = new Date(); tickT = setTimeout(tick, 60000 - (n.getSeconds() * 1000 + n.getMilliseconds()) + 50);   // wake exactly at the next minute
  }
  document.addEventListener("visibilitychange", () => { if(!document.hidden){ tick(); if(loc()) fetchWeather(false).then(() => paint("weather")); } });
  bus.on("tasks:changed", () => { if(st.on && cards.tasks) paint("tasks"); });
  bus.on("settings:changed", () => { try{ D.theme && D.theme.refresh(); }catch(e){} });
  window.matchMedia("(min-height: 720px)").addEventListener && window.matchMedia("(min-height: 720px)").addEventListener("change", () => layout());

  applyOn(); tick();
  if(loc()) fetchWeather(false).then(() => paint("weather"));
  // appear one by one after the wake-up animation and the greeting (boot.js removes body.booting ~300 ms after load)
  window.addEventListener("load", () => setTimeout(introduce, 4200));

  D.widgets = {
    edit, done, isEditing: () => editing, add, remove, enable, enabled: () => st.on, refresh, askLocation,
    list: () => st.items.map(i => ({ id: i.id, slot: i.slot })), available: () => ORDER.filter(id => !st.items.some(i => i.id === id)), names: () => Object.assign({}, ...ORDER.map(id => ({ [id]: DEFS[id].name }))),
    reset(){ st = defaults(); save(); layout(); },
  };
})();
