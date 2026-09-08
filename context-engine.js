/* ============================================================
   D.A.B.S.y — context-engine.js
   The attention system. Tracks two separate things:

     userState  — INTERACTING | STUDYING | READING | IDLE
     dabsyState — SPEAKING | IDLE

   isQuiet() is the single question the Behavior Director asks
   before letting an ambient/low-priority reaction through: is the
   user mid-study or reading right now, in which case DABSy should
   stay visually/audibly out of the way.

   This engine only OBSERVES existing bus events — it never emits
   reactions itself, so it can't loop back into the Director.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;

  let userState = "IDLE";
  let dabsyState = "IDLE";
  let studying = false;
  let interactingTimer = null;

  function setUserState(next){
    if(next === userState) return;
    userState = next;
    bus.emit("context:change", { userState, dabsyState });
  }

  // A burst of direct interaction (tap, voice, typing) marks the user as
  // actively INTERACTING for a short window, then falls back to STUDYING
  // (if a study session is open) or IDLE.
  function markInteracting(){
    setUserState("INTERACTING");
    clearTimeout(interactingTimer);
    interactingTimer = setTimeout(()=>{
      setUserState(studying ? "READING" : "IDLE");
    }, 2500);
  }

  bus.on("face:tap", markInteracting);
  bus.on("face:petted", markInteracting);
  bus.on("face:doubletap", markInteracting);
  bus.on("voice:heard", markInteracting);

  // Studying: while the projection surface is open, the user is either
  // actively being talked to (STUDYING, while DABSy speaks a step) or
  // reading what's already on screen (READING, the quieter of the two —
  // this is when ambient reactions should be suppressed hardest).
  bus.on("study:start", ()=>{ studying = true; setUserState("STUDYING"); });
  bus.on("study:end", ()=>{ studying = false; setUserState("IDLE"); });

  bus.on("voice:speaking:start", ()=>{
    dabsyState = "SPEAKING";
    if(studying) setUserState("STUDYING");
  });
  bus.on("voice:speaking:end", ()=>{
    dabsyState = "IDLE";
    if(studying) setUserState("READING"); // DABSy stopped talking, but the study surface is still open — user is reading
  });

  // General inactivity fallback, independent of the interaction burst above.
  let lastAnyActivity = Date.now();
  ["face:tap","face:petted","face:doubletap","voice:heard","world:opened"].forEach(evt=>{
    bus.on(evt, ()=>{ lastAnyActivity = Date.now(); });
  });
  setInterval(()=>{
    const idleMs = Date.now() - lastAnyActivity;
    if(idleMs > 90000 && !studying && userState !== "IDLE"){
      setUserState("IDLE");
    }
  }, 15000);

  function isQuiet(){
    return userState === "STUDYING" || userState === "READING";
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.context = {
    getUserState: ()=>userState,
    getDabsyState: ()=>dabsyState,
    isQuiet,
  };
})();
