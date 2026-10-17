/* ============================================================
   D.A.B.S.y — calendar-intel.js : understands commitments and files them in Ghibli Calendar
   DABSy.calIntel = { interpret, resolveDate, handle, answer, hasPending, CATEGORY_MAP }

   1. interpret(text, now)  rule-based, offline, deterministic -> a PROPOSAL:
        { intent, category, title, date, startTime, endTime, durationMin, priority, notes,
          dateLabel, ask, confidence }
      `date` is YYYY-MM-DD resolved in the device's LOCAL timezone. Nothing is invented: a
      missing time stays null; a missing/ambiguous date becomes a short question (`ask`).
   2. If the rules are unsure and the AI Worker is configured, the model is asked for the same
      fields (it is given today's local date) and its answer is validated before use.
   3. handle(text) saves through DABSyCore.saveEvent (idempotent, read-back verified), then
      confirms honestly: category, date, and whether Ghibli Calendar has acknowledged it.

   Categories are Ghibli Calendar's REAL ones (state.js CATEGORIES): study, college, homework,
   personal, creative, meeting, important, deadline. Ghibli has no "test", "priority" or
   "deadline" field, so those are expressed through category + notes (see CATEGORY_MAP).
   ============================================================ */
(function(){
  const D = window.DABSy;
  const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const pad = n => String(n).padStart(2, "0");
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  /* intent -> Ghibli category. Order = priority (first match wins). */
  const INTENTS = [
    { intent: "submission", cat: "deadline",  re: /\b(submit|submission|hand ?in|turn ?in|last date|deadline)\b/i },
    { intent: "homework",   cat: "homework",  re: /\b(home ?work|hw|assignment|worksheet|problem set|practice sheet)\b/i },
    { intent: "study",      cat: "study",     re: /\b(study|studying|revise|revision|learn|brush up)\b/i },
    { intent: "test",       cat: "important", re: /\b(test|exam|examination|quiz|viva|mid-?terms?|prelims?|finals?|unit test|practical exam)\b/i },
    { intent: "college",    cat: "college",   re: /\b(college|campus|lecture|seminar|class|fest|workshop|orientation|farewell|annual day|convocation|presentation|lab)\b/i },
    { intent: "meeting",    cat: "meeting",   re: /\b(meeting|interview|appointment|stand-?up|catch ?up|sync (up )?with|call with|zoom|webinar)\b/i },
    { intent: "creative",   cat: "creative",  re: /\b(draw|paint|sketch|compose|guitar|piano|sing|design|edit(ing)? (a )?video|photograph|write (a )?(story|poem|song|blog))\b/i },
    { intent: "personal",   cat: "personal",  re: /\b(call|friend|family|mom|mum|dad|birthday|gym|workout|doctor|dentist|bank|buy|groceries|party|trip|dinner|lunch|movie|haircut)\b/i },
  ];
  const CATEGORY_MAP = INTENTS.map(i => ({ intent: i.intent, category: i.cat })).concat([{ intent: "unknown+urgent", category: "important" }]);

  const COMMIT = /\b(remind me|reminder|i have|i've got|i got|i need to|i must|i have to|i've to|i gotta|don'?t let me forget|don'?t forget|schedule|put .* (on|in) (my )?calendar|add .* (to|on) (my )?calendar|is (on|due|at|tomorrow|today|tonight)|is coming up|due (on|by|tomorrow|today|tonight)|there'?s a|we have a|i'?m having)\b/i;
  const QUESTION = /^(what|when|why|how|who|which|can you explain|explain|tell me about|do i have|am i|is there|are there|show|list|open)\b/i;
  const WANTS_HELP = /\b(want to|wanna|help me|let'?s|can we|how (do|should)|i'?d like to)\b/i;

  function parseTime(t){
    return D.ai && D.ai.parseTimeOfDay ? D.ai.parseTimeOfDay(t) : null;
  }
  function parseDuration(t){ return D.ai && D.ai.parseDuration ? D.ai.parseDuration(t) : null; }

  /* ---------- dates, in the device's local timezone ---------- */
  // -> { date, label, part, ask } ; date null + ask => needs a question ; date null + no ask => none mentioned
  function resolveDate(text, now){
    now = now || new Date();
    const t = String(text).toLowerCase();
    const today = startOfDay(now), out = (d, part) => ({ date: key(d), part: part || null, label: label(d, today) });
    let m;
    if(/\bday after tomorrow\b/.test(t)) return out(addDays(today, 2));
    if(/\b(tomorrow|tmrw|tmr)\b/.test(t)) return out(addDays(today, 1), /\b(morning|afternoon|evening|night)\b/.exec(t)?.[1]);
    if(/\b(tonight|tonite|this evening|this afternoon|this morning|today)\b/.test(t)){
      const p = /\b(tonight|tonite)\b/.test(t) ? "night" : /evening/.test(t) ? "evening" : /afternoon/.test(t) ? "afternoon" : /morning/.test(t) ? "morning" : null;
      return out(today, p);
    }
    if((m = t.match(/\bin (\d{1,2}|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/))){
      const w = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }, n = w[m[1]] || Number(m[1]);
      return out(addDays(today, n * (/week/.test(m[2]) ? 7 : 1)));
    }
    // explicit calendar dates (day-first, as is usual in India): 25 oct / oct 25 / 25th october / 25/10[/2026]
    const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
    let day = null, month = null, year = null;
    if((m = t.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?" + mon + "(?:\\s+(\\d{4}))?\\b")))){ day = +m[1]; month = MONTHS.indexOf(m[2].slice(0, 3)); year = m[3] ? +m[3] : null; }
    else if((m = t.match(new RegExp("\\b" + mon + "\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b")))){ month = MONTHS.indexOf(m[1].slice(0, 3)); day = +m[2]; year = m[3] ? +m[3] : null; }
    else if((m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/)) && !/\d:\d/.test(m[0])){ day = +m[1]; month = +m[2] - 1; year = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null; }
    if(day != null && month >= 0 && month < 12 && day >= 1 && day <= 31){
      let d = new Date(year || today.getFullYear(), month, day);
      if(d.getMonth() !== month) return { date: null, ask: "That date doesn't exist. Which day did you mean?" };
      if(!year && d < today) d = new Date(today.getFullYear() + 1, month, day);
      if(d < today) return { date: null, ask: `That date has already passed (${label(d, today)}). Did you mean a later one?` };
      return out(d);
    }
    // weekdays
    for(let i = 0; i < 7; i++){
      const re = new RegExp("\\b(next|this|coming|on)?\\s*" + DAYS[i] + "s?\\b");
      if((m = t.match(re)) && !/\bevery\b/.test(t)){
        const diff = (i - today.getDay() + 7) % 7;
        if(diff === 0 && m[1] !== "next") return { date: null, ask: `Do you mean today or next ${cap(DAYS[i])}?` };
        return out(addDays(today, diff === 0 ? 7 : diff));        // "next Monday" = the first Monday after today
      }
    }
    if(/\b(next week|this week|weekend|next month|soon|sometime|later)\b/.test(t)) return { date: null, ask: "Which day exactly should I put it on?" };
    return { date: null };
  }
  function label(d, today){
    const diff = Math.round((startOfDay(d) - today) / 86400000);
    const base = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    return diff === 0 ? `today (${base})` : diff === 1 ? `tomorrow (${base})` : base;
  }

  /* ---------- title ---------- */
  const DATEBITS = [
    /\b(?:on|by|before|for|until|till|due|is|are|will be)?\s*(?:next|this|coming)?\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/ig,
    /\b(?:on|by|before|for|due|is|are)?\s*(?:day after tomorrow|tomorrow|tmrw|tmr|tonight|tonite|today|this (?:evening|afternoon|morning))\b/ig,
    /\bin (?:\d{1,2}|a|one|two|three|four|five|six|seven) (?:days?|weeks?)\b/ig,
    /\b(?:on|by|before|due)?\s*\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+\d{4})?/ig,
    /\b(?:on|by|before|due)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/ig,
    /\b(?:at|by|@)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/ig,
    /\b(?:at|by|@)\s*\d{1,2}:\d{2}\b/ig,
    /\bfor\s+\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/ig,
  ];
  function titleOf(text){
    let t = " " + text + " ";
    DATEBITS.forEach(re => { t = t.replace(re, " "); });
    t = t
      .replace(/\b(please|hey|dabsy|remind me to|remind me about|remind me|reminder to|reminder|i have to|i've to|i have got to|i have a|i have an|i have|i've got a|i've got|i got a|i need to|i must|i gotta|don'?t let me forget to|don'?t forget to|don'?t forget|schedule|add|there'?s a|we have a|i'?m having a?)\b/ig, " ")
      .replace(/\b(is|are|will be)\b/ig, " ")
      .replace(/\bmy\b/ig, " ")
      .replace(/[.!?,;]+/g, " ").replace(/\s+/g, " ").trim()
      .replace(/^(to|a|an|the|on|at|by|for)\s+/i, "").replace(/\s+(on|at|by|for|to|the|a|an)$/i, "");
    return cap(t);
  }

  /* ---------- interpret ---------- */
  function interpret(text, now){
    const raw = String(text || "").trim();
    if(!raw || raw.length > 400) return null;
    if(QUESTION.test(raw) && !/\bremind me\b/i.test(raw)) return null;
    const nowD = now || new Date();
    const dt = resolveDate(raw, nowD), tm = parseTime(raw), dur = parseDuration(raw);
    const hit = INTENTS.find(i => i.re.test(raw));
    const commit = COMMIT.test(raw) || (!!hit && (dt.date || dt.ask) && /\b(test|exam|quiz|submit|submission|due|event|meeting|class|lecture|deadline)\b/i.test(raw));
    if(!commit) return null;
    if(/\bevery ?(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\bdaily|\bweekdays\b/i.test(raw)) return { recurring: true, intent: hit ? hit.intent : "reminder" };   // recurring habits stay with DABSy's own reminders
    if(!dt.date && !dt.ask && !tm) return null;                    // no when at all: not a calendar entry (task / study planner handle it)
    if(hit && hit.intent === "study" && WANTS_HELP.test(raw) && !dt.date && !tm) return null;   // "I want to study X": the study planner's job
    const urgent = /\b(urgent|asap|important|critical|high priority|must)\b/i.test(raw);
    const low = /\b(low priority|when i'?m free|whenever|no rush)\b/i.test(raw);
    const intent = hit ? hit.intent : (urgent ? "important" : "reminder");
    const category = hit ? hit.cat : (urgent ? "important" : "personal");
    let date = dt.date, ask = dt.ask || null, label_ = dt.label || "";
    if(!date && !ask && tm){                                       // a time with no day: today if still ahead, otherwise ask — never silently roll over
      const mins = nowD.getHours() * 60 + nowD.getMinutes();
      if(tm.hour * 60 + tm.minute >= mins){ date = key(nowD); label_ = label(nowD, startOfDay(nowD)); }
      else ask = "That time has already passed today. Should I put it tomorrow?";
    }
    const startTime = tm ? `${pad(tm.hour)}:${pad(tm.minute)}` : null;
    let endTime = null, durationMin = dur || null;
    if(startTime){ const e = tm.hour * 60 + tm.minute + (dur || 30); endTime = `${pad(Math.floor(e / 60) % 24)}:${pad(e % 60)}`; }
    const notes = [];
    if(dt.part && !tm) notes.push(`When: ${dt.part}`);
    if(intent === "submission" || intent === "homework" || intent === "test") notes.push(`Type: ${({ submission: "submission", homework: "homework", test: "test / exam" })[intent]}`);
    if(urgent) notes.push("Priority: high"); else if(low) notes.push("Priority: low");
    if(dur && !tm) notes.push(`Duration: ${dur} min`);
    let title = titleOf(raw) || cap(hit ? hit.intent : "Reminder");
    if(intent === "test" && !/\b(test|exam|quiz|viva)/i.test(title)) title += " test";
    return {
      intent, category, title, date, startTime, endTime, durationMin,
      priority: urgent ? "high" : low ? "low" : "normal", notes: notes.join(" · "),
      dateLabel: label_, ask, confidence: hit ? "high" : "low", source: "rules",
    };
  }

  /* ---------- AI refinement (only when the rules are unsure and the Worker is configured) ---------- */
  const CATS = ["study","college","homework","personal","creative","meeting","important","deadline"];
  async function refineWithAI(text, p, now){
    const ai = D.ai;
    if(!ai || ai.status() === "limited" || !(D.config.ai && D.config.ai.proxyUrl)) return p;
    const n = now || new Date();
    const obj = await ai.askJSON({ task: "intent", prompt: [
      `Today is ${DAYS[n.getDay()]} ${key(n)} (device local timezone, UTC${-n.getTimezoneOffset() >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(n.getTimezoneOffset()) / 60))}:${pad(Math.abs(n.getTimezoneOffset()) % 60)}).`,
      "Classify this message. Reply ONLY with JSON:",
      '{"is_commitment":true|false,"category":"study|college|homework|personal|creative|meeting|important|deadline","title":"short title","date":"YYYY-MM-DD or null","time":"HH:MM or null","duration_minutes":number|null,"priority":"high|normal|low","notes":"","clarify":"one short question if the date is missing or ambiguous, else null"}',
      "Never invent a date or a time the user did not say or clearly imply. Tests/exams are \"important\"; submissions are \"deadline\".",
      "Message: " + text ].join("\n") }).catch(() => null);
    if(!obj || typeof obj !== "object" || obj.is_commitment === false) return p;
    const cat = CATS.includes(obj.category) ? obj.category : null;
    const okDate = typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) && obj.date >= key(n);
    const okTime = typeof obj.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(obj.time);
    const base = p || { intent: "reminder", priority: "normal", notes: "", title: "", date: null, startTime: null, endTime: null, durationMin: null, ask: null };
    const r = Object.assign({}, base, { source: "ai", confidence: "ai" });
    if(cat) r.category = cat; else if(!r.category) r.category = "personal";
    if(typeof obj.title === "string" && obj.title.trim() && !base.title) r.title = cap(obj.title.trim().slice(0, 80));
    if(!r.date && okDate){ r.date = obj.date; r.ask = null; r.dateLabel = label(new Date(obj.date + "T00:00:00"), startOfDay(n)); }
    if(!r.startTime && okTime){ r.startTime = obj.time; const [h, m] = obj.time.split(":").map(Number), e = h * 60 + m + (Number(obj.duration_minutes) || 30); r.endTime = `${pad(Math.floor(e / 60) % 24)}:${pad(e % 60)}`; }
    if(!r.date && !r.ask) r.ask = (typeof obj.clarify === "string" && obj.clarify) || "Which day should I put it on?";
    if(["high","low"].includes(obj.priority) && r.priority === "normal") r.priority = obj.priority;
    if(!r.title) return p;
    return r;
  }

  /* ---------- saving + wording ---------- */
  const catLabel = c => (window.DABSyCore.CATEGORIES[c] || {}).label || c;
  function describe(p){ return `${catLabel(p.category)} · ${p.dateLabel || p.date}${p.startTime ? " at " + p.startTime : ""}`; }

  async function save(p){
    const Core = window.DABSyCore;
    const r = Core.saveEvent({ title: p.title, date: p.date, startTime: p.startTime, endTime: p.endTime, category: p.category, notes: p.notes, source: "dabsy" });
    if(!r.ok) return { ok: false, text: `I couldn't save "${p.title}" to the calendar (${friendly(r.error)}). Nothing was added — want me to try again?`, error: r.error };
    const acked = r.created ? await Core.whenAcked(r.event.id, 2200) : false;
    let tail = acked ? " It's showing in Ghibli Calendar now."
      : " Ghibli Calendar will show it as soon as you open it or switch back to it.";
    const where = describe(p);
    const text = r.duplicate
      ? `"${r.event.title}" is already on your calendar (${where}), so I didn't add it twice.`
      : `Saved "${r.event.title}" — ${where}.${tail}`;
    return { ok: true, text, event: r.event, acked, duplicate: r.duplicate };
  }
  const friendly = e => ({ "QuotaExceededError": "browser storage is full", "SecurityError": "browser storage is blocked", "storage-error": "browser storage isn't available", "verify-failed": "I couldn't read it back to confirm", "bad-date": "the date wasn't valid" })[e] || String(e || "unknown problem");

  /* ---------- conversation glue ---------- */
  let pending = null;                                              // { p, awaiting: "date" | "confirm" }
  const hasPending = () => !!pending;
  function link(){ return window.DABSyCore && window.DABSyCore.getConnections().calendar; }

  async function route(p){
    const Core = window.DABSyCore, c = link();
    if(!c || !c.enabled){
      // Calendar isn't connected: keep it as a DABSy task rather than losing it, and say so.
      const due = p.date ? new Date(p.date + "T" + (p.startTime || "09:00") + ":00") : null;
      const t = D.tasks && D.tasks.add({ title: p.title, dueAt: p.startTime && due ? due.toISOString() : null, deadline: !p.startTime && due ? due.toISOString() : null, notes: p.notes, category: p.category, source: "chat" });
      return { text: `${cap(p.intent === "reminder" ? "reminder" : p.intent)} noted for ${p.dateLabel || p.date}${t ? " and saved to your DABSy tasks" : ""}. Ghibli Calendar isn't connected, so it isn't on the calendar — turn it on in Settings → Apps if you'd like that.`, state: "HAPPY" };
    }
    if(c.level === "read") return { text: `I understood "${p.title}" (${describe(p)}), but I only have permission to read your calendar. Switch Calendar to Suggest or Automatic in Settings and I'll add it.`, state: "CURIOUS" };
    if(c.level === "suggest"){ pending = { p, awaiting: "confirm" }; return { text: `Add "${p.title}" to Ghibli Calendar as ${describe(p)}? (yes / no)`, state: "CURIOUS" }; }
    const conflicts = p.startTime ? Core.findConflicts(p.date, { startTime: p.startTime, endTime: p.endTime }) : [];
    const r = await save(p);
    if(D.bus) D.bus.emit("schedule:changed");
    return { text: r.text + (conflicts.length && r.ok && !r.duplicate ? ` Heads up: that overlaps "${conflicts[0].title}".` : ""), state: r.ok ? "HAPPY" : "CONFUSED" };
  }

  // returns { text, state } when it handled the utterance, otherwise null (legacy flows continue)
  async function handle(text, now){
    let p = interpret(text, now);
    if(p && p.recurring) return null;
    // v10.3: the AI refinement used to run for EVERY message that the rules did not recognise, so an ordinary chat message cost
    // two sequential AI requests (this one, then the chat reply). It now only runs when the text carries a scheduling cue.
    const CUE = /\b(\d{1,2}(:\d{2})?\s*(am|pm)|\d{1,2}:\d{2}|today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|noon|midnight|morning|evening|o'?clock|exam|test|quiz|meeting|lecture|class|deadline|submission|submit|due|appointment|remind)\b/i;
    if(!p && !CUE.test(String(text))) return null;
    if(!p || p.confidence === "low" || (!p.date && !p.ask)){
      const refined = await refineWithAI(text, p, now).catch(() => p);
      if(refined) p = refined;
    }
    if(!p || p.recurring || !p.title) return null;
    if(p.ask || !p.date){ pending = { p, awaiting: "date" }; return { text: p.ask || "Which day should I put it on?", state: "CURIOUS" }; }
    return route(p);
  }

  // the next utterance after a question; null = not an answer (caller carries on normally)
  async function answer(text, now){
    if(!pending) return null;
    const { p, awaiting } = pending, t = String(text).trim();
    if(/^(no|nope|nah|cancel|never ?mind|forget it|stop|don'?t)\b/i.test(t)){ pending = null; return { text: "Okay, I won't add it.", state: "IDLE" }; }
    if(awaiting === "confirm"){
      if(/\b(yes|yeah|yep|sure|ok|okay|do it|go ahead|please|correct)\b/i.test(t)){ pending = null; const r = await save(p); if(D.bus) D.bus.emit("schedule:changed"); return { text: r.text, state: r.ok ? "HAPPY" : "CONFUSED" }; }
      pending = null; return null;
    }
    // awaiting a date
    let d = resolveDate(t, now);
    if(!d.date && /\b(yes|yeah|yep|sure|ok|okay)\b/i.test(t) && /tomorrow/i.test(p.ask || "")) d = resolveDate("tomorrow", now);
    if(!d.date && /\btoday\b/.test(t.toLowerCase())) d = resolveDate("today", now);
    if(!d.date){ if(d.ask){ return { text: d.ask, state: "CURIOUS" }; } pending = null; return null; }   // not an answer: drop the question, handle normally
    pending = null;
    const filled = Object.assign({}, p, { date: d.date, dateLabel: d.label, ask: null });
    return route(filled);
  }

  window.DABSy.calIntel = { interpret, resolveDate, handle, answer, hasPending, refineWithAI, CATEGORY_MAP, titleOf };
})();
