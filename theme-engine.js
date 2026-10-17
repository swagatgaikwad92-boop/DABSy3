/* ============================================================
   D.A.B.S.y — theme-engine.js  (v8)
   Interface theme: "dark" (default) | "light" | "auto" (follow the device).
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
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const META = { dark: "#0f1318", light: "#fbf6e6" };
  let applied = null;

  /* v10.4: Auto = REAL TIME. Day (light) from 06:00 to 17:59 by the phone's local clock, Night (dark) otherwise.
     It is re-checked every minute and when the app comes back to the foreground. A manual Day/Night choice stays until
     you pick Auto again (Settings → Day / Night → Auto). First run of v10.4 switches existing installs to Auto once. */
  const DAY_START = 6, DAY_END = 18;
  const byClock = () => { const h = new Date().getHours(); return h >= DAY_START && h < DAY_END ? "light" : "dark"; };
  try{ if(!localStorage.getItem("dabsy_theme_rt_v1")){ localStorage.setItem("dabsy_theme_rt_v1", "1"); memory.saveSettings({ theme: "auto" }); } }catch(_){}
  const choice = () => { const t = memory.getSettings().theme; return t === "light" || t === "dark" ? t : "auto"; };
  const resolve = c => c === "auto" ? byClock() : c;

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
  /* v10.2 — one explicit Day / Night control. "day" = light, "night" = dark. "auto" (follow the phone) exists
     only as something the user picks; the default is night and nothing ever flips it from the clock by itself. */
  const mode = () => { const c = choice(); return c === "light" ? "day" : c === "dark" ? "night" : "auto"; };
  function setMode(m){ set(m === "day" ? "light" : m === "auto" ? "auto" : "dark"); }
  function toggle(){ setMode(resolve(choice()) === "light" ? "night" : "day"); }

  bus.on("settings:changed", () => apply(true));
  bus.on("memory:wiped", () => apply(true));        // "Forget everything" resets settings, so the theme follows
  setInterval(() => { if(choice() === "auto") apply(true); }, 60000);
  document.addEventListener("visibilitychange", () => { if(!document.hidden && choice() === "auto") apply(true); });
  if(mq){ const onChange = () => { if(choice() === "auto") apply(true); }; mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange); }
  /* the Day / Night quick switch on the main screen (same control as Settings → Appearance) */
  const btn = document.getElementById("daynight-btn");
  const SUN = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></g></svg>';
  const MOON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8Z"/></svg>';
  function paintBtn(){
    if(!btn) return;
    const day = applied === "light";
    btn.innerHTML = day ? SUN : MOON;                          // shows what is on now
    btn.setAttribute("aria-label", day ? "Day mode is on. Switch to Night." : "Night mode is on. Switch to Day.");
    btn.setAttribute("aria-pressed", String(!day)); btn.title = day ? "Switch to Night" : "Switch to Day";
  }
  if(btn) btn.addEventListener("click", () => { toggle(); try{ D.ui.vibrate(8); }catch(e){} });
  bus.on("theme:changed", paintBtn);
  apply(false); paintBtn();

  D.theme = { get: choice, resolved: () => applied, set, mode, setMode, toggle };
})();
