/* ============================================================
   D.A.B.S.y — interaction-engine.js
   All raw pointer/keyboard handling for the creature.

     tap          -> face:tap        (contextual reaction)
     double-tap   -> face:doubletap  (ecosystem bubbles)
     long-press   -> face:longpress  (command mode)
     drag/stroke  -> face:petted

   Every gesture has a non-gesture route:
     Enter / Space = tap      ArrowDown = double-tap (apps)
     ArrowUp = long-press (commands)
     plus on-screen shortcut buttons (Settings → Accessibility).
   pressdown/pressup events carry a region (eyes | body | tie) so
   reactions can be contextual.
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const face = document.getElementById("face");
  const LONG_MS = 520, DOUBLE_MS = 300;

  let tapCount = 0, tapTimer = null, lastTapAt = 0, longTimer = null;
  let pressedAt = 0, dist = 0, last = null, dragging = false, longFired = false, down = false, region = "body";

  function regionOf(p){
    const r = face.getBoundingClientRect();
    const x = (p.x - r.left) / r.width, y = (p.y - r.top) / r.height;
    if(y > .74 && y < .9 && x > .3 && x < .7) return "tie";
    if(y > .38 && y < .68 && x > .22 && x < .78) return "eyes";
    if(y < .3) return "head";
    return "body";
  }

  face.addEventListener("pointerdown", e => {
    down = true; longFired = false; dragging = false; dist = 0;
    last = { x: e.clientX, y: e.clientY }; pressedAt = Date.now();
    region = regionOf(last);
    try{ face.setPointerCapture(e.pointerId); }catch(_){}
    window.DABSy.face.lookAt(last.x, last.y);
    bus.emit("face:ripple", { index: (last.x - face.getBoundingClientRect().left) < face.offsetWidth / 2 ? 0 : 1 });
    bus.emit("face:pressdown", { region });
    longTimer = setTimeout(() => {
      if(!down || dragging) return;
      longFired = true;
      window.DABSy.ui.vibrate(18);
      bus.emit("face:longpress", { x: last.x, y: last.y, region });
    }, LONG_MS);
  });

  face.addEventListener("pointermove", e => {
    if(!down || !last) return;
    const p = { x: e.clientX, y: e.clientY };
    dist += Math.hypot(p.x - last.x, p.y - last.y); last = p;
    if(dist > 16){ dragging = true; clearTimeout(longTimer); window.DABSy.face.lookAt(p.x, p.y); }
  });

  function end(e, cancelled){
    if(!down) return; down = false; clearTimeout(longTimer);
    bus.emit("face:pressup", { region });
    window.DABSy.face.settle();
    if(cancelled) return;
    if(longFired) return;
    if(dragging && dist > 44){ bus.emit("face:petted", { distance: dist }); return; }
    if(dragging) return;
    const now = Date.now();
    tapCount = (now - lastTapAt < DOUBLE_MS) ? tapCount + 1 : 1;
    lastTapAt = now;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      if(tapCount >= 2) bus.emit("face:doubletap", { region });
      else bus.emit("face:tap", { count: 1, region });
      tapCount = 0;
    }, DOUBLE_MS - 40);
  }
  face.addEventListener("pointerup", e => end(e, false));
  face.addEventListener("pointercancel", e => end(e, true));
  face.addEventListener("contextmenu", e => e.preventDefault());

  /* ---- keyboard + visible alternatives ---- */
  face.addEventListener("keydown", e => {
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); bus.emit("face:tap", { count: 1, region: "body" }); }
    else if(e.key === "ArrowDown"){ e.preventDefault(); bus.emit("face:doubletap", { region: "body" }); }
    else if(e.key === "ArrowUp"){ e.preventDefault(); bus.emit("face:longpress", { region: "body" }); }
  });
  document.getElementById("sc-apps").addEventListener("click", () => bus.emit("face:doubletap", { region: "body", via: "button" }));
  document.getElementById("sc-talk").addEventListener("click", () => bus.emit("face:longpress", { region: "body", via: "button" }));

  /* ---- rapid tapping -> playful annoyance ---- */
  let rapid = 0, rapidTimer = null;
  bus.on("face:tap", () => {
    rapid++; clearTimeout(rapidTimer); rapidTimer = setTimeout(() => { rapid = 0; }, 2500);
    if(rapid >= 5){ bus.emit("face:overtapped"); rapid = 0; }
  });

  window.DABSy.interaction = {};
})();
