/* ============================================================
   D.A.B.S.y — study-session.js : the guided session
   Runs a plan from planner-engine block by block with a wall-clock timer
   (survives reloads and throttled background tabs), keeps DABSy small
   and quiet in the corner, answers doubts in context, runs a recall
   check, and hands a summary back to learning + tasks + Study Space.

   Public API
     session.create({goal, resources, plan}) -> session
     session.open(id, {autostart})           overview, or the live dock if running
     session.start/pause/resume/skipBlock/finishBlock/finish
     session.startQuick(task)                a single focus block for any task
     session.resumeActive()                  pick up a session after a reload
     session.handleUtterance(text)           in-session voice/typing
     session.sendToStudySpace(id)
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const ui = window.DABSy.ui;
  const tasks = window.DABSy.tasks;
  const learning = window.DABSy.learning;
  const bridge = window.DABSy.bridge;
  const director = window.DABSy.director;
  const KEY = "sessions_v1";
  const KIND = { learn: "Learn", practice: "Practice", notes: "Notes", break: "Break", recall: "Recall" };

  let list = memory.read(KEY, []);
  const save = () => memory.write(KEY, list.slice(-20));
  const get = id => list.find(s => s.id === id) || null;
  let activeId = null, timer = null, wake = null, dock = null, askRow = null;
  const active = () => (activeId ? get(activeId) : null);

  /* ---------------- creation ---------------- */
  function create({ goal, resources, plan }){
    const s = {
      id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      goal, resources: resources || [], plan, status: "prepared", createdAt: Date.now(), startedAt: null, run: null, outcomes: [], taskId: null,
    };
    const t = tasks.add({
      title: [goal.subject ? goal.subject.replace(/^./, c => c.toUpperCase()) : "Study", goal.topic].filter(Boolean).join(": ") || "Study session",
      subject: goal.subject || "", emoji: goal.emoji || "📚", category: "study", durationMin: plan.totalMin, priority: goal.urgent ? "high" : "normal",
      sessionId: s.id, source: "agent", dueAt: goal.startAt || null,
    });
    s.taskId = t.id;
    list.push(s); save();
    return s;
  }

  /* ---------------- runtime ---------------- */
  function workMinutesDone(s){ return s.outcomes.filter(o => o.status === "done" && o.kind !== "break").reduce((a, o) => a + (o.actualMin || 0), 0); }

  async function lockScreen(){
    try{ if(navigator.wakeLock && document.visibilityState === "visible") wake = await navigator.wakeLock.request("screen"); }catch(e){}
  }
  function unlockScreen(){ try{ wake && wake.release(); }catch(e){} wake = null; }
  document.addEventListener("visibilitychange", () => { if(activeId && document.visibilityState === "visible"){ tick(); if(!wake) lockScreen(); } });

  function start(id){
    const s = get(id); if(!s) return;
    if(active() && activeId !== id) finish(true);
    activeId = id;
    s.status = "active"; s.startedAt = Date.now(); s.outcomes = []; save();
    tasks.start(s.taskId, ui.dateKey());
    document.body.classList.add("session-active");
    bus.emit("session:started", { id });
    window.DABSy.emotion.setState("STUDY_FOCUS");
    window.DABSy.app.closeCommand();
    lockScreen();
    mountDock();
    beginBlock(0);
    clearInterval(timer); timer = setInterval(tick, 1000);
    director.dispatch("SUCCESS_MOMENT", { speakText: "Let's go. I'll stay out of your way." });
  }

  function beginBlock(i){
    const s = active(); if(!s) return;
    const b = s.plan.blocks[i]; if(!b){ return finish(false); }
    s.run = { idx: i, endsAt: Date.now() + b.minutes * 60000, paused: false, remainMs: b.minutes * 60000, startedAt: Date.now() };
    save(); renderDock();
    bus.emit("session:block", { id: s.id, index: i, block: b });
    if(b.kind === "break") window.DABSy.emotion.setState("HAPPY", { silent: true }); else window.DABSy.emotion.setState("STUDY_FOCUS");
    if(b.kind === "recall") openRecall(s, b);
    publishProgress(s);
  }

  function remainingMs(s){ return !s.run ? 0 : (s.run.paused ? s.run.remainMs : Math.max(0, s.run.endsAt - Date.now())); }
  function tick(){
    const s = active(); if(!s || !s.run) return;
    if(!s.run.paused && remainingMs(s) <= 0){ completeBlock(false); return; }
    renderDock(true);
  }

  function completeBlock(manual){
    const s = active(); if(!s) return;
    const b = s.plan.blocks[s.run.idx];
    const actual = Math.max(1, Math.round((Date.now() - s.run.startedAt - 0) / 60000));
    s.outcomes.push({ blockId: b.id, kind: b.kind, status: "done", actualMin: manual ? Math.min(actual, b.minutes) : b.minutes });
    save();
    const next = s.plan.blocks[s.run.idx + 1];
    if(b.kind !== "break") director.dispatch("BLOCK_DONE", { speakText: null });
    if(!next){ finish(false); return; }
    announceTransition(b, next);
    beginBlock(s.run.idx + 1);
  }
  function announceTransition(b, next){
    const cheer = memory.getSettings().cheer;
    let text = "";
    if(next.kind === "break") text = cheer ? "Nice block. Take a proper break." : "Break time.";
    else if(b.kind === "break") text = "Break's over. Next: " + next.title;
    else if(next.kind === "recall") text = "Last part: a quick recall check.";
    else text = cheer ? "Good. On to the next one." : "Next block.";
    const nr = next.resourceId && active() && active().resources.find(x => x.id === next.resourceId);
    const sendAct = nr && (nr.type === "video" || nr.type === "pdf") ? [{ label: "Open in Study Space", primary: true, onClick: () => sendResourceToStudySpace(active().id, nr.id) }] : undefined;
    ui.toast({ title: KIND[next.kind] + " · " + next.minutes + " min", text, timeout: sendAct ? 12000 : 5000, actions: sendAct });
    if(document.visibilityState !== "visible") window.DABSy.notify.ping({ title: KIND[next.kind] + " · " + next.minutes + " min", body: text });
    ui.vibrate(30);
  }

  function skipBlock(){
    const s = active(); if(!s) return;
    const b = s.plan.blocks[s.run.idx];
    s.outcomes.push({ blockId: b.id, kind: b.kind, status: "skipped", actualMin: 0 }); save();
    const next = s.plan.blocks[s.run.idx + 1];
    if(!next) return finish(false);
    beginBlock(s.run.idx + 1);
  }
  const finishBlock = () => completeBlock(true);
  function pause(){ const s = active(); if(!s || s.run.paused) return; s.run.remainMs = Math.max(0, s.run.endsAt - Date.now()); s.run.paused = true; save(); unlockScreen(); renderDock(); }
  function resume(){ const s = active(); if(!s || !s.run.paused) return; s.run.endsAt = Date.now() + s.run.remainMs; s.run.paused = false; save(); lockScreen(); renderDock(); }

  function finish(silent){
    const s = active(); if(!s) return;
    clearInterval(timer); timer = null; unlockScreen();
    const done = workMinutesDone(s);
    s.status = done >= 5 ? "done" : "cancelled"; s.endedAt = Date.now(); s.run = null; save();
    activeId = null;
    document.body.classList.remove("session-active");
    unmountDock();
    window.DABSy.emotion.setState("IDLE");
    bus.emit("session:ended", { id: s.id });
    if(s.status === "done"){
      tasks.complete(s.taskId, ui.dateKey());
      learning.recordSession({ subject: s.goal.subject, plannedMin: s.plan.totalMin, doneMin: done, blocksDone: s.outcomes.filter(o => o.status === "done" && o.kind !== "break").length, blocksTotal: s.plan.blocks.filter(b => b.kind !== "break").length, blockMin: avgBlock(s) });
      bus.emit("session:finished", { id: s.id, doneMin: done });
      publishProgress(s, "done");
      if(!silent) summary(s, done);
    } else if(!silent){
      director.dispatch("DABSY_REPLY", { speakText: "Okay, stopped. No worries, we can pick it up later." });
      tasks.reopen(s.taskId, ui.dateKey());
    }
  }
  const avgBlock = s => { const w = s.plan.blocks.filter(b => b.kind === "learn" || b.kind === "practice"); return w.length ? Math.round(w.reduce((a, b) => a + b.minutes, 0) / w.length) : null; };

  /* ---------------- dock UI (small, bottom, glass) ---------------- */
  function mountDock(){
    if(dock) return;
    dock = ui.el("section", { id: "session-dock", "aria-label": "Study session" },
      ui.el("div", { class: "sd-top" },
        ui.el("div", { class: "sd-ring" }, ui.el("span", { html: '<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" class="bg"/><circle cx="22" cy="22" r="19" class="fg" id="sd-arc"/></svg>' }), ui.el("span", { id: "sd-time", role: "timer" }, "--:--")),
        ui.el("div", { class: "sd-info" }, ui.el("div", { id: "sd-kind", class: "sd-kind" }), ui.el("div", { id: "sd-title", class: "sd-title" }), ui.el("div", { id: "sd-step", class: "sd-step" })),
      ),
      ui.el("div", { class: "sd-actions" },
        ui.el("button", { class: "btn sm", id: "sd-pause", type: "button" }),
        ui.el("button", { class: "btn sm", id: "sd-skip", type: "button" }, "Skip"),
        ui.el("button", { class: "btn sm", id: "sd-ask", type: "button" }, "Ask"),
        ui.el("button", { class: "btn sm", id: "sd-more", type: "button" }, "Plan"),
        ui.el("button", { class: "btn sm danger", id: "sd-end", type: "button" }, "End")),
      askRow = ui.el("form", { class: "sd-ask", hidden: true, onsubmit: e => { e.preventDefault(); const i = askRow.querySelector("input"); const v = i.value.trim(); if(v){ i.value = ""; window.DABSy.app.handleUserUtterance(v); } } },
        ui.el("input", { type: "text", placeholder: "Ask a doubt…", "aria-label": "Ask a doubt", autocomplete: "off", enterkeyhint: "send" }),
        ui.el("button", { class: "icon-btn sm", type: "button", "aria-label": "Speak", html: ui.icon("mic", 18), onclick: () => document.getElementById("mic-btn").click() }),
        ui.el("button", { class: "btn sm primary", type: "submit" }, "Send")));
    document.body.append(dock);
    dock.querySelector("#sd-pause").onclick = () => { const s = active(); s && (s.run.paused ? resume() : pause()); };
    dock.querySelector("#sd-skip").onclick = () => skipBlock();
    dock.querySelector("#sd-ask").onclick = () => { askRow.hidden = !askRow.hidden; if(!askRow.hidden) askRow.querySelector("input").focus(); };
    dock.querySelector("#sd-more").onclick = () => { const s = active(); s && overview(s); };
    dock.querySelector("#sd-end").onclick = async () => {
      const v = await ui.popup({ title: "End this session?", text: "I'll keep what you've done so far.", actions: [{ label: "Keep going", value: "no", kind: "ghost" }, { label: "End session", value: "yes", kind: "primary" }], dismissValue: "no" });
      if(v === "yes") finish(false);
    };
    ui.nextFrame().then(() => dock && dock.classList.add("in"));
  }
  function unmountDock(){ if(!dock) return; const d = dock; dock = null; d.classList.remove("in"); setTimeout(() => d.remove(), 300); }

  const mmss = ms => { const t = Math.ceil(ms / 1000); return ui.pad(Math.floor(t / 60)) + ":" + ui.pad(t % 60); };
  function renderDock(light){
    const s = active(); if(!s || !dock || !s.run) return;
    const b = s.plan.blocks[s.run.idx], rem = remainingMs(s);
    dock.querySelector("#sd-time").textContent = mmss(rem);
    const frac = 1 - rem / (b.minutes * 60000);
    dock.querySelector("#sd-arc").style.strokeDashoffset = String(119.4 * (1 - Math.max(0, Math.min(1, frac))));
    if(light) return;
    dock.dataset.kind = b.kind;
    dock.querySelector("#sd-kind").textContent = KIND[b.kind] + " · " + b.minutes + " min";
    dock.querySelector("#sd-title").textContent = b.title;
    const workIdx = s.plan.blocks.slice(0, s.run.idx + 1).length;
    dock.querySelector("#sd-step").textContent = `Step ${workIdx} of ${s.plan.blocks.length}` + (b.note ? " · " + b.note : "");
    const pb = dock.querySelector("#sd-pause"); pb.innerHTML = ui.icon(s.run.paused ? "play" : "pause", 16) + `<span>${s.run.paused ? "Resume" : "Pause"}</span>`;
    // material link for this block
    let link = dock.querySelector(".sd-link"); if(link) link.remove();
    const r = b.resourceId && s.resources.find(x => x.id === b.resourceId);
    let sb = dock.querySelector(".sd-ss"); if(sb) sb.remove();
    if(r){
      if(r.type === "video" || r.type === "pdf") dock.querySelector(".sd-info").append(ui.el("button", { class: "sd-link sd-ss", type: "button", onclick: () => sendResourceToStudySpace(s.id, r.id) }, "Open in Study Space"));
      dock.querySelector(".sd-info").append(ui.el("a", { class: "sd-link", href: r.url, target: "_blank", rel: "noopener noreferrer" }, "Open original ", ui.el("span", { html: ui.icon("external", 13) })));
    }
  }

  /* ---------------- overview (before / during) ---------------- */
  function overview(s){
    const sh = ui.sheet({ title: s.goal.subject ? s.goal.subject.replace(/^./, c => c.toUpperCase()) + (s.goal.topic ? ": " + s.goal.topic : "") : "Study session" });
    const body = sh.body;
    body.append(ui.el("p", { class: "hint" }, s.plan.rationale));
    const ol = ui.el("ol", { class: "plan-list" });
    s.plan.blocks.forEach((b, i) => {
      const r = b.resourceId && s.resources.find(x => x.id === b.resourceId);
      const cur = s.run && s.run.idx === i;
      const done = s.outcomes.find(o => o.blockId === b.id);
      ol.append(ui.el("li", { class: "plan-b k-" + b.kind + (cur ? " cur" : "") + (done ? " done" : "") },
        ui.el("span", { class: "pb-min" }, b.minutes + "′"),
        ui.el("div", { class: "pb-main" }, ui.el("div", { class: "t" }, b.title), ui.el("div", { class: "s" }, KIND[b.kind] + (b.note ? " · " + b.note : "")),
          r ? ui.el("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", class: "pb-link" }, r.source + " ↗") : null,
          r && (r.type === "video" || r.type === "pdf") ? ui.el("button", { class: "btn sm", type: "button", onclick: () => { sendResourceToStudySpace(s.id, r.id); } }, "Open in Study Space") : null)));
    });
    body.append(ol);
    const st = bridge ? bridge.status(s.id) : "none";
    const ssRow = ui.el("div", { class: "row" }, ui.el("span", { html: ui.icon("book", 22) }),
      ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, "Study Space"), ui.el("div", { class: "s", id: "ss-status" }, ssText(st, s.id))),
      ui.el("button", { class: "btn sm", type: "button", onclick: async () => { await sendToStudySpace(s.id); sh.body.querySelector("#ss-status").textContent = ssText(bridge.status(s.id), s.id); } }, st === "none" ? "Send" : "Resend"));
    body.append(ssRow);
    const acts = ui.el("div", { class: "popup-actions" });
    if(s.status === "prepared"){
      acts.append(
        ui.el("button", { class: "btn", type: "button", onclick: () => { sh.close(); scheduleLater(s); } }, "Schedule for later"),
        ui.el("button", { class: "btn primary", type: "button", onclick: () => { sh.close(); start(s.id); } }, "Start now"));
    } else if(s.status === "active"){
      acts.append(ui.el("button", { class: "btn primary", type: "button", onclick: () => sh.close() }, "Back to session"));
    }
    body.append(acts);
    return sh;
  }
  const ssText = (st, id) => bridge.describe(id);

  // All send paths call bridge.* synchronously (before any await) so the browser allows the Study Space window.
  function sendResourceToStudySpace(id, resourceId){
    const s = get(id); if(!s) return { ok: false };
    const r = s.resources.find(x => x.id === resourceId); if(!r) return { ok: false };
    const res = bridge.sendResource(s, r);
    if(!res.ok && res.error === "not-supported"){ ui.toast({ text: res.detail, timeout: 5000 }); try{ window.open(r.url, "_blank", "noopener,noreferrer"); }catch(e){} }
    return res;
  }
  function sendNextToStudySpace(id){
    const s = get(id); if(!s) return { ok: false };
    const r = bridge.firstSendable(s);
    if(!r){ ui.toast({ text: "None of the chosen material is a video or PDF that Study Space can open. Use the links in the plan.", timeout: 6000 }); return { ok: false, error: "no-resource" }; }
    return sendResourceToStudySpace(id, r.id);
  }
  async function sendToStudySpace(id){ const r = sendNextToStudySpace(id); return !!r.ok; }

  /* ---- reacting to what Study Space reports ---- */
  const announced = {};
  const failedIds = {};
  bus.on("bridge:state", r => {
    const s = get(r.sessionId); if(!s) return;
    const el = document.getElementById("ss-status"); if(el && (activeId === s.id || true)) el.textContent = bridge.describe(s.id);
    const key = r.requestId + ":" + r.state; if(announced[key]) return; announced[key] = 1;
    const title = r.title ? "“" + r.title.slice(0, 40) + "”" : "The resource";
    if(r.state === "opened") ui.toast({ text: title + " is open in Study Space.", timeout: 3500 });
    else if(r.state === "sent" && r.via === "broadcast") ui.toast({ text: "Sent to your open Study Space tab. Switch to it to study.", timeout: 5000 });
    else if(r.state === "blocked") ui.toast({ text: "Your browser blocked the Study Space window.", timeout: 12000, actions: [{ label: "Open Study Space", primary: true, onClick: () => bridge.manualOpen(r.requestId) }] });
    else if(r.state === "unconfirmed") ui.toast({ text: r.detail, timeout: 10000, actions: [{ label: "Open original", onClick: () => window.open(r.url, "_blank", "noopener,noreferrer") }, { label: "Resend", primary: true, onClick: () => sendResourceToStudySpace(s.id, r.resourceId) }] });
    else if(r.state === "failed"){
      failedIds[s.id] = (failedIds[s.id] || []).concat(r.resourceId);
      const alt = s.resources.find(x => (x.type === "video" || x.type === "pdf") && !failedIds[s.id].includes(x.id));
      const actions = [{ label: "Open original", onClick: () => window.open(r.url, "_blank", "noopener,noreferrer") }];
      if(alt) actions.push({ label: "Try " + (alt.type === "video" ? "another video" : "another PDF"), primary: true, onClick: () => sendResourceToStudySpace(s.id, alt.id) });
      else actions.push({ label: "Find another", primary: true, onClick: () => findAlternative(s) });
      ui.toast({ title: "Couldn't open it", text: r.detail || "Study Space couldn't open that resource.", timeout: 15000, actions });
    }
  });

  async function findAlternative(s){
    try{
      await window.DABSy.require("research"); await window.DABSy.require("cards");
      window.DABSy.app.showSubtitle("Looking for another resource…");
      const used = new Set(s.resources.map(r => r.url));
      const found = await window.DABSy.research.find(s.goal);
      const fresh = Object.assign({}, found, { resources: found.resources.filter(r => !used.has(r.url) && r.origin === "search") });
      if(!fresh.resources.length){ ui.toast({ text: "I couldn't find another resource that fits.", timeout: 6000 }); return; }
      const picked = await window.DABSy.cards.recommend(fresh, { minutes: s.goal.minutes || s.plan.totalMin, title: "Another option", intro: "These weren't in your plan yet." });
      if(!picked || !picked.chosen.length) return;
      const r = picked.single || picked.chosen[0];
      s.resources.push(r); save();
      sendResourceToStudySpace(s.id, r.id);
    }catch(e){ ui.toast({ text: "I couldn't search again right now.", timeout: 5000 }); }
  }
  function publishProgress(s, status){ /* Study Space owns its own progress; DABSy only reads it */ }

  async function scheduleLater(s){
    const slots = tasks.findSlots({ durationMin: s.plan.totalMin, days: 3, count: 3 });
    if(!slots.length){ ui.toast({ text: "I couldn't find a free slot soon. You can start it whenever you like." }); return; }
    const c = await ui.popup({ title: "When shall we study?", text: "Free in your schedule:", actions: slots.map((x, i) => ({ label: x.label, value: i, kind: i === 0 ? "primary" : "ghost" })).concat([{ label: "Not now", value: "no", kind: "ghost" }]), dismissValue: "no" });
    if(c === "no" || c == null) return;
    tasks.update(s.taskId, { dueAt: slots[c].start.toISOString() });
    director.dispatch("SUCCESS_MOMENT", { speakText: "Booked for " + slots[c].label + ". I'll remind you." });
    window.DABSy.notify.enableSystem && window.DABSy.notify.settings().system === false && ("Notification" in window) && Notification.permission === "default" && setTimeout(() => window.DABSy.notify.enableSystem(), 1500);
  }

  /* ---------------- recall check ---------------- */
  async function openRecall(s, b){
    const g = s.goal, topic = g.topic || g.subject || "what you studied";
    let qs = null;
    if(window.DABSy.ai.status() === "ready"){
      const o = await window.DABSy.ai.askJSON({ task: "recall", prompt: `Write 3 short recall questions for a student who just studied "${topic}" (${g.subject || "general"}${g.level ? ", " + g.level : ""}). Include a one-line model answer for each. Respond ONLY with JSON: {"questions":[{"q":"","a":""}]}` });
      if(o && Array.isArray(o.questions) && o.questions.length) qs = o.questions.slice(0, 3);
    }
    const generic = !qs;
    if(!qs) qs = [{ q: `What are the 3 most important ideas in ${topic}?`, a: "" }, { q: "Explain one of them as if you're teaching a friend.", a: "" }, { q: "What is one thing you're still unsure about?", a: "" }];
    const sh = ui.sheet({ title: "Recall check", className: "recall" });
    sh.body.append(ui.el("p", { class: "hint" }, generic ? "Answer out loud or on paper first, then mark how it went." : "Answer first, then reveal and mark how it went."));
    let got = 0, miss = 0;
    qs.forEach(q => {
      const card = ui.el("div", { class: "row recall-q" }, ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, q.q)));
      const ans = q.a ? ui.el("div", { class: "s", hidden: true }, q.a) : null;
      const btns = ui.el("div", { class: "sd-actions" },
        q.a ? ui.el("button", { class: "btn sm", type: "button", onclick: () => { ans.hidden = false; } }, "Reveal") : null,
        ui.el("button", { class: "btn sm primary", type: "button", onclick: e => { got++; e.target.closest(".recall-q").classList.add("answered"); } }, "Got it"),
        ui.el("button", { class: "btn sm", type: "button", onclick: e => { miss++; e.target.closest(".recall-q").classList.add("answered"); } }, "Not sure"));
      card.firstChild.append(ans || "", btns);
      sh.body.append(card);
    });
    sh.closed.then(() => { s.recall = { got, miss }; save(); if(miss > got) learning.recordFeedback(g.subject, "hard", null); else if(got === qs.length) learning.recordFeedback(g.subject, "easy", null); });
  }

  /* ---------------- summary + follow-up ---------------- */
  function summary(s, done){
    const sh = ui.sheet({ title: "Nice work" });
    const worked = s.outcomes.filter(o => o.kind !== "break" && o.status === "done").length;
    sh.body.append(ui.el("div", { class: "row" }, ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, done + " minutes of focus"), ui.el("div", { class: "s" }, `${worked} block${worked === 1 ? "" : "s"} done`
      + (s.recall ? ` · recall: ${s.recall.got} remembered, ${s.recall.miss} to revisit` : "")))));
    sh.body.append(ui.el("div", { class: "section-title" }, "How did the length feel?"));
    const fb = ui.el("div", { class: "popup-actions", style: "justify-content:flex-start" });
    [["Too short", "short"], ["Just right", "good"], ["Too long", "long"]].forEach(([l, k]) => fb.append(ui.el("button", { class: "btn sm", type: "button", onclick: e => { learning.recordFeedback(s.goal.subject, k, avgBlock(s)); [...fb.children].forEach(c => c.classList.remove("primary")); e.currentTarget.classList.add("primary"); } }, l)));
    sh.body.append(fb);
    sh.body.append(ui.el("div", { class: "section-title" }, "Follow up"));
    sh.body.append(ui.el("div", { class: "row" }, ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, "Quick recall tomorrow"), ui.el("div", { class: "s" }, "A short 10-minute revisit makes it stick.")),
      ui.el("button", { class: "btn sm primary", type: "button", onclick: e => { addFollowUp(s); e.currentTarget.disabled = true; e.currentTarget.textContent = "Added"; } }, "Add")));
    sh.body.append(ui.el("div", { class: "popup-actions" }, ui.el("button", { class: "btn primary", type: "button", onclick: () => sh.close() }, "Done")));
    director.dispatch("STUDY_SESSION_GOOD", { speakText: "That was a solid session." });
  }
  function addFollowUp(s){
    const d = new Date(); d.setDate(d.getDate() + 1);
    const hrs = learning.usualHours(); const h = hrs.length ? hrs[0] : 18;
    d.setHours(h, 0, 0, 0);
    tasks.add({ title: "Recall: " + (s.goal.topic || s.goal.subject || "last session"), subject: s.goal.subject || "", emoji: s.goal.emoji || "🧠", category: "study", durationMin: 10, dueAt: d.toISOString(), source: "follow-up" });
    ui.toast({ text: "Added a 10-minute recall for tomorrow at " + ui.fmtTime(d) + "." });
  }

  /* ---------------- in-session conversation ---------------- */
  async function handleUtterance(text){
    const s = active(); if(!s) return false;
    const t = text.toLowerCase();
    if(/\b(pause|hold on|wait)\b/.test(t) && t.length < 30){ pause(); window.DABSy.app.say("Paused.", "IDLE"); return true; }
    if(/\b(resume|continue|go on|carry on)\b/.test(t) && t.length < 30){ resume(); window.DABSy.app.say("Back to it.", "FOCUSED"); return true; }
    if(/\b(skip|next block)\b/.test(t) && t.length < 30){ skipBlock(); return true; }
    if(/\b(i'?m done|finished|stop|end session)\b/.test(t) && t.length < 30){ finish(false); return true; }
    if(/(time|long).*(left|remain)|how much time/.test(t)){ say("remaining"); return true; }
    const b = s.plan.blocks[s.run.idx];
    const r = await window.DABSy.ai.askDABSy(text, { task: "doubt", context: `The student is mid-study: ${s.goal.subject || "general"}${s.goal.level ? " (" + s.goal.level + ")" : ""}, current block "${b.title}". Answer in at most 4 short sentences, then stop.` });
    window.DABSy.app.say(r.text, r.ok ? "FOCUSED" : "CONFUSED");
    return true;
  }
  function say(what){
    const s = active(); if(!s) return;
    if(what === "remaining"){ const m = Math.ceil(remainingMs(s) / 60000); window.DABSy.app.say(`${m} minute${m === 1 ? "" : "s"} left in this block.`, "FOCUSED"); }
  }

  /* ---------------- misc entry points ---------------- */
  function open(id, o){
    const s = get(id); if(!s){ ui.toast({ text: "I couldn't find that session." }); return; }
    if(o && o.autostart && s.status === "prepared") return start(id);
    if(s.status === "active" && activeId !== id) return resumeActive();
    return overview(s);
  }
  function startQuick(task){
    const mins = Math.max(10, task.durationMin || 25);
    const plan = { totalMin: mins, blocks: [{ id: "q1", kind: "learn", title: task.title, minutes: mins, note: "" }], rationale: `One focus block of ${mins} minutes for "${task.title}".` };
    const s = create({ goal: { subject: task.subject || "", emoji: task.emoji, topic: "" }, resources: [], plan });
    // the quick session reuses the task it was started from instead of creating a duplicate
    tasks.remove(s.taskId); s.taskId = task.id; save();
    start(s.id);
  }
  function resumeActive(){
    const s = list.find(x => x.status === "active" && x.run); if(!s) return false;
    activeId = s.id;
    document.body.classList.add("session-active");
    bus.emit("session:started", { id: s.id });
    mountDock(); renderDock(); clearInterval(timer); timer = setInterval(tick, 1000); lockScreen(); tick();
    return true;
  }
  const listAll = () => list.slice().reverse();

  bus.on("bridge:ack", () => { const o = document.getElementById("ss-status"); if(o && activeId){ o.textContent = ssText(bridge.status(activeId), activeId); } });
  bus.on("memory:wiped", () => { list = []; if(activeId){ activeId = null; clearInterval(timer); unlockScreen(); document.body.classList.remove("session-active"); unmountDock(); } });

  window.DABSy.session = { create, open, start, pause, resume, skipBlock, finishBlock, finish, startQuick, resumeActive, handleUtterance, sendToStudySpace, sendResourceToStudySpace, sendNextToStudySpace, findAlternative, say, get, listAll, overview, isActive: () => !!activeId };
})();
