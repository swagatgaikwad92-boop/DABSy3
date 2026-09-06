/* ============================================================
   D.A.B.S.y — pet-engine.js
   Gives DABSy continuity across sessions: notices neglect,
   rewards interaction (including actual petting — dragging a
   finger across the face, not just tapping), greets differently
   after an absence, notices long study sessions, and drops in
   small unprompted personality beats so it feels alive even when
   you're not talking to it.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const emotion = window.DABSy.emotion;

  const stats = memory.getPetStats();
  const now = Date.now();
  const awayMs = now - (stats.lastSeen || now);
  const awayHours = awayMs / 36e5;

  if(awayHours > 6){
    setTimeout(()=>{
      emotion.flashExpression("happy", 1400);
      bus.emit("dabsy:say", { text: awayHours > 24
        ? "Oh hey — it's been a while! Good to see you again."
        : "Welcome back." });
    }, 1900);
    stats.streak = 0;
  } else {
    stats.streak = (stats.streak||0) + 1;
  }
  stats.lastSeen = Date.now();
  memory.savePetStats(stats);

  /* ---------- interaction tracking ---------- */
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
  const PET_LINES = ["Mm, that's nice.", "Okay, that actually feels good.", "Keep doing that.", "I like this."];
  let lastPetAt = 0;
  bus.on("face:petted", ()=>{
    const t = Date.now();
    if(t - lastPetAt < 1400) return; // rate-limit rapid drags
    lastPetAt = t;
    emotion.nudge("affection", 0.05);
    emotion.nudge("happiness", 0.05);
    emotion.flashExpression("happy", 1100);
    bus.emit("dabsy:say", { text: PET_LINES[Math.floor(Math.random()*PET_LINES.length)] });
  });

  /* ---------- neglect creeps boredom/sleepiness up ---------- */
  setInterval(()=>{
    const idleMinutes = (Date.now() - lastInteractionAt) / 60000;
    if(idleMinutes > 6){
      emotion.nudge("boredom", 0.05);
      emotion.nudge("sleepiness", 0.04);
    }
    if(emotion.mood.sleepiness > 0.75 && emotion.getState() === "IDLE"){
      emotion.setState("SLEEPY");
    }
    const stats2 = memory.getPetStats();
    stats2.affection = emotion.mood.affection;
    memory.savePetStats(stats2);
  }, 30000);

  /* ---------- spontaneous personality beats ---------- */
  // Small, infrequent, silence-friendly (mostly just an expression, only
  // sometimes a spoken line) so DABSy feels alive without being chatty.
  const IDLE_QUIPS = ["Just thinking.", "Still here.", "Anything on your mind?", "Hm.", "Watching the world go by."];
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
    const roll = Math.random();
    if(roll < 0.4){
      emotion.flashExpression(["curious","playful","happy"][Math.floor(Math.random()*3)], 1200);
    } else if(roll < 0.55){
      bus.emit("dabsy:say", { text: IDLE_QUIPS[Math.floor(Math.random()*IDLE_QUIPS.length)] });
    }
  }
  setInterval(maybeIdleBeat, 45000 + Math.random()*30000);

  /* ---------- long study session notice ---------- */
  let studyStartedAt = null;
  bus.on("study:start", ()=>{ studyStartedAt = Date.now(); });
  bus.on("study:end", ()=>{
    if(!studyStartedAt) return;
    const mins = (Date.now() - studyStartedAt)/60000;
    memory.addHistory({ type:"study-session", minutes: Math.round(mins) });
    if(mins > 25){
      emotion.flashExpression("proud", 1600);
      bus.emit("dabsy:say", { text: "Solid session — proud of you for sticking with that." });
    }
    studyStartedAt = null;
  });

  window.DABSy = window.DABSy || {};
  window.DABSy.pet = { markInteraction };
})();
