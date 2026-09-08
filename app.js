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

  const subtitle = document.getElementById("subtitle");
  const inputDock = document.getElementById("input-dock");
  const micBtn = document.getElementById("mic-btn");
  const textInput = document.getElementById("text-input");
  const studyBlockBtn = document.getElementById("study-block-btn");

  let studyBlockActive = false;
  studyBlockBtn.addEventListener("click", ()=>{
    studyBlockActive = !studyBlockActive;
    studyBlockBtn.classList.toggle("active", studyBlockActive);
    inputDock.classList.toggle("study-active", studyBlockActive);
    showDock();
    window.DABSy.director.dispatch("DABSY_REPLY", {
      speakText: studyBlockActive
        ? "Study Block on — ask me anything and I'll walk you through it."
        : "Study Block off.",
    });
  });

  /* ---------- subtitle helper ---------- */
  let subtitleTimer = null;
  function showSubtitle(text, holdMs=4200){
    subtitle.textContent = text;
    subtitle.classList.add("visible");
    clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(()=>subtitle.classList.remove("visible"), holdMs);
  }

  /* ---------- input dock reveal on tap, hides after idle ---------- */
  let dockHideTimer = null;
  function showDock(focus=false){
    inputDock.classList.add("visible");
    clearTimeout(dockHideTimer);
    dockHideTimer = setTimeout(()=>inputDock.classList.remove("visible"), 9000);
    if(focus) setTimeout(()=>textInput.focus(), 320);
  }
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
    showSubtitle("Listening…", 6000);
  });
  bus.on("voice:listening:end", ()=>micBtn.classList.remove("live"));
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

  /* ---------- pending schedule conflict (waits for the NEXT utterance) ---------- */
  let pendingConflict = null; // { candidate:{title,start,durationMin}, conflict }

  async function handleUserUtterance(text){
    showDock();
    showSubtitle(text, 2600);
    memory.addSession("user", text);
    window.DABSy.director.dispatch("AI_THINKING");

    if(pendingConflict){
      const res = await ai.resolveConflictIntent(text, pendingConflict.candidate, pendingConflict.conflict);
      if(res.action === "unclear"){
        say(res.reply, res.state);
        return; // keep waiting on the same pending conflict
      }
      schedule.resolveConflict(res.action, pendingConflict.conflict, pendingConflict.candidate);
      pendingConflict = null;
      say(res.reply, res.state);
      refreshScheduleIfOpen();
      return;
    }

    if(studyBlockActive){
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
      schedule.removeRecurringByTitle(result.schedule.title);
      say(result.reply, result.state);
      refreshScheduleIfOpen();
      return;
    }

    say(result.reply, result.state);
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
    const start = new Date();
    start.setHours(hour, minute, 0, 0);
    const durationMin = Number(s.duration_minutes) || 30;
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

  function say(text, state){
    window.DABSy.director.dispatch("DABSY_REPLY", { speakText: text, finalState: state || null });
  }

  bus.on("dabsy:say", ({text})=>{
    showSubtitle(text, Math.min(18000, 3000 + text.length*70));
    voice.speak(text);
  });

  bus.on("face:overtapped", ()=>{
    window.DABSy.director.dispatch("USER_OVERTAPPED");
  });
  bus.on("face:longpress", ()=>window.DABSy.director.dispatch("USER_LONGPRESS"));

  /* ---------- Schedule panel ---------- */
  function renderSchedule(){
    const el = document.getElementById("schedule-body");
    const items = schedule.getTodaysSchedule();
    el.innerHTML = "";
    if(items.length === 0){
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Nothing scheduled yet today.";
      el.appendChild(empty);
    }
    const now = new Date();
    items.forEach(item=>{
      const row = document.createElement("div");
      row.className = "task-row";
      const time = item.start.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
      const past = item.start < now;
      row.innerHTML = `<span style="opacity:${past?0.45:1}">${time} · ${escapeHtml(item.title)}${item.source==="recurring"?" 🔁":""}</span>`;
      const del = document.createElement("button");
      del.textContent = "✕";
      del.onclick = ()=>{
        if(item.source === "oneoff") schedule.removeOneOff(item.id);
        else schedule.removeRecurringByTitle(item.title);
        renderSchedule();
      };
      row.appendChild(del);
      el.appendChild(row);
    });
  }
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
    if(tab === "settings") populateSettings();
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
