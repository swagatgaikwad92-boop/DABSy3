/* ============================================================
   D.A.B.S.y — onboarding-engine.js : the tiny tour
   Rules
     - maybeOffer() runs on first launch of a fresh install only
       (boot.js decides). It is recorded as "offered" the moment it is
       shown, so a reload, an update or a dismissal never brings it back.
     - Settings → Help & Tutorial → Replay Tutorial calls start({replay:true}).
     - Covers only: tap, double-tap apps, assistant, tasks & reminders,
       Study Space + planning, picking material, key gestures, Settings.
   State: dabsy_onboarding_v1 = { tutorialCompleted, offeredAt, outcome }
   ============================================================ */
(function(){
  const D = window.DABSy;
  const ui = D.ui, el = ui.el, bus = D.bus;
  const KEY = "onboarding_v1";
  const read = () => D.memory.read(KEY, null);
  const write = p => D.memory.write(KEY, Object.assign({}, read() || {}, p));

  const STEPS = [
    { title: "Tap me", text: "A single tap and I react to what's going on: what's due next, the time of day, where you touched.",
      demo: { label: "Tap for me", run: () => bus.emit("face:tap", { count: 1, region: "body" }) } },
    { title: "Tap an eye to chat", text: "Tap either eye and the chat box opens straight away. Tap the bow tie and I do a little spin.",
      demo: { label: "Show me", run: () => { D.app.openCommand(false); setTimeout(() => D.app.closeCommand(), 3200); } } },
    { title: "Double-tap for your apps", text: "Double-tap and bubbles float out: Study Space, Ghibli Calendar, SolveCount and Settings. No double-tap? Turn on the on-screen buttons in Settings → Accessibility.",
      demo: { label: "Show me", run: () => { D.ecosystem.open(); setTimeout(() => D.ecosystem.close(), 2600); } } },
    { title: "Talk to me", text: "Tap an eye, or tap the Talk button, to type or speak. Try \"I want to study chemistry\" or \"remind me to submit my assignment\".",
      demo: { label: "Show me", run: () => { D.app.openCommand(false); setTimeout(() => D.app.closeCommand(), 3200); } } },
    { title: "Tasks and reminders", text: "Press and hold me to see your tasks and reminders. Tasks stay alive. If one is due I'll ask whether to start it, move it, or skip it. If it slips I offer a new slot. Ignore me and I back off. Everything lands in the bell at the top.", highlight: "#bell-btn" },
    { title: "Studying with me", text: "Tell me what you want to study and for how long. I look for real material, you pick what you like, I plan the time around it, and I can send the plan to Study Space." },
    { title: "Picking material", text: "You'll see one card at a time. Swipe right to choose, left to skip, or use the Choose and Skip buttons. Undo is always there." },
    { title: "The gestures that matter", text: "Tap an eye: chat. Tap the bow tie: play. Double-tap: apps. Hold: tasks. Stroke me: I like that. Every one has a button or key alternative." },
    { title: "Where Settings lives", text: "Double-tap me, then Settings. You can replay this tour any time from Settings → Help & Tutorial.", last: true },
  ];

  let root = null, idx = 0, release = null;

  function maybeOffer(){
    const st = read(); if(st && st.tutorialCompleted) return;
    write({ tutorialCompleted: true, offeredAt: Date.now(), outcome: "offered" });
    ui.popup({ title: "Want a tiny tour of what I can do?", text: "It takes about a minute. You can replay it later from Settings.",
      actions: [{ label: "Skip", value: "skip", kind: "ghost" }, { label: "Take the tour", value: "go", kind: "primary" }], dismissValue: "skip" })
      .then(v => { if(v === "go") start({ replay: false }); else write({ outcome: "skipped" }); });
  }

  function start(o){
    if(root) return;
    idx = 0;
    document.body.classList.add("touring");
    root = el("div", { id: "tour", role: "dialog", "aria-label": "Tour" });
    document.body.append(root);
    release = ui.trapFocus(root, () => finish("skipped"));
    render();
  }

  function render(){
    document.querySelectorAll(".tour-hl").forEach(n => n.classList.remove("tour-hl"));
    const s = STEPS[idx];
    if(s.highlight){ const n = document.querySelector(s.highlight); n && n.classList.add("tour-hl"); }
    root.innerHTML = "";
    const dots = el("div", { class: "tour-dots", "aria-hidden": "true" }, STEPS.map((_, i) => el("i", { class: i === idx ? "on" : "" })));
    const card = el("div", { class: "tour-card" },
      el("div", { class: "tour-step" }, `${idx + 1} of ${STEPS.length}`),
      el("h2", {}, s.title), el("p", {}, s.text),
      s.demo ? el("button", { class: "btn sm", type: "button", onclick: s.demo.run }, s.demo.label) : null,
      dots,
      el("div", { class: "popup-actions" },
        el("button", { class: "btn ghost", type: "button", onclick: () => finish("skipped") }, "Skip"),
        idx > 0 ? el("button", { class: "btn ghost", type: "button", onclick: () => { idx--; render(); } }, "Back") : null,
        el("button", { class: "btn primary", type: "button", onclick: () => { if(s.last) finish("completed"); else { idx++; render(); } } }, s.last ? "Done" : "Next")));
    root.append(card);
    ui.announce(`${s.title}. Step ${idx + 1} of ${STEPS.length}.`);
    card.querySelector(".btn.primary").focus({ preventScroll: true });
  }

  function finish(outcome){
    if(!root) return;
    document.querySelectorAll(".tour-hl").forEach(n => n.classList.remove("tour-hl"));
    document.body.classList.remove("touring");
    D.ecosystem.close(); D.app.closeCommand();
    release && release(); release = null;
    root.remove(); root = null;
    write({ tutorialCompleted: true, outcome, completedAt: Date.now() });
    if(outcome === "completed") D.director.dispatch("SUCCESS_MOMENT", { speakText: "That's all. Just ask if you forget something." });
  }

  window.DABSy.onboarding = { maybeOffer, start, state: read };
})();
