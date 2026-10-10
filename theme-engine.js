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
  const META = { dark: "#070914", light: "#f2eee5" };
  let applied = null;

  const choice = () => { const t = memory.getSettings().theme; return t === "light" || t === "auto" ? t : "dark"; };
  const resolve = c => c === "auto" ? (mq && mq.matches ? "light" : "dark") : c;

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

  bus.on("settings:changed", () => apply(true));
  bus.on("memory:wiped", () => apply(true));        // "Forget everything" resets settings, so the theme follows
  if(mq){ const onChange = () => { if(choice() === "auto") apply(true); }; mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange); }
  apply(false);

  D.theme = { get: choice, resolved: () => applied, set };
})();
