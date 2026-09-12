/* ============================================================
   D.A.B.S.y — app.js
   The conductor. Wires voice <-> AI <-> face/subtitle/schedule,
   and renders the panels that don't have their own engine file
   (Schedule, Room, Memory, Settings).
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const emotion = window.DABSy.emotion;
  const memory = window.DABSy.memory;
  const schedule = window.DABSy.schedule;
  const voice = window.DABSy.voice;
  const ai = window.DABSy.ai;
  const DABSyCore = window.DABSyCore;

  const subtitle = document.getElementById("subtitle");
  const chatArea = document.getElementById("chat-area");
  const inputDock = document.getElementById("input-dock");
  const micBtn = document.getElementById("mic-btn");
  const textInput = document.getElementById("text-input");

  /* ---------- subtitle helper ----------
     No auto-dismiss timer — DABSy's spoken/answer text used to vanish on a
     fixed timer regardless of whether you were still reading it. Now it
     stays up until you explicitly triple-tap it away, which gives you
     actual control over the pace instead of racing a clock. */
  let subtitleTapCount = 0;
  let subtitleTapTimer = null;
  function showSubtitle(text){
    subtitle.textContent = text;
    subtitle.classList.add("visible");
  }
  function hideSubtitle(){
    subtitle.classList.remove("visible");
  }
  subtitle.addEventListener("pointerdown", ()=>{
    subtitleTapCount++;
    clearTimeout(subtitleTapTimer);
    subtitleTapTimer = setTimeout(()=>{ subtitleTapCount = 0; }, 600);
    if(subtitleTapCount >= 3){
      subtitleTapCount = 0;
      hideSubtitle();
    }
  });

  /* ---------- chat area reveal on tap ----------
     Used to auto-hide after a fixed 9s regardless of what you were doing,
     which meant it could vanish mid-type. Now the countdown only runs
     while you're NOT actively using the text field. */
  let dockHideTimer = null;
  function armDockHideTimer(){
    clearTimeout(dockHideTimer);
    dockHideTimer = setTimeout(()=>{
      if(document.activeElement === textInput || textInput.value.trim()) return; // still in use — don't hide
      chatArea.classList.remove("visible");
    }, 9000);
  }
  function showDock(focus=false){
    chatArea.classList.add("visible");
    armDockHideTimer();
    if(focus) setTimeout(()=>textInput.focus(), 320);
  }
  textInput.addEventListener("input", armDockHideTimer);
  textInput.addEventListener("focus", ()=>clearTimeout(dockHideTimer));
  textInput.addEventListener("blur", armDockHideTimer);
  bus.on("face:tap", ({count})=>{ if(count===1) showDock(); });
  bus.on("quickbubbles:focus-input", ()=>showDock(true));

  /* ---------- mic button ---------- */
  micBtn.addEventListener("click", ()=>{
    if(voice.isListening()){ voice.stopListening(); }
    else { voice.startListening(); }
  });
  bus.on("voice:listening:start", ()=>{
    micBtn.classList.add("live");
    emotion.setState("LISTENING");
    showSubtitle("Listening…");
  });
  bus.on("voice:listening:end", ()=>{
    micBtn.classList.remove("live");
    if(subtitle.textContent === "Listening…") hideSubtitle(); // transient status, not content — clears itself
  });
  bus.on("voice:unsupported", ()=>showSubtitle("Speech recognition isn't supported here — try typing instead."));
  bus.on("voice:error", ({error})=>{
    const messages = {
      "not-allowed": "I don't have microphone permission — check your browser's site settings and allow the mic for this page.",
      "service-not-allowed": "Microphone access is blocked for this site — check your browser's site settings.",
      "no-speech": "I didn't hear anything — try again.",
      "audio-capture": "I couldn't find a working microphone on this device.",
      "network": "Speech recognition needs an internet connection.",
    };
    showSubtitle(messages[error] || "Something went wrong with the microphone — try again.");
  });

  /* ---------- text input fallback ---------- */
  textInput.addEventListener("keydown", (e)=>{
    if(e.key === "Enter" && textInput.value.trim()){
      handleUserUtterance(textInput.value.trim());
      textInput.value = "";
    }
  });
  bus.on("voice:heard", ({text})=>handleUserUtterance(text));

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

  async function handleUserUtterance(text){
    showDock();
    showSubtitle(text);
    memory.addSession("user", text);
    window.DABSy.director.dispatch("AI_THINKING");

    if(pendingCategoryQuestion){
      const cat = DABSyCore.matchCategoryFromText(text);
      if(cat){
        const c = pendingCategoryQuestion; pendingCategoryQuestion = null;
        await finalizeConnectedEvent({ title:c.title, dateKey:c.dateKey, startTime:c.startTime, endTime:c.endTime, category:cat, emoji:c.emoji });
        return;
      }
      say(`I didn't catch a category there — Study, College, Homework, Personal, Creative, Meeting, Important, or Deadline?`, "CURIOUS");
      return; // keep waiting on the same question rather than dropping the request
    }

    if(pendingCalendarConfirm){
      const yes = /\b(yes|yeah|yep|sure|do it|go ahead|please do|okay|ok|correct)\b/i.test(text);
      const no = /\b(no|nah|nope|don't|do not|cancel|never ?mind|stop)\b/i.test(text);
      if(yes){
        const c = pendingCalendarConfirm; pendingCalendarConfirm = null;
        createConnectedEvent(c);
        say("Done — added to your calendar." + planTipSuffix(c.dateKey), "HAPPY");
        refreshScheduleIfOpen();
        return;
      }
      if(no){
        pendingCalendarConfirm = null;
        say("No problem, I won't add it.", "IDLE");
        return;
      }
      pendingCalendarConfirm = null; // don't trap the user in a forced yes/no loop — fall through to normal parsing
    }

    if(pendingConflict){
      const res = await ai.resolveConflictIntent(text, pendingConflict.candidate, pendingConflict.conflict);
      if(res.action === "unclear"){
        say(res.reply, res.state);
        return; // keep waiting on the same pending conflict
      }
      if(pendingConflict.core) resolveCoreConflict(res.action, pendingConflict.core);
      else schedule.resolveConflict(res.action, pendingConflict.conflict, pendingConflict.candidate);
      pendingConflict = null;
      say(res.reply, res.state);
      refreshScheduleIfOpen();
      return;
    }

    if(window.DABSy.studyBlock.isActive){
      memory.addHistory({ type:"chat", user: text, reply: "(routed to Study Block)" });
      window.DABSy.study.startStudy(text); // shrinks the face to the corner, gives the answer room, reading pointer follows along
      return;
    }

    const result = await ai.parseIntent(text);
    memory.addSession("dabsy", result.reply);
    memory.addHistory({ type:"chat", user: text, reply: result.reply });

    if(result.type === "schedule_add" && result.schedule){
      await handleScheduleAdd(result);
      return;
    }
    if(result.type === "schedule_remove" && result.schedule){
      const title = result.schedule.title || "";
      let handled = false;

      if(DABSyCore.isCalendarConnected()){
        const evMatch = findBestCoreEventMatch(title);
        if(evMatch){ DABSyCore.deleteCalendarEvent(evMatch.id); handled = true; }
        if(!handled){
          const taskMatch = findBestCoreTaskMatch(title);
          if(taskMatch){ DABSyCore.deleteTask(taskMatch.id); handled = true; }
        }
      }
      if(!handled) schedule.removeRecurringByTitle(result.schedule.title);

      say(result.reply, result.state);
      refreshScheduleIfOpen();
      return;
    }

    say(result.reply, result.state);
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
    refreshScheduleIfOpen();
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
    start.setHours(hour, minute, 0, 0);
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
      schedule.addOneOff({ title: s.title || "task", startISO: start.toISOString(), durationMin });
    }
    say(result.reply, result.state);
    refreshScheduleIfOpen();
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

  function say(text, state){
    window.DABSy.director.dispatch("DABSY_REPLY", { speakText: text, finalState: state || null });
  }

  bus.on("dabsy:say", ({text})=>{
    showSubtitle(text);
    voice.speak(text);
  });

  bus.on("face:overtapped", ()=>{
    window.DABSy.director.dispatch("USER_OVERTAPPED");
  });
  bus.on("face:longpress", ()=>window.DABSy.director.dispatch("USER_LONGPRESS"));

  /* ---------- Schedule panel ---------- */
  function renderSchedule(){
    const el = document.getElementById("schedule-body");
    const items = schedule.getTodaysSchedule().map(it => Object.assign({}, it, { _kind:"private" }));

    let coreItems = [];
    if(DABSyCore.isCalendarConnected()){
      const todayKey = DABSyCore.todayKeyOffset(0);
      coreItems = DABSyCore.getEventsForDate(todayKey)
        .filter(e => e.startTime)
        .map(e => {
          const [h,m] = toHM(e.startTime);
          const durationMin = e.endTime ? (DABSyCore.toMinutes(e.endTime) - DABSyCore.toMinutes(e.startTime)) : 30;
          return { id: e.id, title: e.title, _kind:"calendar", start: dateTimeFromKey(todayKey, h, m), durationMin };
        });
    }

    const all = [...items, ...coreItems].sort((a,b)=>a.start-b.start);
    el.innerHTML = "";
    if(all.length === 0){
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Nothing scheduled yet today.";
      el.appendChild(empty);
    }
    const now = new Date();
    all.forEach(item=>{
      const row = document.createElement("div");
      row.className = "task-row";
      const time = item.start.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
      const past = item.start < now;
      const icon = item._kind === "calendar" ? " 🌿" : (item.source === "recurring" ? " 🔁" : "");
      row.innerHTML = `<span style="opacity:${past?0.45:1}">${time} · ${escapeHtml(item.title)}${icon}</span>`;
      const del = document.createElement("button");
      del.textContent = "✕";
      del.onclick = ()=>{
        if(item._kind === "calendar") DABSyCore.deleteCalendarEvent(item.id);
        else if(item.source === "oneoff") schedule.removeOneOff(item.id);
        else schedule.removeRecurringByTitle(item.title);
        renderSchedule();
      };
      row.appendChild(del);
      el.appendChild(row);
    });
  }

  /* ---------- DABSy Core — live refresh + Connections UI ---------- */
  DABSyCore.subscribe((type)=>{
    if(type.indexOf("calendar.") === 0) refreshScheduleIfOpen();
  });

  function populateConnectionsUI(){
    const conn = DABSyCore.getConnections().calendar;
    document.getElementById("conn-calendar-enabled").checked = !!conn.enabled;
    document.getElementById("conn-calendar-level").value = conn.level || "read";
  }
  document.getElementById("conn-calendar-enabled").addEventListener("change", (e)=>{
    DABSyCore.setConnection("calendar", { enabled: e.target.checked });
    refreshScheduleIfOpen();
  });
  document.getElementById("conn-calendar-level").addEventListener("change", (e)=>{
    DABSyCore.setConnection("calendar", { level: e.target.value });
  });
  function refreshScheduleIfOpen(){
    if(document.querySelector('.world-panel[data-panel="schedule"]').classList.contains("active")) renderSchedule();
    if(document.querySelector('.world-panel[data-panel="room"]').classList.contains("active")) renderRoom();
  }
  bus.on("schedule:changed", refreshScheduleIfOpen);

  document.getElementById("manual-task-add").addEventListener("click", ()=>{
    const titleEl = document.getElementById("manual-task-title");
    const timeEl = document.getElementById("manual-task-time");
    if(!titleEl.value.trim() || !timeEl.value) return;
    const [h,m] = timeEl.value.split(":").map(Number);
    const start = new Date(); start.setHours(h,m,0,0);
    const conflict = schedule.findConflict(start, 30);
    if(conflict){
      say(`Heads up — that overlaps with "${conflict.title}". Adding it anyway; you can remove either from the list.`, "IDLE");
    }
    schedule.addOneOff({ title: titleEl.value.trim(), startISO: start.toISOString(), durationMin: 30 });
    titleEl.value = ""; timeEl.value = "";
    renderSchedule();
  });

  /* ---------- Settings panel ---------- */
  const geminiKeyInput = document.getElementById("gemini-key");
  const voiceSelect = document.getElementById("voice-select");
  const soundToggle = document.getElementById("sound-toggle");
  const saveSettingsBtn = document.getElementById("save-settings");

  function populateSettings(){
    const s = memory.getSettings();
    geminiKeyInput.value = s.geminiKey || "";
    soundToggle.checked = s.sound !== false;
    const voices = voice.getVoices();
    voiceSelect.innerHTML = "";
    voices.forEach(v=>{
      const opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      if(v.voiceURI === s.voiceURI) opt.selected = true;
      voiceSelect.appendChild(opt);
    });
  }
  bus.on("voice:voices-ready", populateSettings);
  populateSettings();
  populateConnectionsUI();

  saveSettingsBtn.addEventListener("click", ()=>{
    memory.saveSettings({
      geminiKey: geminiKeyInput.value.trim(),
      voiceURI: voiceSelect.value,
      sound: soundToggle.checked,
    });
    window.DABSy.director.dispatch("DABSY_REPLY", { speakText: "Settings saved." });
  });

  /* ---------- Install button (only appears once Chrome says it's eligible) ---------- */
  const installBtn = document.getElementById("install-app-btn");
  bus.on("pwa:installable", ()=>{ installBtn.style.display = "block"; });
  installBtn.addEventListener("click", async ()=>{
    const installed = await window.DABSy.pwa.promptInstall();
    if(installed) installBtn.style.display = "none";
  });

  bus.on("world:opened", ({tab})=>{
    if(tab === "schedule") renderSchedule();
    if(tab === "settings"){ populateSettings(); populateConnectionsUI(); }
    if(tab === "memory") renderMemoryPanel();
    if(tab === "room") renderRoom();
  });

  /* ---------- Memory panel ---------- */
  function renderMemoryPanel(){
    const el = document.getElementById("memory-body");
    const prefs = memory.getPreferences();
    const history = memory.getHistory().slice(-15).reverse();
    el.innerHTML = "";

    const prefTitle = document.createElement("div");
    prefTitle.className = "hint";
    prefTitle.textContent = "Things I've been told to remember";
    el.appendChild(prefTitle);

    if(prefs.length === 0){
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Nothing yet.";
      el.appendChild(empty);
    }
    prefs.forEach((p, i)=>{
      const row = document.createElement("div");
      row.className = "mem-row";
      row.innerHTML = `<span>${escapeHtml(p.text)}</span>`;
      const del = document.createElement("button"); del.textContent = "Forget";
      del.onclick = ()=>{ memory.removePreference(i); renderMemoryPanel(); };
      row.appendChild(del);
      el.appendChild(row);
    });

    const rulesTitle = document.createElement("div");
    rulesTitle.className = "hint";
    rulesTitle.style.marginTop = "10px";
    rulesTitle.textContent = "Recurring tasks";
    el.appendChild(rulesTitle);
    const rules = schedule.getRules();
    if(rules.length === 0){
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "None yet.";
      el.appendChild(empty);
    }
    rules.forEach(r=>{
      const row = document.createElement("div");
      row.className = "mem-row";
      row.innerHTML = `<span>${escapeHtml(r.title)} — ${String(r.hour).padStart(2,"0")}:${String(r.minute).padStart(2,"0")}</span>`;
      const del = document.createElement("button"); del.textContent = "Stop";
      del.onclick = ()=>{ schedule.removeRecurringByTitle(r.title); renderMemoryPanel(); };
      row.appendChild(del);
      el.appendChild(row);
    });

    const histTitle = document.createElement("div");
    histTitle.className = "hint";
    histTitle.style.marginTop = "10px";
    histTitle.textContent = "Recent history";
    el.appendChild(histTitle);
    history.forEach(h=>{
      const row = document.createElement("div");
      row.className = "mem-row";
      const label = h.type === "study-session" ? `Studied for ${h.minutes} min`
        : h.type === "chat" ? `"${h.user}"`
        : h.type;
      row.innerHTML = `<span>${escapeHtml(label)}</span>`;
      el.appendChild(row);
    });

    const clearBtn = document.createElement("button");
    clearBtn.className = "util-btn";
    clearBtn.style.marginTop = "10px";
    clearBtn.textContent = "Clear all history";
    clearBtn.onclick = ()=>{ memory.clearHistory(); renderMemoryPanel(); };
    el.appendChild(clearBtn);
  }

  /* ---------- Room panel: evolving pet stats ---------- */
  function renderRoom(){
    const el = document.getElementById("room-grid");
    const stats = memory.getPetStats();
    const tasks = memory.getTasks();
    const done = tasks.filter(t=>t.done).length;
    el.innerHTML = "";
    [
      { label: "Affection", value: Math.round((stats.affection||0.4)*100)+"%" },
      { label: "Tasks done", value: `${done}/${tasks.length}` },
      { label: "Study sessions", value: memory.getHistory().filter(h=>h.type==="study-session").length },
      { label: "Streak", value: `${stats.streak||0} visits in a row` },
      { label: "Today's items", value: schedule.getTodaysSchedule().length },
    ].forEach(item=>{
      const row = document.createElement("div");
      row.className = "task-row";
      row.innerHTML = `<span>${item.label}</span><span>${item.value}</span>`;
      el.appendChild(row);
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.app = { say, showSubtitle, showDock, renderSchedule };
})();
