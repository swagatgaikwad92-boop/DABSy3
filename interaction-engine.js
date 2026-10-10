/* ============================================================
   D.A.B.S.y — interaction-engine.js
   The ONLY place raw pointer/keyboard input on the creature is handled.

     single tap on an EYE   -> face:tap (region eyes)  -> chat opens at once
     single tap on BOW TIE  -> face:tap (region tie)   -> spin + quip (reactions.js)
     single tap elsewhere   -> face:tap                -> contextual reaction
     double-tap (anywhere)  -> face:doubletap          -> apps (ecosystem bubbles)
     press and hold         -> face:longpress          -> tasks / reminders
     drag / stroke          -> face:petted

   Discrimination rules
     · a hold (>= LONG_MS, finger still) fires once and cancels any pending tap
     · movement > MOVE_PX turns the press into a stroke: no tap, no hold
     · a second tap within DOUBLE_MS of the first is a double-tap and cancels
       the first tap's pending reaction; it never emits a second face:tap
     · eye taps are emitted immediately (chat first); a double-tap then closes
       that chat again, without ever focusing the keyboard (see app.js)
     · only one pointer is tracked; extra fingers / right-click are ignored

   Every gesture has a non-gesture route:
     Enter / Space = tap on the eyes (chat)   ArrowDown = double-tap (apps)
     ArrowUp = hold (tasks)   plus the shortcut buttons (Settings → Accessibility).
   pressdown/pressup events carry a region (eyes | tie | head | body).
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const face = document.getElementById("face");
  const LONG_MS = 480, DOUBLE_MS = 300, MOVE_PX = 14;

  let tapCount = 0, tapTimer = null, lastTapAt = 0, longTimer = null;
  let pressedAt = 0, dist = 0, last = null, dragging = false, longFired = false, down = false, region = "body", activePointer = null;

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
    const tie = document.querySelector("#slot-neck .bow-art") || document.querySelector("#slot-neck .bow-knot") || document.getElementById("slot-neck");
    const tieBox = hitRect(tie, 8, 8);                     // .bow-art spans both lobes; it stays measurable even while the 3D tie is drawn over it
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
    if(down || (e.pointerType === "mouse" && e.button !== 0)) return;   // one pointer at a time; mouse: left button only
    activePointer = e.pointerId;
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
      tapCount = 0; lastTapAt = 0;                     // ...nor the second half of a double-tap
      longFired = true;
      window.DABSy.ui.vibrate(18);
      bus.emit("face:longpress", { x: last.x, y: last.y, region });
    }, LONG_MS);
  });

  face.addEventListener("pointermove", e => {
    if(!down || !last || e.pointerId !== activePointer) return;
    const p = { x: e.clientX, y: e.clientY };
    dist += Math.hypot(p.x - last.x, p.y - last.y); last = p;
    if(dist > MOVE_PX){ dragging = true; clearTimeout(longTimer); window.DABSy.face.lookAt(p.x, p.y); }
  });

  function end(e, cancelled){
    if(!down || (e && e.pointerId !== activePointer)) return;
    down = false; activePointer = null; clearTimeout(longTimer);
    bus.emit("face:pressup", { region });
    window.DABSy.face.settle();
    if(cancelled){ clearTimeout(tapTimer); tapCount = 0; lastTapAt = 0; return; }
    swallowClickUntil = Date.now() + 400;               // the browser's follow-up "click" must not hit what the gesture just opened
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
  // A hold or double-tap opens an overlay (tasks sheet, apps) UNDER the finger; the compatibility click that
  // follows the release would then land on that overlay's backdrop and close it again. Swallow it, centrally.
  let swallowClickUntil = 0;
  window.addEventListener("click", e => {
    if(Date.now() < swallowClickUntil && !(e.target && e.target.closest && e.target.closest("#shortcuts"))){ e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  face.addEventListener("pointerup", e => end(e, false));
  face.addEventListener("pointercancel", e => end(e, true));
  face.addEventListener("lostpointercapture", e => { if(down) end(e, true); });
  window.addEventListener("blur", () => { if(down) end({ pointerId: activePointer }, true); });
  document.addEventListener("visibilitychange", () => { if(document.hidden && down) end({ pointerId: activePointer }, true); });
  face.addEventListener("contextmenu", e => e.preventDefault());
  face.addEventListener("selectstart", e => e.preventDefault());
  face.addEventListener("touchstart", e => { if(e.touches.length > 1) e.preventDefault(); }, { passive: false });   // no pinch/zoom starts on the character
  face.addEventListener("dblclick", e => e.preventDefault());                                                      // never zoom / select on a double-tap
  face.addEventListener("dragstart", e => e.preventDefault());

  /* ---- keyboard + visible alternatives ---- */
  face.addEventListener("keydown", e => {
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); bus.emit("face:tap", { count: 1, region: "eyes", via: "key" }); }
    else if(e.key === "ArrowDown"){ e.preventDefault(); bus.emit("face:doubletap", { region: "body" }); }
    else if(e.key === "ArrowUp"){ e.preventDefault(); bus.emit("face:longpress", { region: "body" }); }
  });
  document.getElementById("sc-apps").addEventListener("click", () => bus.emit("face:doubletap", { region: "body", via: "button" }));
  document.getElementById("sc-talk").addEventListener("click", () => bus.emit("face:talk", { via: "button" }));

  /* ---- rapid tapping -> playful annoyance ---- */
  let rapid = 0, rapidTimer = null;
  bus.on("face:tap", () => {
    rapid++; clearTimeout(rapidTimer); rapidTimer = setTimeout(() => { rapid = 0; }, 2500);
    if(rapid >= 5){ bus.emit("face:overtapped"); rapid = 0; }
  });

  /* ---- bow tie: tapping it (the original v8 interaction) already spins DABSy and may get a quip (reactions.js);
          here the tie itself gives a tiny puff + haptic so the tap visibly lands on the tie ---- */
  bus.on("face:tap", ({ region }) => {
    if(region !== "tie") return;
    window.DABSy.ui.vibrate(10);
    bus.emit("tie:pop");
  });

  window.DABSy.interaction = {};
})();
