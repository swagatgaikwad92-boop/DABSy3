/* ============================================================
   D.A.B.S.y — agent-engine.js : "I want to study Class 11 Chemistry today"
   goal -> constraints -> real research -> swipe-pick material ->
   adaptive plan -> session (start / schedule / send to Study Space)

   Every step is a real module call; nothing is scripted to look smart.
   Where a step can't be real (no search service connected), the step
   says so and offers the honest fallback instead.
   ============================================================ */
(function(){
  const ai = window.DABSy.ai;
  const ui = window.DABSy.ui;
  const D = window.DABSy;
  const say = (t, s) => D.app.say(t, s);
  let running = false;

  async function askSubject(){
    const input = ui.el("input", { type: "text", placeholder: "e.g. Class 11 Chemistry, thermodynamics", "aria-label": "What to study", autocomplete: "off" });
    const v = await ui.popup({ title: "What do you want to study?", text: "A subject, a chapter, or both.", content: input,
      actions: [{ label: "Cancel", value: null, kind: "ghost" }, { label: "Next", value: "ok", kind: "primary" }], dismissValue: null });
    if(v !== "ok" || !input.value.trim()) return null;
    return input.value.trim();
  }

  async function askMinutes(goal){
    const av = D.planner.availableMinutes();
    const text = av.note ? `You have about ${av.minutes} minutes free ${av.note}.` : "Pick what feels doable. I'll fit the plan to it.";
    const opts = [25, 45, 60, 90].filter(m => m <= Math.max(25, av.minutes + 10));
    const v = await ui.popup({ title: "How long do you have?", text,
      actions: opts.map(m => ({ label: { 25: "25 min", 45: "45 min", 60: "1 hour", 90: "1.5 hours" }[m], value: m, kind: "ghost" }))
        .concat([{ label: "Whatever fits", value: "fit", kind: "primary" }]), dismissValue: null });
    if(v == null) return null;
    return v === "fit" ? Math.min(av.minutes, 60) : v;
  }

  async function start(goal){
    if(running){ say("I'm already planning something. One sec.", "THINKING"); return; }
    running = true;
    try{
      goal = Object.assign({ subject: "", level: "", topic: "", minutes: null, when: "today", raw: "" }, goal);
      if(!goal.subject && !goal.topic){
        const s = await askSubject(); if(!s){ say("No problem. Tell me whenever you're ready.", "IDLE"); return; }
        const g2 = ai.parseGoal("study " + s); goal.subject = g2.subject || ""; goal.emoji = g2.emoji; goal.level = goal.level || g2.level; goal.topic = goal.topic || g2.topic || (g2.subject ? "" : s);
        if(!goal.subject && !goal.topic) goal.topic = s;
      }
      if(!goal.emoji){ const sj = ai.subjectOf(goal.subject || goal.topic || ""); goal.emoji = sj ? sj.emoji : "📚"; }
      goal.urgent = /\b(exam|test|quiz|tomorrow|deadline|tonight)\b/i.test(goal.raw || "") || goal.urgent;
      if(!goal.minutes){
        goal.minutes = await askMinutes(goal); if(!goal.minutes){ say("Okay, we can plan it later.", "IDLE"); return; }
      }

      const name = [goal.level, goal.subject, goal.topic].filter(Boolean).join(" ");
      D.emotion.setState("THINKING");
      D.app.showSubtitle(`Looking for good ${name} material…`);
      await D.require("research");
      const found = await D.research.find(goal);
      D.emotion.setState("IDLE");

      const picked = await D.cards.pick(found.resources, {
        title: "Pick your material",
        intro: found.mode === "web" ? `Here's what I found for ${name || "your topic"}. Choose what you want to use.` : (found.note || "Choose what you want to use."),
      });
      if(!picked){ say("Okay. Ask me again whenever you want to plan.", "IDLE"); return; }
      D.research.remember(picked.chosen, goal);

      D.app.showSubtitle("Building your plan…");
      const plan = D.planner.build({ goal, resources: picked.chosen });
      const s = D.session.create({ goal, resources: picked.chosen, plan });
      say(`Here's a ${plan.totalMin}-minute plan.`, "HAPPY");
      D.session.open(s.id);
    }catch(e){
      console.error(e);
      D.emotion.setState("IDLE");
      say("Something went wrong while planning. Want to try again?", "CONFUSED");
    }finally{ running = false; }
  }

  window.DABSy.agent = { start };
})();
