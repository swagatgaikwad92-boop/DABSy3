/* ============================================================
   D.A.B.S.y — face-engine.js
   Owns the DOM face. Listens to emotion-engine events and turns
   them into visible behaviour: expression classes, blinking,
   idle micro-looks, look-at-touch, recoil, talk rhythm, and the
   one-time boot "wake up" sequence.
   ============================================================ */

(function(){
  const face = document.getElementById("face");
  const eyes = [document.getElementById("eye-left"), document.getElementById("eye-right")];
  const bus = window.DABSy.bus;

  let currentExpression = "neutral";
  let idleLoopsStarted = false;

  function setExpression(name){
    face.classList.forEach(c=>{ if(c.startsWith("exp-")) face.classList.remove(c); });
    face.classList.add("exp-" + name);
    currentExpression = name;
  }
  setExpression("neutral");

  bus.on("expression:set", ({name}) => setExpression(name));

  /* ---------- blinking (independent, irregular) ---------- */
  let blinkScheduled = false;
  function scheduleBlink(){
    if(blinkScheduled) return;
    blinkScheduled = true;
    const delay = 2200 + Math.random()*4200;
    setTimeout(()=>{
      blinkScheduled = false;
      blinkOnce();
      scheduleBlink();
    }, delay);
  }
  function blinkOnce(double=false){
    eyes.forEach(e=>e.classList.add("blinking"));
    setTimeout(()=>{
      eyes.forEach(e=>e.classList.remove("blinking"));
      if(double) setTimeout(()=>blinkOnce(false), 160);
    }, 110);
  }

  /* ---------- idle micro-look: eyes drift slightly, then settle ---------- */
  function microLook(dxOverride, dyOverride){
    if(currentExpression === "sleepy") return;
    const dx = dxOverride ?? (Math.random()*10-5).toFixed(1) + "px";
    const dy = dyOverride ?? (Math.random()*6-3).toFixed(1) + "px";
    eyes.forEach(e=>{
      e.style.setProperty("--lx", dx);
      e.style.setProperty("--ly", dy);
      e.classList.remove("micro-look"); void e.offsetWidth; e.classList.add("micro-look");
    });
  }
  function settleLook(){ microLook("0px","0px"); }

  function startIdleLoops(){
    if(idleLoopsStarted) return;
    idleLoopsStarted = true;
    scheduleBlink();
    setInterval(()=>{ if(Math.random() < 0.15) blinkOnce(true); }, 9000);
    setInterval(()=>{
      if(Math.random() < 0.5){
        microLook();
        setTimeout(settleLook, 1400 + Math.random()*1200);
      }
    }, 5200);
    face.classList.add("idle-breathe");
    eyes.forEach(e=>e.querySelector(".eye-glow").classList.add("ambient"));
  }

  /* ---------- look-at a point on screen (touch reaction) ---------- */
  function lookAt(x, y){
    const rect = face.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const dx = Math.max(-8, Math.min(8, (x-cx)/40));
    const dy = Math.max(-5, Math.min(5, (y-cy)/60));
    microLook(dx+"px", dy+"px");
  }

  /* ---------- recoil (surprise burst) ---------- */
  function recoil(){
    eyes.forEach(e=>{
      e.classList.remove("recoil"); void e.offsetWidth; e.classList.add("recoil");
    });
  }
  bus.on("face:recoil", recoil);

  /* ---------- touch ripple ---------- */
  function ripple(eyeEl){
    const r = document.createElement("div");
    r.className = "touch-ripple";
    eyeEl.appendChild(r);
    setTimeout(()=>r.remove(), 500);
  }
  bus.on("face:ripple", ({index})=>{
    if(eyes[index]) ripple(eyes[index]);
  });

  /* ---------- talking rhythm ---------- */
  bus.on("voice:speaking:start", ()=>eyes.forEach(e=>e.classList.add("talking")));
  bus.on("voice:speaking:end", ()=>eyes.forEach(e=>e.classList.remove("talking")));

  /* ---------- boot wake-up sequence ---------- */
  // Starts with lids closed (sleeping), then opens, glances left/right once
  // each, settles, and flashes happy — all before idle loops kick in so the
  // sequence never gets interrupted by a random blink.
  function playWakeSequence(){
    return new Promise((resolve)=>{
      eyes.forEach(e=>e.classList.add("blinking")); // start "asleep" (lids down)
      setTimeout(()=>{
        eyes.forEach(e=>e.classList.remove("blinking")); // eyes open
        setTimeout(()=>{
          microLook("-6px","0px");
          setTimeout(()=>{
            microLook("6px","0px");
            setTimeout(()=>{
              settleLook();
              setExpression("happy");
              startIdleLoops();
              resolve();
            }, 500);
          }, 480);
        }, 350);
      }, 900);
    });
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.face = { setExpression, lookAt, recoil, blinkOnce, playWakeSequence, startIdleLoops };
})();
