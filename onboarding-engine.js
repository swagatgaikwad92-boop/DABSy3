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
    /* ---- v10.2: wallpapers, Day/Night, habitats, widgets, Study Mode, typing ---- */
    { title: "Choose a wallpaper", text: "Open Settings → Wallpaper and tap a room: Cosy bed, Study desk, Moonlit window nook or Lakeside. It applies straight away and a tick marks the one you picked. It is remembered next time.", visual: "wall" },
    { title: "Back to the black screen", text: "In Settings → Wallpaper, tap Black screen to return to the original look: just my eyes and bow tie on black. Your other settings stay as they are.", visual: "black" },
    { title: "Day or Night", text: "Tap the sun or moon at the top left, or use Settings → Day / Night. The whole app and your room switch together. Night is the default and it never changes by itself. Auto, which follows your phone, only applies if you choose it.", visual: "daynight" },
    { title: "Where I sit", text: "Each room gives me a real place to rest: the pillow, the desk or a warm rock by the lake. Switching rooms moves me there. If you like, Settings → Wallpaper → Wandering lets me visit the room's other spots now and then. By default I stay put.", visual: "habitat" },
    { title: "Add a glass widget", text: "Settings → Widgets → Add widget. Choose time and date, weather, today's to-dos, today's study, up next, or focus. They show your real information only. Weather asks for your location first and says so if it can't load.", visual: "glass" },
    { title: "Make a widget yours", text: "Double-tap a widget to change its shape (rounded, pill, circle, blob, leaf), size and tint. Drag it to move it above me. Remove it there, and bring it back later from Add widget exactly as you left it.", visual: "shapes" },
    { title: "The double-tap glow", text: "Double-tap a widget and a soft glass bloom spreads from your finger, light slides across the surface and it ripples back to rest. Then its details open. With Reduce motion on, you get a quick fade instead.", visual: "bloom" },
    { title: "Study Mode, simplified", text: "Explanations now read like one clean page: headings, definitions and formulas in order. Only a real step-by-step procedure appears one step at a time as I read it, and Show all steps reveals the rest. I wait compactly at the top.", visual: "page" },
    { title: "Typing with the keyboard", text: "The chat box rides just above the keyboard. I step up out of the way and the widgets tuck away while you type, then everything returns when you are done.", visual: "kb" },
    { title: "The gestures that matter", text: "Tap an eye: chat. Tap the bow tie: play. Double-tap the bow tie: apps. Hold: tasks. Stroke me: I like that. Every one has a button or key alternative." },
    { title: "Where Settings lives", text: "Double-tap my bow tie, then Settings. You can replay this tour any time from Settings → Help & Tutorial → Replay Tutorial. Replaying never changes your choices.", last: true },
  ];

  const VIS = {
    wall: '<div class="tv tv-row"><i class="tv-tile" style="--a:#f3e1cc;--b:#e5b9c9"></i><i class="tv-tile on" style="--a:#1f2a5c;--b:#5b4aa0"><b>✓</b></i><i class="tv-tile" style="--a:#bfe3ff;--b:#9ed39a"></i></div>',
    black: '<div class="tv tv-row"><i class="tv-tile" style="--a:#0a0c12;--b:#0a0c12"><u class="tv-eyes"></u></i></div>',
    daynight: '<div class="tv tv-row"><i class="tv-orb sun"></i><i class="tv-switch"><u></u></i><i class="tv-orb moon"></i></div>',
    habitat: '<div class="tv tv-row"><div class="tv-room"><i class="tv-pillow"></i><u class="tv-dab"></u></div></div>',
    glass: '<div class="tv tv-row tv-sky"><i class="tv-glass" style="width:92px;height:48px;border-radius:18px"></i></div>',
    shapes: '<div class="tv tv-row tv-sky"><i class="tv-glass" style="width:50px;height:38px;border-radius:14px"></i><i class="tv-glass" style="width:64px;height:30px;border-radius:99px"></i><i class="tv-glass" style="width:42px;height:42px;border-radius:50%"></i><i class="tv-glass" style="width:50px;height:42px;border-radius:58% 42% 55% 45%/47% 57% 43% 53%"></i><i class="tv-glass" style="width:46px;height:40px;border-radius:46% 10% 46% 10%"></i></div>',
    bloom: '<div class="tv tv-row tv-sky"><i class="tv-glass bloom" style="width:96px;height:52px;border-radius:20px"><u></u></i></div>',
    page: '<div class="tv tv-page"><b></b><s></s><s></s><em></em><s class="short"></s></div>',
    kb: '<div class="tv tv-kb"><i class="tv-bar"></i><i class="tv-keys"></i></div>',
  };
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
      window.DABSy.stickers ? window.DABSy.stickers.el(window.DABSy.stickers.names[idx % window.DABSy.stickers.names.length], 44) : null,
      el("div", { class: "tour-step" }, `${idx + 1} of ${STEPS.length}`),
      el("h2", {}, s.title), el("p", {}, s.text),
      s.visual ? el("div", { class: "tour-visual", "aria-hidden": "true", html: VIS[s.visual] || "" }) : null,
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
