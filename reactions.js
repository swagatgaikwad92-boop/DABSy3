/* ============================================================
   D.A.B.S.y — reactions.js
   A single tap is a CONTEXTUAL reaction, not a fixed animation:
   where you touched (eyes / head / bow tie / body), the time of day,
   what is due next, whether you are mid-study. All output goes through
   the Behavior Director, which keeps it quiet while you study.
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const director = window.DABSy.director;
  const tasks = window.DABSy.tasks;
  const ui = window.DABSy.ui;
  const ctx = window.DABSy.context;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let lastSpeak = 0, tapIndex = 0;

  // touching the eyes makes them close, like a real face
  bus.on("face:pressdown", ({ region }) => { if(region === "eyes") window.DABSy.face.blinkOnce(false); });

  function hint(){
    const now = new Date();
    const hr = now.getHours();
    const pending = tasks.instancesForDate(ui.dateKey(now)).filter(i => i.status === "pending");
    const overdue = pending.find(i => tasks.isOverdue(i, now));
    if(overdue) return { text: `"${overdue.title}" slipped earlier. Want to find it a new slot?`, react: "nod", tap: () => window.DABSy.notify.rescheduleFlow(overdue.taskId, overdue.dateKey) };
    const soon = pending.find(i => i.start > now && (i.start - now) < 45 * 60000);
    if(soon) return { text: `${soon.title} is at ${ui.fmtTime(soon.start)}.`, react: "perk" };
    if(hr >= 23 || hr < 4) return { text: pick(["It's late. Rest counts as studying too.", "Maybe sleep soon?"]), react: "yawn", expr: "sleepy" };
    if(hr >= 4 && hr < 7) return { text: "Early start. I like it.", react: "perk" };
    return null;
  }

  bus.on("face:tap", ({ region }) => {
    tapIndex++;
    if(ctx.isQuiet()){ director.dispatch("USER_TAPPED", { react: "nod" }); return; }
    if(region === "tie"){ director.dispatch("USER_TAPPED", { react: "spin", speakChance: .5, speakPool: ["Do you like the bow tie?", "Looking sharp.", "Tie's on straight."] }); return; }
    if(region === "head"){ director.dispatch("USER_TAPPED", { react: "nod", transitionSteps: [{ expr: "happy", holdMs: 900 }] }); return; }
    // at most one spoken line per ~25 seconds, and never on every tap
    const canSpeak = Date.now() - lastSpeak > 25000 && (tapIndex % 3 === 1);
    const h = canSpeak ? hint() : null;
    if(h){
      lastSpeak = Date.now();
      director.dispatch("USER_TAPPED", { speakText: h.text, react: h.react, transitionSteps: [{ expr: h.expr || "curious", holdMs: 600 }] });
      if(h.tap) ui.toast({ text: h.text, actions: [{ label: "Find a slot", primary: true, onClick: h.tap }], timeout: 9000 });
      return;
    }
    director.dispatch("USER_TAPPED", { react: region === "eyes" ? "perk" : "wiggle", transitionSteps: [{ expr: pick(["curious", "happy", "playful"]), holdMs: 700 }] });
  });

  bus.on("face:overtapped", () => director.dispatch("USER_OVERTAPPED"));
  bus.on("face:longpress", () => director.dispatch("USER_LONGPRESS"));
})();
