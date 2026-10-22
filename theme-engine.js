/* ============================================================
   D.A.B.S.y — theme-engine.js  (v8)
   Interface theme: "dark" (default) | "light" | "auto" (follow the LOCAL CLOCK: light by day, dark by night — v11.1; it no longer
   follows the phone's own light/dark setting).
   Independent of the character presentation (Minimal / Furry), which is
   owned by outfit-engine.js. Stored in the existing settings object
   (memory.saveSettings({ theme })), so no new storage. An inline script in
   index.html sets data-theme before first paint to avoid a flash.

     DABSy.theme.get()       -> "dark" | "light" | "auto"  (the choice)
     DABSy.theme.resolved()  -> "dark" | "light"           (what is showing)
     DABSy.theme.set(v)
   ============================================================ */
(function(){
  const D = window.DABSy, bus = D.bus, memory = D.memory;
  const root = document.documentElement;
  const DAY = [6.5, 18.5];                       // local clock hours treated as daytime (same boundaries the wallpapers use)
  const isDay = () => { const n = new Date(), h = n.getHours() + n.getMinutes() / 60; return h >= DAY[0] && h < DAY[1]; };
  let boundT = 0;
  function scheduleBoundary(){
    clearTimeout(boundT); boundT = 0;
    if(choice() !== "auto") return;
    const n = new Date(), h = n.getHours() + n.getMinutes() / 60;
    const next = DAY.map(t => (t - h + 24) % 24).filter(d => d > 0.0005).sort((x, y) => x - y)[0];
    boundT = setTimeout(() => { apply(true); scheduleBoundary(); }, Math.max(1000, next * 3600000 + 500));
  }
  const META = { dark: "#0f1318", light: "#fbf6e6" };
  let applied = null;

  const choice = () => { const t = memory.getSettings().theme; return t === "light" || t === "auto" ? t : "dark"; };
  const resolve = c => c === "auto" ? (isDay() ? "light" : "dark") : c;

  function apply(animate){
    const r = resolve(choice());
    if(r === applied) return;
    if(animate && applied && !D.ui.reducedMotion()){
      root.classList.add("theme-anim"); setTimeout(() => root.classList.remove("theme-anim"), 520);
    }
    applied = r; root.dataset.theme = r;
    const m = document.querySelector('meta[name="theme-color"]'); if(m) m.setAttribute("content", META[r]);
    bus.emit("theme:changed", { theme: r, choice: choice() });
  }

  function set(v){ memory.saveSettings({ theme: v === "light" || v === "auto" ? v : "dark" }); }

  bus.on("settings:changed", () => { apply(true); scheduleBoundary(); });
  bus.on("memory:wiped", () => apply(true));        // "Forget everything" resets settings, so the theme follows
  document.addEventListener("visibilitychange", () => { if(!document.hidden && choice() === "auto"){ apply(true); scheduleBoundary(); } });   // timers can sleep with the phone: re-check on return
  apply(false); scheduleBoundary();

  D.theme = { get: choice, resolved: () => applied, set, isDay, dayHours: DAY.slice(), refresh: () => { if(choice() === "auto") apply(true); } };
})();
