/* ============================================================
   D.A.B.S.y — app.js : the conductor
   Wires command mode (type / talk), voice, intent routing, the agent
   flow, scheduling conversations and the glue between engines.
   v6 conversation flows (calendar conflicts, category questions,
   Suggest/Automatic permission levels) are preserved.
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const emotion = window.DABSy.emotion;
  const memory = window.DABSy.memory;
  const schedule = window.DABSy.schedule;
  const tasks = window.DABSy.tasks;
  const voice = window.DABSy.voice;
  const ai = window.DABSy.ai;
  const ui = window.DABSy.ui;
  const director = window.DABSy.director;
  const DABSyCore = window.DABSyCore;

  const subtitle = document.getElementById("subtitle");
  const chatArea = document.getElementById("chat-area");
  const micBtn = document.getElementById("mic-btn");
  const textInput = document.getElementById("text-input");
  const chips = document.getElementById("cmd-chips");

  /* ---------------- subtitle (stays until you triple-tap it away) ---------------- */
  let subTaps = 0, subTimer = null;
  /* A reply is a small floating card: the text, plus — only when the reply intentionally carries them — actions.
     opts.actions : [{ label, primary?, onClick }]            buttons (Explain more, Retry, Use / Edit / Change, Yes / No …)
     opts.choices : { mode: "single"|"multi", options:[..], allowCustom }   tap a choice OR just type; both continue the same conversation */
  function showSubtitle(text, opts){
    opts = opts || {};
    subtitle.textContent = "";
    const body = document.createElement("div"); body.className = "sub-text"; body.textContent = text;
    subtitle.append(body);
    subtitle.classList.toggle("long", String(text).length > 170);
    subtitle.classList.toggle("has-actions", !!((opts.actions && opts.actions.length) || opts.choices));
    if(opts.choices) subtitle.append(renderChoices(opts.choices));
    if(opts.actions && opts.actions.length) subtitle.append(renderActions(opts.actions));
    subtitle.classList.add("visible");
    subtitle.scrollTop = 0;
    // tell screen readers which language this line is in (Hindi/Marathi are read badly with lang="en")
    const L = memory.getSettings().replyLang;
    subtitle.lang = /[\u0900-\u097F]/.test(text) ? (L === "mr" || (ai.detectLang && ai.detectLang(text) === "mr") ? "mr" : "hi") : "en";
  }
  function renderActions(list){
    const row = document.createElement("div"); row.className = "sub-actions";
    list.forEach(a => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = a.label; if(a.primary) b.className = "primary";
      b.addEventListener("click", ev => { ev.stopPropagation(); if(a.once !== false) row.querySelectorAll("button").forEach(x => { x.disabled = true; }); try{ a.onClick && a.onClick(); }catch(e){ console.error(e); } });
      row.append(b);
    });
    return row;
  }
  function renderChoices(c){
    const wrap = document.createElement("div"); wrap.className = "sub-choices"; wrap.setAttribute("role", c.mode === "multi" ? "group" : "radiogroup");
    const picked = new Set();
    const send = vals => { wrap.querySelectorAll("button").forEach(x => { x.disabled = true; }); handleUserUtterance(vals.join(", ")); };
    c.options.forEach(opt => {
      const label = typeof opt === "string" ? opt : opt.label;
      const b = document.createElement("button"); b.type = "button"; b.textContent = label;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", ev => {
        ev.stopPropagation();
        if(c.mode === "multi"){ if(picked.has(label)){ picked.delete(label); b.setAttribute("aria-pressed", "false"); } else { picked.add(label); b.setAttribute("aria-pressed", "true"); } done.hidden = picked.size === 0; }
        else send([typeof opt === "string" ? opt : (opt.value || opt.label)]);
      });
      wrap.append(b);
    });
    const done = document.createElement("button"); done.type = "button"; done.className = "primary"; done.textContent = "Done"; done.hidden = true;
    done.addEventListener("click", ev => { ev.stopPropagation(); send([...picked]); });
    if(c.mode === "multi") wrap.append(done);
    if(c.allowCustom !== false){ const h = document.createElement("span"); h.className = "sub-hint"; h.textContent = "or just type your answer"; wrap.append(h); }
    return wrap;
  }
  function hideSubtitle(){ subtitle.classList.remove("visible"); }
  subtitle.addEventListener("pointerdown", e => {
    if(e.target.closest && e.target.closest(".sub-actions,.sub-choices")) return;      // pressing a button is not a dismiss tap
    subTaps++; clearTimeout(subTimer); subTimer = setTimeout(() => { subTaps = 0; }, 600);
    if(subTaps >= 3){ subTaps = 0; hideSubtitle(); }
  });
  subtitle.title = "Triple-tap to dismiss";

  /* ---------------- command mode (long-press / button / ArrowUp) ---------------- */
  let dockTimer = null;
  function chipList(){
    const studying = document.body.classList.contains("session-active");
    if(studying) return [["Ask a doubt", "focus"], ["How long is left?", "How much time is left?"], ["Open my apps", "open apps"]];
    return [["Study something", "focus-study"], ["What's next?", "What's next?"], ["My day", "show my tasks"], ["Add a task", "focus-task"]];
  }
  function buildChips(){
    chips.innerHTML = "";
    chipList().forEach(([label, cmd]) => {
      chips.append(ui.el("button", { type: "button", onclick: () => {
        if(cmd === "focus") return textInput.focus();
        if(cmd === "focus-study"){ textInput.value = "I want to study "; textInput.focus(); return; }
        if(cmd === "focus-task"){ textInput.value = "Remind me to "; textInput.focus(); return; }
        handleUserUtterance(cmd);
      } }, label));
    });
  }
  function armDockTimer(){
    clearTimeout(dockTimer);
    dockTimer = setTimeout(() => { if(document.activeElement === textInput || textInput.value.trim()) return; closeCommand(); }, 14000);
  }
  let focusTimer = null;
  function openCommand(focus){
    if(document.body.classList.contains("sheet-open") || document.body.classList.contains("eco-open")) return;
    buildChips();
    chatArea.classList.add("visible"); document.body.classList.add("cmd-open"); armDockTimer();
    clearTimeout(focusTimer);
    if(focus !== false) focusTimer = setTimeout(() => { if(chatArea.classList.contains("visible")) textInput.focus({ preventScroll: true }); }, 340);   // after the double-tap window, so a double-tap never flashes the keyboard
  }
  function closeCommand(){ clearTimeout(focusTimer); chatArea.classList.remove("visible"); document.body.classList.remove("cmd-open"); textInput.blur(); }   // a pending focus must not re-open the keyboard after a double-tap
  textInput.addEventListener("input", armDockTimer);
  textInput.addEventListener("blur", armDockTimer);
  textInput.addEventListener("focus", () => clearTimeout(dockTimer));
  textInput.addEventListener("keydown", e => {
    if(e.key === "Enter" && textInput.value.trim()){ handleUserUtterance(textInput.value.trim()); textInput.value = ""; }
    if(e.key === "Escape") closeCommand();
  });
  bus.on("face:longpress", () => {                       // press and hold the character -> tasks / reminders
    director.dispatch("USER_LONGPRESS");
    closeCommand();
    window.DABSy.require("notifcenter").then(c => c.openTasks());
  });
  /* bow tie = "today at a glance". A short wait lets the secret tie rhythm (several quick taps) finish without popping this open. */
  let tieT = 0, lastBrief = 0;
  const showBrief = () => { if(Date.now() - lastBrief < 2000 || !window.DABSy.briefing) return; lastBrief = Date.now(); window.DABSy.briefing.show(); };
  bus.on("face:tap", ({ region }) => { if(region === "tie"){ clearTimeout(tieT); tieT = setTimeout(showBrief, 700); } });
  bus.on("face:pressdown", ({ region }) => { if(region === "tie" && tieT) clearTimeout(tieT); });
  document.getElementById("sc-brief").addEventListener("click", showBrief);
  bus.on("face:talk", () => openCommand());              // the visible "Talk" shortcut button -> chat
  bus.on("face:tap", ({ region }) => {                   // tap on an eye -> chat, immediately (once)
    if(chatArea.classList.contains("visible")){ if(region === "eyes" && !textInput.value) closeCommand(); return; }   // petting the body/tie must not dismiss chat
    if(region === "eyes") openCommand();
  });
  bus.on("face:doubletap", () => closeCommand());

  /* ---------------- microphone (permission asked just in time) ---------------- */
  micBtn.addEventListener("click", async () => {
    if(voice.isListening()){ voice.stopListening(); return; }
    const r = await window.DABSy.permissions.ensure("microphone", { reason: "I need the microphone so I can hear you. I only listen while the mic button is lit." });
    if(r.granted) voice.startListening();
    else if(r.declined) showSubtitle("No problem, you can type to me instead.");
  });
  bus.on("voice:listening:start", () => { micBtn.classList.add("live"); emotion.setState("LISTENING"); showSubtitle("Listening…"); });
  bus.on("voice:listening:end", () => { micBtn.classList.remove("live"); if(subtitle.textContent === "Listening…") hideSubtitle(); });
  bus.on("voice:unsupported", () => showSubtitle("Speech recognition isn't supported here. Try typing instead."));
  bus.on("voice:error", ({ error }) => {
    const m = { "not-allowed": "I don't have microphone permission. Allow it in your browser's site settings.", "service-not-allowed": "Microphone access is blocked for this site.", "no-speech": "I didn't hear anything. Try again.", "audio-capture": "I couldn't find a working microphone.", network: "Speech recognition needs an internet connection." };
    showSubtitle(m[error] || "Something went wrong with the microphone. Try again.");
  });
  bus.on("voice:heard", ({ text }) => handleUserUtterance(text));

  /* ---------- pending schedule conflict (waits for the NEXT utterance) ----------
     pendingConflict.core is set when the conflict was found against the shared
     DABSy Core calendar (Calendar connected) rather than DABSy's own private
     recurring/oneoff store — that flag decides which resolver runs below. */
  let pendingConflict = null; // { candidate:{title,start,durationMin}, conflict, core? }

  /* ---------- pending "want me to add this?" confirmation (Suggest permission level) ---------- */
  let pendingCalendarConfirm = null; // { title, dateKey, startTime, endTime, category }

  /* ---------- pending "what category is this?" (asked when the AI couldn't confidently guess) ---------- */
  let pendingCategoryQuestion = null; // { title, dateKey, startTime, endTime, emoji }

  /* ---------- small date/time helpers shared with the Core calendar path ---------- */
  function dateTimeFromKey(dateKey, h, m){
    const d = new Date(dateKey + "T00:00:00");
    d.setHours(h, m, 0, 0);
    return d;
  }
  function toHM(t){ const [h,m] = (t||"00:00").split(":").map(Number); return [h,m]; }
  function hmString(totalMinutes){
    const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped/60), m = wrapped%60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }


  // best-effort title match against the shared calendar, nearest upcoming date first
  function findBestCoreEventMatch(title){
    const t = (title||"").trim().toLowerCase();
    if(!t) return null;
    const todayKey = DABSyCore.todayKeyOffset(0);
    return DABSyCore.getCalendarEvents()
      .filter(e => e.date >= todayKey)
      .filter(e => e.title.toLowerCase().includes(t) || t.includes(e.title.toLowerCase()))
      .sort((a,b) => (a.date + (a.startTime||"")).localeCompare(b.date + (b.startTime||"")))[0] || null;
  }

  // same idea, but against Ghibli's task list (undated or dated, incomplete first)
  function findBestCoreTaskMatch(title){
    const t = (title||"").trim().toLowerCase();
    if(!t) return null;
    const todayKey = DABSyCore.todayKeyOffset(0);
    return DABSyCore.getTasks()
      .filter(task => !task.done)
      .filter(task => task.title.toLowerCase().includes(t) || t.includes(task.title.toLowerCase()))
      .sort((a,b) => (a.date || todayKey).localeCompare(b.date || todayKey))[0] || null;
  }

  function resolveCoreConflict(action, core){
    if(action === "cancel_existing"){
      DABSyCore.deleteCalendarEvent(core.conflictEventId);
    }
    if(action === "move_existing"){
      const ev = DABSyCore.getEventById(core.conflictEventId);
      if(ev && ev.startTime){
        const dur = ev.endTime ? (DABSyCore.toMinutes(ev.endTime) - DABSyCore.toMinutes(ev.startTime)) : 30;
        const newStartMin = DABSyCore.toMinutes(ev.startTime) + 45;
        DABSyCore.updateCalendarEvent(core.conflictEventId, {
          startTime: hmString(newStartMin),
          endTime: hmString(newStartMin + dur),
        });
      }
    }
    if(action === "cancel_new") return;
    // move_existing / cancel_existing / keep_both all fall through to creating the candidate
    createConnectedEvent(core);
  }

  // Actually writes the record into the shared calendar. `c.emoji`, if present,
  // is prefixed onto the title so it shows up as-is in Ghibli Calendar's UI
  // without Ghibli needing any code changes to display it.
  function createConnectedEvent(c){
    const displayTitle = c.emoji ? `${c.emoji} ${c.title}` : c.title;
    return DABSyCore.createCalendarEvent({
      title: displayTitle, date: c.dateKey, startTime: c.startTime, endTime: c.endTime,
      category: c.category || "study", source: "dabsy",
    });
  }

  // Rule-based (no extra AI call — keeps this fast) day-density check, used to
  // append a short "by the way, your evening's tight" style tip after a
  // successful add. Deliberately simple: gaps under 10 min between two timed
  // events, or more than 4 scheduled hours in one day, are the only signals.
  function planTipSuffix(dateKey){
    const timed = DABSyCore.getEventsForDate(dateKey)
      .filter(e => e.startTime)
      .map(e => ({ title:e.title, start: DABSyCore.toMinutes(e.startTime), end: e.endTime ? DABSyCore.toMinutes(e.endTime) : DABSyCore.toMinutes(e.startTime)+30 }))
      .sort((a,b) => a.start - b.start);
    if(timed.length < 2) return "";
    let totalMin = 0, tightGap = null;
    for(let i=0;i<timed.length;i++){
      totalMin += (timed[i].end - timed[i].start);
      if(i > 0){
        const gap = timed[i].start - timed[i-1].end;
        if(gap >= 0 && gap < 10 && !tightGap) tightGap = { a: timed[i-1].title, b: timed[i].title };
      }
    }
    if(tightGap) return ` One thing though — "${tightGap.a}" and "${tightGap.b}" are back-to-back with barely a gap. Want me to space them out a bit?`;
    if(totalMin > 240) return ` Heads up, that day's getting pretty packed (${Math.round(totalMin/60*10)/10}+ hours scheduled) — might be worth keeping a real break in there.`;
    return "";
  }

  // Shared final step once we actually know title/date/time/category — used
  // both by the direct path (category already confident) and after a
  // category-clarifying question gets answered.
  async function finalizeConnectedEvent({ title, dateKey, startTime, endTime, category, emoji }){
    const level = DABSyCore.getCalendarLevel();
    const conflicts = DABSyCore.findConflicts(dateKey, { startTime, endTime });

    if(conflicts.length){
      const conflictEv = conflicts[0];
      const [h,m] = toHM(startTime);
      const [ch, cm] = toHM(conflictEv.startTime);
      const candidate = { title, start: dateTimeFromKey(dateKey, h, m), durationMin: DABSyCore.toMinutes(endTime) - DABSyCore.toMinutes(startTime) };
      const conflictForAI = { title: conflictEv.title, start: dateTimeFromKey(dateKey, ch, cm) };
      pendingConflict = { candidate, conflict: conflictForAI, core: { dateKey, startTime, endTime, title, category, emoji, conflictEventId: conflictEv.id } };
      const q = await ai.askConflictQuestion(candidate, conflictForAI);
      window.DABSy.director.dispatch("SCHEDULE_CONFLICT", { speakText: q.reply, finalState: q.state });
      return;
    }

    if(level === "suggest"){
      pendingCalendarConfirm = { title, dateKey, startTime, endTime, category, emoji };
      const catLabel = DABSyCore.CATEGORIES[category] ? DABSyCore.CATEGORIES[category].label : category;
      say(`I can add "${title}" to your calendar as ${catLabel} for ${startTime} — want me to?`, "CURIOUS");
      return;
    }

    // automatic
    createConnectedEvent({ title, dateKey, startTime, endTime, category, emoji });
    say(`Got it — added to your calendar.${planTipSuffix(dateKey)}`, "HAPPY");
    bus.emit('schedule:changed');
  }

  async function handleScheduleAdd(result){
    const s = result.schedule || {};
    // Gemini sometimes returns hour/minute as strings ("17" instead of 17) —
    // a strict typeof check was silently treating every one of those as
    // "couldn't parse a time" and just chatting back, which is why nothing
    // ever got added. Coerce instead of rejecting.
    const hour = Number(s.hour);
    const minute = Number(s.minute);
    if(Number.isNaN(hour) || Number.isNaN(minute)){
      say(result.reply, result.state); // genuinely no time given — just respond conversationally
      return;
    }
    const durationMin = Number(s.duration_minutes) || 30;

    // Recurring habits stay in DABSy's own private reminder system even when
    // Calendar is connected — Ghibli Calendar has no recurring-event UI yet,
    // so mapping "I do yoga every day" onto single dated calendar records
    // would be more overbuild than this phase calls for.
    if(DABSyCore.isCalendarConnected() && !s.recurring){
      await handleScheduleAddConnected(result, { hour, minute, durationMin });
      return;
    }

    const start = new Date();
    const dayOff = Number.isFinite(Number(s.date_offset_days)) ? Number(s.date_offset_days) : 0;
    start.setDate(start.getDate() + dayOff);
    start.setHours(hour, minute, 0, 0);
    let rolled = false;
    if(!s.recurring && dayOff === 0 && start.getTime() < Date.now() - 60000){ start.setDate(start.getDate() + 1); rolled = true; }
    const conflict = schedule.findConflict(start, durationMin);

    if(conflict){
      const candidate = { title: s.title || "your task", start, durationMin };
      pendingConflict = { candidate, conflict };
      const q = await ai.askConflictQuestion(candidate, conflict);
      window.DABSy.director.dispatch("SCHEDULE_CONFLICT", { speakText: q.reply, finalState: q.state });
      return;
    }

    if(s.recurring){
      const days = (Array.isArray(s.days) && s.days.length)
        ? s.days.map(Number).filter(n=>!Number.isNaN(n))
        : [0,1,2,3,4,5,6];
      schedule.addRecurring({ title: s.title || "task", hour, minute, days, durationMin });
    } else {
      schedule.addOneOff({ title: s.title || "task", startISO: start.toISOString(), durationMin, emoji: s.emoji || undefined, category: s.category || undefined });
    }
    say(result.reply || addedLine(s, start, rolled), result.state || "HAPPY");
    offerSystemNotifications();
    bus.emit('schedule:changed');
  }

  async function handleScheduleAddConnected(result, { hour, minute, durationMin }){
    const s = result.schedule || {};
    const level = DABSyCore.getCalendarLevel();
    const title = s.title || "Untitled";
    const dayOffset = Number.isFinite(Number(s.date_offset_days)) ? Number(s.date_offset_days) : 0;
    const dateKey = DABSyCore.todayKeyOffset(dayOffset);
    const startTime = hmString(hour*60 + minute);
    const endTime = hmString(hour*60 + minute + durationMin);
    const emoji = typeof s.emoji === "string" && s.emoji.trim() ? s.emoji.trim() : null;
    const category = s.category && DABSyCore.CATEGORIES[s.category] ? s.category : null;

    if(level === "read"){
      say(`${result.reply} I can see your calendar, but I don't have permission to add to it yet — turn on Suggest or Automatic for Calendar in Settings if you'd like me to schedule things.`, result.state);
      return;
    }

    if(!category){
      pendingCategoryQuestion = { title, dateKey, startTime, endTime, emoji };
      say(`Sure — what category is "${title}"? Study, College, Homework, Personal, Creative, Meeting, Important, or Deadline?`, "CURIOUS");
      return;
    }

    await finalizeConnectedEvent({ title, dateKey, startTime, endTime, category, emoji });
  }

  /* ---------------- helpers used by the preserved flows ---------------- */
  function addedLine(s, start, rolled){
    const t = ui.fmtTime(start);
    if(s.recurring){
      const d = (s.days || []);
      const when = d.length === 7 ? "every day" : d.length === 5 && !d.includes(0) && !d.includes(6) ? "on weekdays" : "on " + d.map(i => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][i]).join(", ");
      return `Done. ${s.title || "That"} ${when} at ${t}.`;
    }
    return `Added ${s.title || "it"} for ${ui.dayLabel(start).toLowerCase()} at ${t}${rolled ? " (that time had passed today)" : ""}.`;
  }
  // First time there is something time-based to remind about, ask (once, politely) for system notifications.
  let offered = false;
  function offerSystemNotifications(){
    if(offered || window.DABSy.notify.settings().system || !("Notification" in window) || Notification.permission === "denied") return;
    offered = true;
    setTimeout(() => window.DABSy.notify.enableSystem("I can nudge you when this is due, even if DABSy is in the background. I'll keep it gentle and never spam."), 1600);
  }

  /* ---------------- local commands (no AI needed) ---------------- */
  function nextLine(){
    const n = tasks.nextInstance();
    if(!n) return "Nothing coming up. Want to plan some study?";
    return `Next up: ${n.title}, ${ui.dayLabel(n.start).toLowerCase()} at ${ui.fmtTime(n.start)}.`;
  }
  async function localCommand(text){
    const t = text.toLowerCase().trim();
    if(window.DABSy.easter && window.DABSy.easter.handleText(text)) return true;
    if(/^(what'?s|what is) next|what do i have|what'?s on|what next/.test(t)){ say(nextLine(), "IDLE"); return true; }
    if(/\b(open|show|go to)\b.*\b(settings|preferences)\b/.test(t) || t === "settings"){ window.DABSy.require("settings").then(s => s.open()); return true; }
    if(/\b(open|show)\b.*\b(apps|bubbles|ecosystem|study space|calendar|solvecount)\b/.test(t) || t === "open apps"){ window.DABSy.ecosystem.open(); return true; }
    if(/\b(notifications?|inbox|alerts)\b/.test(t) && /\b(open|show|check|my)\b/.test(t)){ openCenter(); return true; }
    if(/\b(my day|my tasks?|todo|to-do|to do list|show.*tasks|agenda)\b/.test(t) && !/\b(add|remind)\b/.test(t)){ window.DABSy.require("notifcenter").then(c => c.openTasks()); return true; }
    if(/\b(tutorial|tour|how do i use)\b/.test(t)){ window.DABSy.require("onboarding").then(o => o.start({ replay: true })); return true; }
    if(/\b(wardrobe|outfits?|change (your )?clothes|dress)\b/.test(t)){ window.DABSy.require("settings").then(s => s.open("wardrobe")); return true; }
    if(/\b(how much time|time left|how long (is )?left)\b/.test(t) && document.body.classList.contains("session-active")){ window.DABSy.require("session").then(s => s.say("remaining")); return true; }
    if(/\bwhat can you do\b|\bhelp\b/.test(t) && t.length < 24){ say("Tell me what you want to study and I'll find material and plan it. I also handle tasks, reminders, and your study apps. Double-tap me for the apps.", "HAPPY"); return true; }
    return false;
  }
  function openCenter(){ window.DABSy.require("notifcenter").then(c => c.open()); }

  /* ---------------- the utterance router ---------------- */
  // one utterance at a time: a double Enter or a repeated speech result must not send twice
  let utteranceBusy = false;
  async function handleUserUtterance(text){
    if(utteranceBusy) return;
    utteranceBusy = true;
    textInput.readOnly = true;        // not "disabled": that drops focus and closes the phone keyboard after every send
    try{ await processUtterance(text); }
    finally{
      utteranceBusy = false; textInput.readOnly = false;
      if(chatArea.classList.contains("visible") && document.activeElement !== textInput) textInput.focus({ preventScroll: true });
    }
  }
  async function processUtterance(text, o){
    o = o || {};
    lastUserText = text;
    showSubtitle(text);
    if(!o.retry) memory.addSession("user", text);
    window.DABSy.pet && window.DABSy.pet.markInteraction();
    director.dispatch("AI_THINKING");
    armDockTimer();

    // (egg detection is passive: it only watches, it never changes the reply)
    bus.emit("user:said", { text });

    if(window.DABSy.calIntel && window.DABSy.calIntel.hasPending()){      // answer to "which day?" / "add it? yes/no"
      const r = await window.DABSy.calIntel.answer(text);
      if(r){ memory.addSession("dabsy", r.text); say(r.text, r.state, r.opts); return; }
    }
    if(pendingCategoryQuestion){
      const cat = DABSyCore.matchCategoryFromText(text);
      if(cat){
        const c = pendingCategoryQuestion; pendingCategoryQuestion = null;
        await finalizeConnectedEvent({ title: c.title, dateKey: c.dateKey, startTime: c.startTime, endTime: c.endTime, category: cat, emoji: c.emoji });
        return;
      }
      say("I didn't catch a category. Study, College, Homework, Personal, Creative, Meeting, Important, or Deadline?", "CURIOUS");
      return;
    }
    if(pendingCalendarConfirm){
      const yes = /\b(yes|yeah|yep|sure|do it|go ahead|please do|okay|ok|correct)\b/i.test(text);
      const no = /\b(no|nah|nope|don't|do not|cancel|never ?mind|stop)\b/i.test(text);
      if(yes){ const c = pendingCalendarConfirm; pendingCalendarConfirm = null; createConnectedEvent(c); say("Done, added to your calendar." + planTipSuffix(c.dateKey), "HAPPY"); return; }
      if(no){ pendingCalendarConfirm = null; say("No problem, I won't add it.", "IDLE"); return; }
      pendingCalendarConfirm = null;
    }
    if(pendingConflict){
      const res = await ai.resolveConflictIntent(text, pendingConflict.candidate, pendingConflict.conflict);
      if(res.action === "unclear"){ say(res.reply, res.state); return; }
      if(pendingConflict.core) resolveCoreConflict(res.action, pendingConflict.core);
      else schedule.resolveConflict(res.action, pendingConflict.conflict, pendingConflict.candidate);
      pendingConflict = null;
      say(res.reply, res.state);
      return;
    }

    // a running study session answers questions in context
    if(document.body.classList.contains("session-active") && window.DABSy.session){
      memory.addHistory({ type: "chat", user: text, reply: "(in session)" });
      const handled = await window.DABSy.session.handleUtterance(text);
      if(handled) return;
    }
    if(window.DABSy.studyBlock.isActive){
      memory.addHistory({ type: "chat", user: text, reply: "(routed to Study Block)" });
      if(ai.status() === "limited"){ say(ai.limitedReply(), "CONFUSED"); return; }
      window.DABSy.study.startStudy(text);
      return;
    }

    if(await localCommand(text)) { director.dispatch("DABSY_REPLY", { speakText: null }); return; }

    if(window.DABSy.butler){                            // natural-language task operations (complete / edit / prioritise / move / delete-with-confirmation / today)
      const b = await window.DABSy.butler.handle(text).catch(e => { console.error(e); return null; });
      if(b){ memory.addSession("dabsy", b.text); memory.addHistory({ type: "chat", user: text, reply: b.text }); say(b.text, b.state, b.opts); return; }
    }
    if(window.DABSy.calIntel){                          // commitments with a day/time -> classified, dated, saved and verified
      const cal = await window.DABSy.calIntel.handle(text).catch(e => { console.error(e); return null; });
      if(cal){ memory.addSession("dabsy", cal.text); memory.addHistory({ type: "chat", user: text, reply: cal.text }); say(cal.text, cal.state, cal.opts); return; }
    }
    if(await maybeRefine(text)) return;
    if(ai.isPlainChat(text)){ await chatReply(text); return; }          // fast path: one compact call, plain text back
    const result = await ai.parseIntent(text);
    if(result.reply) memory.addSession("dabsy", result.reply);
    memory.addHistory({ type: "chat", user: text, reply: result.reply || result.type });

    if(result.type === "study_goal"){
      try{
        const agent = await window.DABSy.require("agent");
        director.dispatch("DABSY_REPLY", { speakText: null });
        agent.start(result.goal || ai.parseGoal(text));
      }catch(e){ say("I couldn't load the study planner. Try again in a moment.", "CONFUSED"); }
      return;
    }
    if(result.type === "task_add" && result.task){
      const t = tasks.add({ title: result.task.title || text, durationMin: result.task.durationMin || 30, source: "chat" });
      say(result.reply || `Added "${t.title}" to your list. Want me to find a time for it?`, "HAPPY");
      ui.toast({ text: `"${t.title}" has no time yet.`, actions: [{ label: "Find a slot", primary: true, onClick: () => window.DABSy.notify.rescheduleFlow(t.id) }], timeout: 9000 });
      offerSystemNotifications();
      return;
    }
    if(result.type === "schedule_add" && result.schedule){ await handleScheduleAdd(result); return; }
    if(result.type === "schedule_remove" && result.schedule){
      // never delete on a guess: butler finds the matches and asks first
      const r = window.DABSy.butler ? await window.DABSy.butler.removeFlow(result.schedule.title || "") : null;
      if(r){ say(r.text, r.state, r.opts); return; }
    }
    if(result.limited){ director.dispatch("CONFUSED_BEAT", { speakText: result.reply }); return; }
    if(result.failed){ say(result.reply, "CONFUSED", { actions: retryAction(text) }); return; }
    say(result.reply, result.state);
  }

  let nextReplyOpts = null;
  function say(text, state, opts){
    nextReplyOpts = opts ? { text, opts } : null;        // consumed by the "dabsy:say" carrying this exact line (the director may delay it)
    const mine = nextReplyOpts;
    director.dispatch("DABSY_REPLY", { speakText: text, finalState: state === "CONFUSED" ? "IDLE" : (state || null) });
    if(state === "CONFUSED") director.dispatch("CONFUSED_BEAT", { speakText: null });
    setTimeout(() => { if(nextReplyOpts === mine) nextReplyOpts = null; }, 4000);
  }

  bus.on("dabsy:say", ({ text }) => {
    const o = nextReplyOpts && nextReplyOpts.text === text ? nextReplyOpts.opts : null; if(o) nextReplyOpts = null;
    showSubtitle(text, o || undefined);
    memory.addSession("dabsy", text);
    window.DABSy.voice.speak(text);
  });

  /* ---------------- chat replies: concise by default, "Explain more" on demand, Retry on failure ---------------- */
  let lastUserText = "", skipRefine = false;
  const studyMode = () => document.body.classList.contains("session-active") || document.body.classList.contains("study-active");
  const wordCount = s => String(s).trim().split(/\s+/).filter(Boolean).length;
  const INFO_Q = /^\s*(what|why|how|who|when|where|which|explain|define|difference|meaning|can you explain|tell me about|kya|kaise|kyu|kyun|kay|kasa|क्या|क्यों|कैसे|काय|कसे)\b/i;
  function retryAction(text){ return [{ label: "Retry", primary: true, onClick: () => { director.dispatch("AI_THINKING"); processUtterance(text, { retry: true }); } }]; }
  async function chatReply(text){
    const study = studyMode();
    const r = await ai.chat(text, { study });
    if(!r.ok){ say(r.text, "CONFUSED", { actions: ai.status() === "limited" && r.error === "no-proxy" ? null : retryAction(text) }); return; }
    memory.addSession("dabsy", r.text); memory.addHistory({ type: "chat", user: text, reply: r.text });
    const canExpand = !study && (wordCount(r.text) >= 18 || (INFO_Q.test(text) && wordCount(r.text) >= 8));
    say(r.text, "IDLE", canExpand ? { actions: [{ label: "Explain more", onClick: () => expandReply(text, r.text) }] } : null);
  }
  async function expandReply(question, answer){
    director.dispatch("AI_THINKING");
    const r = await ai.expand(question, answer);
    if(!r.ok){ say(r.text, "CONFUSED", { actions: [{ label: "Try again", primary: true, onClick: () => expandReply(question, answer) }] }); return; }
    memory.addSession("dabsy", r.text);
    say(r.text, "IDLE");
  }
  // long or multi-part request -> restate it and let the student confirm / edit / change (never for simple messages)
  async function maybeRefine(text){
    if(skipRefine){ skipRefine = false; return false; }
    if(wordCount(text) < 30 || ai.status() === "limited") return false;
    const p = await ai.refine(text);
    if(!p) return false;
    const lead = "What I understood: ";
    say(lead + p.understood, "CURIOUS", { actions: [
      { label: "Use", primary: true, onClick: () => { skipRefine = true; handleUserUtterance(p.understood); } },
      { label: "Edit", onClick: () => { textInput.value = p.understood; openCommand(); setTimeout(() => textInput.focus(), 60); } },
      { label: "Change", onClick: () => { textInput.value = ""; openCommand(); setTimeout(() => textInput.focus(), 60); } },
    ] });
    return true;
  }

  /* ---------------- bell + notification centre ---------------- */
  const bell = document.getElementById("bell-btn");
  document.getElementById("bell-icon").innerHTML = ui.icon("bell", 22);
  const dot = document.getElementById("bell-dot");
  function refreshBell(){
    const n = window.DABSy.notify.unread();
    dot.hidden = n === 0;
    bell.setAttribute("aria-label", n ? `Notifications, ${n} new` : "Notifications");
  }
  bell.addEventListener("click", openCenter);
  bus.on("notify:inbox", refreshBell);
  bus.on("notify:open-center", openCenter);
  refreshBell();

  /* ---------------- accessibility shortcut buttons ---------------- */
  document.getElementById("sc-apps").innerHTML = ui.icon("sparkle", 18) + "<span>Apps</span>";
  document.getElementById("sc-brief").innerHTML = ui.icon("sparkle", 18) + "<span>Today</span>";
  document.getElementById("sc-talk").innerHTML = ui.icon("mic", 18) + "<span>Talk</span>";
  document.getElementById("sc-home").innerHTML = ui.icon("sparkle", 18) + "<span>Come home</span>";
  const scHome = document.getElementById("sc-home");
  bus.on("world:state", () => { scHome.hidden = !(window.DABSy.world && window.DABSy.world.isAway()); });   // only while she is wandering
  function applySettings(){
    document.body.classList.toggle("show-shortcuts", !!memory.getSettings().showShortcuts);
  }
  applySettings();
  bus.on("settings:changed", applySettings);

  /* ---------------- start-a-task hook (from notifications / task list) ---------------- */
  bus.on("task:start-requested", async ({ taskId, key }) => {
    const t = tasks.get(taskId); if(!t) return;
    if(t.sessionId){ try{ (await window.DABSy.require("session")).open(t.sessionId, { autostart: true }); return; }catch(e){} }
    try{ (await window.DABSy.require("session")).startQuick(t); }catch(e){ ui.toast({ text: "Started " + t.title }); }
  });

  /* ---------------- install button + AI status are surfaced in Settings ---------------- */

  window.DABSy.app = { say, showSubtitle, lastText: () => lastUserText, hideSubtitle, openCommand, closeCommand, handleUserUtterance, openCenter, nextLine };
})();
