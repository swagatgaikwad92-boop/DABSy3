/* ============================================================
   D.A.B.S.y — projection-engine.js
   The Study Block explanation surface: the creature shrinks into
   a corner and the answer is "projected" with a reading pointer.
   (The v6 "world" menu was replaced by the ecosystem bubbles and
   Settings sheet.)
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const emotion = window.DABSy.emotion;
  const projection = document.getElementById("projection");

  function openProjection(){
    document.body.classList.add("study-active");
    projection.classList.add("open"); projection.setAttribute("aria-hidden", "false");
    emotion.setState("STUDY_FOCUS");
    bus.emit("study:start");
  }
  function closeProjection(){
    if(!projection.classList.contains("open")) return;
    document.body.classList.remove("study-active");
    projection.classList.remove("open"); projection.setAttribute("aria-hidden", "true");
    emotion.setState("IDLE");
    bus.emit("study:end");
  }
  document.getElementById("projection-close").addEventListener("click", closeProjection);
  bus.on("projection:open", openProjection);
  bus.on("projection:close", closeProjection);
  window.DABSy.projection = { openProjection, closeProjection };
})();
