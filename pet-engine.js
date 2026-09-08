/* ============================================================
   D.A.B.S.y — pet-engine.js
   Gives DABSy continuity across sessions: notices neglect,
   rewards real petting (dragging a finger across the face),
   greets differently after an absence, notices long study
   sessions, and drops in small unprompted personality beats.

   Every reaction here is DISPATCHED to the Behavior Director
   rather than set directly — this engine only decides WHEN
   something is worth reacting to; the Director decides HOW.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const emotion = window.DABSy.emotion;
  const director = window.DABSy.director;

  const stats = memory.getPetStats();
  const now = Date.now();
  const awayMs = now - (stats.lastSeen || now);
  const awayHours = awayMs / 36e5;

  if(awayHours > 6){
    setTimeout(()=>{
      director.dispatch("RETURN_AFTER_ABSENCE", {
        speakText: awayHours > 24
          ? "Oh hey — it's been a while! Good to see you again."
          : "Welcome back.",
      });
    }, 1900);
    stats.streak = 0;
  } else {
    stats.streak = (stats.streak||0) + 1;
  }
  stats.lastSeen = Date.now();
  memory.savePetStats(stats);

  /* ---------- interaction tracking (feeds mood, not the Director) ---------- */
  let lastInteractionAt = Date.now();
  function markInteraction(){
    lastInteractionAt = Date.now();
    emotion.nudge("boredom", -0.08);
    emotion.nudge("sleepiness", -0.05);
  }
  bus.on("face:tap", markInteraction);
  bus.on("face:doubletap", markInteraction);
  bus.on("face:petted", markInteraction);
  bus.on("voice:heard", markInteraction);

  /* ---------- real petting: dragging a finger across the face ---------- */
  let lastPetAt = 0;
  bus.on("face:petted", ()=>{
    const t = Date.now();
    if(t - lastPetAt < 1400) return; // rate-limit rapid drags
    lastPetAt = t;
    emotion.nudge("affection", 0.05);
    emotion.nudge("happiness", 0.05);
    director.dispatch("USER_PETTED");
  });

  /* ---------- neglect creeps boredom/sleepiness up ---------- */
  setInterval(()=>{
    const idleMinutes = (Date.now() - lastInteractionAt) / 60000;
    if(idleMinutes > 6){
      emotion.nudge("boredom", 0.05);
      emotion.nudge("sleepiness", 0.04);
    }
    if(emotion.mood.sleepiness > 0.75 && emotion.getState() === "IDLE"){
      emotion.setState("SLEEPY"); // a direct mood-driven state shift, not a "reaction" to a discrete event
    }
    const stats2 = memory.getPetStats();
    stats2.affection = emotion.mood.affection;
    memory.savePetStats(stats2);
  }, 30000);

  /* ---------- spontaneous personality beats ---------- */
  function anyMenuOpen(){
    return document.getElementById("world").classList.contains("open")
        || document.getElementById("projection").classList.contains("open")
        || document.getElementById("quick-bubbles").classList.contains("open");
  }
  function maybeIdleBeat(){
    if(emotion.getState() !== "IDLE") return;
    if(anyMenuOpen()) return;
    const idleMinutes = (Date.now() - lastInteractionAt) / 60000;
    if(idleMinutes < 1) return;
    if(Math.random() < 0.55) director.dispatch("IDLE_BEAT"); // low priority — Director drops it if busy, and context suppresses it while studying/reading
  }
  setInterval(maybeIdleBeat, 45000 + Math.random()*30000);

  /* ---------- long study session notice ---------- */
  let studyStartedAt = null;
  bus.on("study:start", ()=>{ studyStartedAt = Date.now(); });
  bus.on("study:end", ()=>{
    if(!studyStartedAt) return;
    const mins = (Date.now() - studyStartedAt)/60000;
    memory.addHistory({ type:"study-session", minutes: Math.round(mins) });
    if(mins > 25) director.dispatch("STUDY_SESSION_GOOD");
    studyStartedAt = null;
  });

  window.DABSy = window.DABSy || {};
  window.DABSy.pet = { markInteraction };
})();
