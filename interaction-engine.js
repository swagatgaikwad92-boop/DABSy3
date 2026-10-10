/* ============================================================
   D.A.B.S.y — interaction-engine.js
   All raw pointer/keyboard handling for the creature.

     tap on the EYES   -> face:tap  (region eyes)  -> opens chat at once
     hold on the EYES  -> face:longpress (region eyes) -> tasks / reminders
     tap elsewhere     -> face:tap        (contextual reaction)
     double-tap (any, incl. the BOW TIE) -> face:doubletap (ecosystem bubbles)
     hold elsewhere    -> face:longpress  (command mode)
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
  const LONG_MS = 480, DOUBLE_MS = 300;

  let tapCount = 0, tapTimer = null, lastTapAt = 0, longTimer = null;
  let pressedAt = 0, dist = 0, last = null, dragging = false, longFired = false, down = false, region = "body";

  const eyeEls = [document.getElementById("eye-left"), document.getElementById("eye-right")];
  const MIN_HIT = 46;                                   // px — comfortable thumb target, invisible
  function hitRect(el, padX, padY){
    if(!el) return null;
    const r = el.getBoundingClientRect(); if(!r.width && !r.height) return null;
    const w = Math.max(r.width + padX * 2, MIN_HIT), h = Math.max(r.height + padY * 2, MIN_HIT);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
  }
  const inside = (p, q) => q && p.x >= q.l && p.x <= q.r && p.y >= q.t && p.y <= q.b;
  function regionOf(p){
    // bow tie first (it sits right under the eyes): its real, rendered position, not a fixed % of the box
    const tie = document.querySelector("#slot-neck .bow-knot") || document.querySelector("#slot-neck .bow-art") || document.getElementById("slot-neck");
    const tieBox = hitRect(tie, 16, 12);
    if(tieBox && inside(p, tieBox)) return "tie";
    // eyes: each eye's rendered box, padded; the gap between them counts too
    const boxes = eyeEls.map(e => hitRect(e, 14, 12)).filter(Boolean);
    if(boxes.some(b => inside(p, b))) return "eyes";
    if(boxes.length === 2){
      const gap = { l: boxes[0].r - 14, r: boxes[1].l + 14, t: Math.min(boxes[0].t, boxes[1].t), b: Math.max(boxes[0].b, boxes[1].b) };
      if(inside(p, gap)) return "eyes";
    }
    const r = face.getBoundingClientRect();
    const y = (p.y - r.top) / r.height;
    if(y < .3) return "head";
    return "body";
  }

  face.addEventListener("pointerdown", e => {
    e.preventDefault();
    down = true; longFired = false; dragging = false; dist = 0;
    last = { x: e.clientX, y: e.clientY }; pressedAt = Date.now();
    region = regionOf(last);
    try{ face.setPointerCapture(e.pointerId); }catch(_){}
    window.DABSy.face.lookAt(last.x, last.y);
    bus.emit("face:ripple", { index: (last.x - face.getBoundingClientRect().left) < face.offsetWidth / 2 ? 0 : 1 });
    bus.emit("face:pressdown", { region });
    longTimer = setTimeout(() => {
      if(!down || dragging) return;
      clearTimeout(tapTimer);                          // a hold must never ALSO become a tap
      longFired = true;
      window.DABSy.ui.vibrate(18);
      bus.emit("face:longpress", { x: last.x, y: last.y, region });
    }, LONG_MS);
  });

  face.addEventListener("pointermove", e => {
    if(!down || !last) return;
    const p = { x: e.clientX, y: e.clientY };
    dist += Math.hypot(p.x - last.x, p.y - last.y); last = p;
    if(dist > 14){ dragging = true; clearTimeout(longTimer); window.DABSy.face.lookAt(p.x, p.y); }
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
    const second = (now - lastTapAt < DOUBLE_MS) && tapCount >= 1;
    tapCount = second ? tapCount + 1 : 1;
    lastTapAt = now;
    clearTimeout(tapTimer);
    if(second){ tapCount = 0; lastTapAt = 0; bus.emit("face:doubletap", { region }); return; }
    if(region === "eyes"){                              // eyes: no waiting — chat opens on the tap itself
      tapCount = 1;
      bus.emit("face:tap", { count: 1, region });
      return;
    }
    tapTimer = setTimeout(() => {
      bus.emit("face:tap", { count: 1, region });
      tapCount = 0;
    }, DOUBLE_MS - 40);
  }
  face.addEventListener("pointerup", e => end(e, false));
  face.addEventListener("pointercancel", e => end(e, true));
  face.addEventListener("contextmenu", e => e.preventDefault());
  face.addEventListener("selectstart", e => e.preventDefault());
  face.addEventListener("dragstart", e => e.preventDefault());

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

  /* ---- bow tie: clear feedback when its double-tap fires (the action itself, the apps screen, is unchanged) ---- */
  let popTimer = null;
  bus.on("face:doubletap", ({ region }) => {
    if(region !== "tie") return;
    window.DABSy.ui.vibrate(14);
    face.classList.remove("tie-pop"); void face.offsetWidth; face.classList.add("tie-pop");
    bus.emit("tie:pop");
    clearTimeout(popTimer); popTimer = setTimeout(() => face.classList.remove("tie-pop"), 600);
  });

  window.DABSy.interaction = {};
})();
