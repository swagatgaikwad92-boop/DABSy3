/* ============================================================
   D.A.B.S.y — interaction-engine.js
   All raw touch/pointer handling lives here. Translates gestures
   into bus events; never touches AI/voice logic directly.

   Tap / double-tap / long-press are all resolved on pointerup.
   A drag across the face (not just a stationary hold) is treated
   as petting instead of a tap.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const face = document.getElementById("face");
  const bowtie = document.getElementById("bowtie");

  let lastTapTime = 0;
  let tapCount = 0;
  let tapResetTimer = null;
  let longPressTimer = null;
  let pressedAt = 0;

  let dragDistance = 0;
  let lastPoint = null;
  let isDragging = false;

  function point(e){
    if(e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if(e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function onFacePointerDown(e){
    const p = point(e);
    pressedAt = Date.now();
    dragDistance = 0;
    lastPoint = p;
    isDragging = false;

    window.DABSy.face.lookAt(p.x, p.y);
    ripplePick(p);

    longPressTimer = setTimeout(()=>{
      bus.emit("face:longpress", { x:p.x, y:p.y });
      longPressTimer = null;
    }, 550);

    face.addEventListener("pointermove", onFacePointerMove);
  }

  function onFacePointerMove(e){
    if(!lastPoint) return;
    const p = point(e);
    dragDistance += Math.hypot(p.x-lastPoint.x, p.y-lastPoint.y);
    lastPoint = p;
    if(dragDistance > 14){
      isDragging = true;
      if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; }
      window.DABSy.face.lookAt(p.x, p.y);
    }
  }

  function onFacePointerUp(e){
    face.removeEventListener("pointermove", onFacePointerMove);
    if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; }

    if(isDragging && dragDistance > 40){
      bus.emit("face:petted", { distance: dragDistance });
      isDragging = false; dragDistance = 0; lastPoint = null;
      return; // a pet, not a tap — don't also fire tap/doubletap logic
    }

    const now = Date.now();
    const held = now - pressedAt;
    if(held > 550) return; // already handled as long-press

    const gap = now - lastTapTime;
    lastTapTime = now;
    tapCount = gap < 320 ? tapCount+1 : 1;

    clearTimeout(tapResetTimer);
    tapResetTimer = setTimeout(()=>{
      if(tapCount >= 2){
        bus.emit("face:doubletap");
      } else {
        bus.emit("face:tap", { count: tapCount });
      }
      tapCount = 0;
    }, 260);
  }

  function ripplePick(p){
    const rect = face.getBoundingClientRect();
    const relX = p.x - rect.left;
    const index = relX < rect.width/2 ? 0 : 1;
    bus.emit("face:ripple", { index });
  }

  face.addEventListener("pointerdown", onFacePointerDown);
  face.addEventListener("pointerup", onFacePointerUp);
  face.addEventListener("pointercancel", ()=>{
    face.removeEventListener("pointermove", onFacePointerMove);
    if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; }
    isDragging = false; dragDistance = 0; lastPoint = null;
  });

  /* ---------- bow tie: double tap opens the full menu ---------- */
  let btLast = 0;
  bowtie.addEventListener("pointerdown", (e)=>{
    e.stopPropagation();
    const now = Date.now();
    if(now - btLast < 320){
      bus.emit("world:open", { tab: "schedule" });
    }
    btLast = now;
  });

  /* ---------- repeated rapid tapping -> playful/annoyed reaction ---------- */
  let rapidCount = 0;
  let rapidTimer = null;
  bus.on("face:tap", ()=>{
    rapidCount++;
    clearTimeout(rapidTimer);
    rapidTimer = setTimeout(()=>{ rapidCount = 0; }, 2500);
    if(rapidCount >= 5){
      bus.emit("face:overtapped");
      rapidCount = 0;
    }
  });

  window.DABSy = window.DABSy || {};
  window.DABSy.interaction = {};
})();
