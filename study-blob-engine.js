/* ============================================================
   D.A.B.S.y — study-blob-engine.js
   The physical Study Block object. Two draggable elements share
   one mechanism:

     #study-blob         — free-floating, sits beside the chatbox.
                            Drag it IN (or tap it) to activate.
     #study-blob-docked   — appears inside the chatbox once merged.
                            Drag it OUT (or tap it) to deactivate.

   Dragging is done with raw pointer events rather than native
   HTML5 drag-and-drop, since DnD doesn't give the smooth
   continuous position control a magnetic/elastic feel needs.

   Central state lives here (window.DABSy.studyBlock.isActive) —
   app.js reads it to decide whether a submitted question should
   go to the normal chat/schedule path or straight into Study Mode.
   ============================================================ */

(function(){
  const dock = document.getElementById("input-dock");
  const blob = document.getElementById("study-blob");
  const docked = document.getElementById("study-blob-docked");

  let active = false;

  function vibrate(ms){ try{ navigator.vibrate?.(ms); }catch(e){} }

  function dockCenter(){
    const r = dock.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, rect: r };
  }

  function setMergePoint(clientPoint){
    const { rect } = dockCenter();
    const x = clientPoint ? ((clientPoint.x - rect.left) / rect.width) * 100 : 90;
    const y = clientPoint ? ((clientPoint.y - rect.top) / rect.height) * 100 : 50;
    dock.style.setProperty("--merge-x", `${Math.max(0,Math.min(100,x))}%`);
    dock.style.setProperty("--merge-y", `${Math.max(0,Math.min(100,y))}%`);
  }

  function activate(clientPoint){
    if(active) return;
    active = true;
    vibrate(14);
    setMergePoint(clientPoint);
    blob.classList.add("consumed");
    dock.classList.add("diffusing-in");
    setTimeout(()=>{
      dock.classList.remove("diffusing-in");
      dock.classList.add("study-active");
      docked.classList.add("visible");
    }, 650);
    window.DABSy.director.dispatch("DABSY_REPLY", {
      speakText: "Study Block on — ask me anything and I'll walk you through it.",
    });
  }

  function deactivate(clientPoint){
    if(!active) return;
    active = false;
    vibrate(10);
    setMergePoint(clientPoint);
    docked.classList.remove("visible");
    dock.classList.remove("study-active");
    dock.classList.add("diffusing-out");
    setTimeout(()=>{
      dock.classList.remove("diffusing-out");
      blob.classList.remove("consumed");
    }, 650);
    window.DABSy.director.dispatch("DABSY_REPLY", { speakText: "Study Block off." });
  }

  /* ---------- shared pointer-tracking primitive ---------- */
  function point(e){
    if(e.touches && e.touches[0]) return { x:e.touches[0].clientX, y:e.touches[0].clientY };
    return { x:e.clientX, y:e.clientY };
  }

  // Wires one draggable element. `evaluate(distanceFromDockCenter, moved)`
  // decides on release whether the drag counts as a successful merge/split;
  // `onTap` fires for a short tap that never really dragged.
  function wireDraggable(el, { magnetDistance, evaluate, onTap }){
    let startX=0, startY=0, dx=0, dy=0, dragging=false, moved=0;

    function down(e){
      const p = point(e);
      startX = p.x; startY = p.y; dx = 0; dy = 0; moved = 0;
      dragging = true;
      el.classList.add("dragging");
      try{ el.setPointerCapture?.(e.pointerId); }catch(err){}
    }

    function move(e){
      if(!dragging) return;
      const p = point(e);
      let ndx = p.x - startX, ndy = p.y - startY;

      // magnetic pull toward the dock once close, so the last bit of the
      // drag feels like it's being drawn in rather than manually aimed
      const { x:cx, y:cy } = dockCenter();
      const curX = startX + ndx, curY = startY + ndy;
      const dist = Math.hypot(curX-cx, curY-cy);
      if(magnetDistance && dist < magnetDistance){
        const pull = (1 - dist/magnetDistance) * 0.35;
        ndx += (cx - curX) * pull;
        ndy += (cy - curY) * pull;
      }

      dx = ndx; dy = ndy;
      moved = Math.hypot(dx, dy);
      const stretch = Math.min(0.28, moved/300);
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${1+stretch})`;
      e.preventDefault?.();
    }

    function up(e){
      if(!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      el.style.transform = ""; // CSS transition (now that .dragging is gone) eases back to (0,0) unless overridden below

      if(moved < 8){
        onTap?.();
        return;
      }

      const finalPoint = { x: startX+dx, y: startY+dy };
      const { x:cx, y:cy } = dockCenter();
      const distFromDock = Math.hypot(finalPoint.x-cx, finalPoint.y-cy);
      evaluate(distFromDock, finalPoint);
    }

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  wireDraggable(blob, {
    magnetDistance: 110,
    evaluate: (dist, atPoint) => { if(dist < 60) activate(atPoint); },
    onTap: () => activate(),
  });

  wireDraggable(docked, {
    magnetDistance: 0, // no pull needed dragging OUT
    evaluate: (dist, atPoint) => { if(dist > 70) deactivate(atPoint); },
    onTap: () => deactivate(),
  });

  window.DABSy = window.DABSy || {};
  window.DABSy.studyBlock = {
    get isActive(){ return active; },
    activate: () => activate(),
    deactivate: () => deactivate(),
  };
})();
