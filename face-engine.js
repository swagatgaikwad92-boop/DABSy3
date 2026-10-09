/* ============================================================
   D.A.B.S.y — face-engine.js
   Owns the creature DOM: expressions, blinking, eye tracking, the
   gentle head-tilt toward a touch, one-shot body reactions and the
   wake-up sequence. Idle timers pause when the tab is hidden and
   everything respects reduced-motion.
   ============================================================ */
(function(){
  const face = document.getElementById("face");
  const react = face.querySelector(".cr-react");
  const tilt = face.querySelector(".cr-tilt");
  const eyes = [document.getElementById("eye-left"), document.getElementById("eye-right")];
  const bus = window.DABSy.bus;
  const reduced = () => window.DABSy.ui.reducedMotion();

  let current = "neutral", idleStarted = false, hidden = document.hidden;

  function setExpression(name){
    [...face.classList].forEach(c => { if(c.startsWith("exp-")) face.classList.remove(c); });
    face.classList.add("exp-" + name);
    current = name;
  }
  setExpression("neutral");
  bus.on("expression:set", ({ name }) => setExpression(name));

  /* ---- blink ---- */
  function blinkOnce(double){
    if(current === "sleepy") return;
    eyes.forEach(e => e.classList.add("blinking"));
    setTimeout(() => {
      eyes.forEach(e => e.classList.remove("blinking"));
      if(double) setTimeout(() => blinkOnce(false), 150);
    }, 110);
  }
  (function scheduleBlink(){
    setTimeout(() => { if(idleStarted && !hidden) blinkOnce(Math.random() < .15); scheduleBlink(); }, 2400 + Math.random() * 4200);
  })();

  /* ---- eye look + head tilt ---- */
  function microLook(dx, dy){
    if(current === "sleepy") return;
    eyes.forEach(e => {
      e.style.setProperty("--lx", dx); e.style.setProperty("--ly", dy);
      e.classList.remove("micro-look"); void e.offsetWidth; e.classList.add("micro-look");
    });
  }
  function setTilt(nx, ny){            // nx, ny in -1..1
    if(reduced()){ tilt.style.setProperty("--tx","0px"); tilt.style.setProperty("--ty","0px"); tilt.style.setProperty("--rot","0deg"); return; }
    tilt.style.setProperty("--tx", (nx * 5).toFixed(1) + "px");
    tilt.style.setProperty("--ty", (ny * 3).toFixed(1) + "px");
    tilt.style.setProperty("--rot", (nx * 2.2).toFixed(2) + "deg");
  }
  function lookAt(x, y){
    const r = face.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / (r.width / 2)));
    const ny = Math.max(-1, Math.min(1, (y - (r.top + r.height * .55)) / (r.height / 2)));
    microLook((nx * 8).toFixed(1) + "px", (ny * 5).toFixed(1) + "px");
    setTilt(nx, ny);
  }
  function look(nx, ny){ microLook((nx * 8).toFixed(1) + "px", (ny * 5).toFixed(1) + "px"); setTilt(nx, ny); }
  function settle(){ microLook("0px", "0px"); setTilt(0, 0); }

  // idle drift (cheap: one timer, skipped when hidden / busy)
  setInterval(() => {
    if(!idleStarted || hidden || reduced()) return;
    if(Math.random() < .5){ look((Math.random() * 2 - 1) * .6, (Math.random() * 2 - 1) * .4); setTimeout(settle, 1400 + Math.random() * 1200); }
  }, 5200);

  /* ---- one-shot body reactions ---- */
  let reactTimer = null;
  function doReact(name){
    if(reduced() && name !== "nod") name = "nod";
    ["hop","wiggle","nod","shake","perk","dance","yawn","dizzy","spin"].forEach(n => react.classList.remove("r-" + n));
    void react.offsetWidth;
    react.classList.add("r-" + name);
    clearTimeout(reactTimer);
    reactTimer = setTimeout(() => react.classList.remove("r-" + name), 1500);
  }
  bus.on("face:react", ({ name }) => doReact(name));

  bus.on("face:recoil", () => eyes.forEach(e => { e.classList.remove("recoil"); void e.offsetWidth; e.classList.add("recoil"); }));
  bus.on("face:ripple", ({ index }) => {
    const e = eyes[index]; if(!e) return;
    const r = document.createElement("div"); r.className = "touch-ripple"; e.appendChild(r); setTimeout(() => r.remove(), 500);
  });
  bus.on("voice:speaking:start", () => eyes.forEach(e => e.classList.add("talking")));
  bus.on("voice:speaking:end", () => eyes.forEach(e => e.classList.remove("talking")));

  /* ---- start/stop idle work with tab visibility ---- */
  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden;
    face.classList.toggle("idle-breathe", idleStarted && !hidden);
  });

  /* ---- low-end hardware: lighter look ---- */
  (function(){
    const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
    if(mem <= 2 || cores <= 2) document.body.classList.add("lite-gfx");
  })();

  function startIdle(){
    if(idleStarted) return; idleStarted = true;
    face.classList.add("idle-breathe");
    eyes.forEach(e => e.querySelector(".eye-glow").classList.add("ambient"));
  }

  function playWakeSequence(){
    return new Promise(resolve => {
      eyes.forEach(e => e.classList.add("blinking"));
      const quick = reduced();
      setTimeout(() => {
        eyes.forEach(e => e.classList.remove("blinking"));
        if(quick){ setExpression("happy"); startIdle(); return resolve(); }
        setTimeout(() => { look(-.8, 0); setTimeout(() => { look(.8, 0); setTimeout(() => { settle(); setExpression("happy"); doReact("perk"); startIdle(); resolve(); }, 450); }, 420); }, 300);
      }, quick ? 200 : 700);
    });
  }

  window.DABSy.face = { setExpression, lookAt, look, settle, recoil: () => bus.emit("face:recoil"), blinkOnce, react: doReact, playWakeSequence, startIdleLoops: startIdle };
})();
