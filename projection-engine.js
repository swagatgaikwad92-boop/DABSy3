/* ============================================================
   D.A.B.S.y — projection-engine.js
   Handles the two "world expands" transitions:
     1) double-tap BOW TIE -> #world, the full menu
     2) study start -> #projection (face shrinks to corner)
   Double-tapping the EYES opens the small quick-bubbles menu
   instead — see quickbubbles-engine.js.

   #world can be closed three ways: the Close button, tapping the
   backdrop outside the sheet, or (from anywhere) emitting
   "world:close" on the bus.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const emotion = window.DABSy.emotion;
  const world = document.getElementById("world");
  const worldBackdrop = document.getElementById("world-backdrop");
  const projection = document.getElementById("projection");
  const worldTabs = document.querySelectorAll("#world-tabs button");
  const worldPanels = document.querySelectorAll(".world-panel");
  const worldClose = document.getElementById("world-close");
  const worldSettingsShortcut = document.getElementById("world-settings-shortcut");
  const projectionClose = document.getElementById("projection-close");

  function openWorld(tab){
    window.DABSy.quickbubbles?.close();
    world.classList.add("open");
    world.setAttribute("aria-hidden","false");
    window.DABSy.director.dispatch("USER_DOUBLETAPPED");
    selectTab(tab || "schedule");
    bus.emit("world:opened", { tab: tab || "schedule" });
  }
  function closeWorld(){
    world.classList.remove("open");
    world.setAttribute("aria-hidden","true");
    bus.emit("world:closed");
  }

  function selectTab(tab){
    worldTabs.forEach(b=>b.classList.toggle("active", b.dataset.tab === tab));
    worldPanels.forEach(p=>p.classList.toggle("active", p.dataset.panel === tab));
  }

  worldTabs.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      selectTab(btn.dataset.tab);
      bus.emit("world:opened", { tab: btn.dataset.tab });
    });
  });

  worldClose.addEventListener("click", closeWorld);
  worldBackdrop.addEventListener("click", closeWorld); // tap outside the sheet also closes it
  worldSettingsShortcut.addEventListener("click", ()=>{
    selectTab("settings");
    bus.emit("world:opened", { tab: "settings" });
  });

  bus.on("world:open", ({tab})=>openWorld(tab));
  bus.on("world:close", closeWorld);

  /* ---------- study projection ---------- */
  function openProjection(){
    document.body.classList.add("study-active");
    projection.classList.add("open");
    projection.setAttribute("aria-hidden","false");
    emotion.setState("STUDY_FOCUS");
    bus.emit("study:start");
  }
  function closeProjection(){
    document.body.classList.remove("study-active");
    projection.classList.remove("open");
    projection.setAttribute("aria-hidden","true");
    emotion.setState("IDLE");
    bus.emit("study:end");
  }
  projectionClose.addEventListener("click", closeProjection);
  bus.on("projection:open", openProjection);
  bus.on("projection:close", closeProjection);

  window.DABSy = window.DABSy || {};
  window.DABSy.projection = { openWorld, closeWorld, openProjection, closeProjection, selectTab };
})();
