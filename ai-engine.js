/* ============================================================
   D.A.B.S.y — ai-engine.js : "DABSy AI"
   The ONLY place that talks to an AI service — and it never talks to
   a provider directly. The browser calls YOUR proxy (see backend/):

        browser  ->  DABSy proxy (holds the secret)  ->  AI provider

   There is no API-key field anywhere in the app. If no proxy URL is
   configured (dabsy-config.js) DABSy runs in LIMITED MODE: planning,
   tasks, reminders, timers and offline understanding still work; free
   chat, explanations and live web research say so honestly.

   Public API
     ai.status()            "ready" | "limited" | "checking"
     ai.statusInfo()        { state, label, detail }
     ai.check()             ping /health
     ai.generate(opts)      -> { ok, text, error }
     ai.research(opts)      -> { ok, results, error }      (web search via proxy)
     ai.askJSON(opts)       -> parsed object | null
     ai.parseIntent(text)   -> { type, reply, state, schedule, goal }
     ai.parseGoal(text)     -> offline study-goal extraction
     ai.askConflictQuestion / resolveConflictIntent / askDABSy
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const cfg = () => window.DABSy.config.ai;

  /* ---------------- status ---------------- */
  let state = cfg().proxyUrl ? "checking" : "limited";
  let lastCheck = 0, detail = cfg().proxyUrl ? "Connecting…" : "The AI service isn't set up on this deployment yet.";
  function setState(s, d){ if(state !== s || detail !== d){ state = s; detail = d; bus.emit("ai:status", statusInfo()); } }
  function statusInfo(){
    return {
      state,
      label: state === "ready" ? "Ready" : state === "checking" ? "Checking…" : "Limited mode",
      detail,
    };
  }

  async function post(path, body){
    const base = cfg().proxyUrl.replace(/\/+$/, "");
    if(!base) return { ok: false, error: "no-proxy" };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), cfg().requestTimeoutMs || 25000);
    try{
      const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      let data = null; try{ data = await res.json(); }catch(_){}
      if(res.status === 429){ setState("ready", "Taking a short breather — busy right now."); return { ok: false, error: "rate-limited", retryAfter: data && data.retryAfter }; }
      if(!res.ok || !data || data.ok === false){ return { ok: false, error: (data && data.error) || ("http-" + res.status) }; }
      setState("ready", "Connected");
      return data;
    }catch(e){
      setState("limited", navigator.onLine ? "I couldn't reach the AI service." : "You're offline.");
      return { ok: false, error: navigator.onLine ? "network" : "offline" };
    }finally{ clearTimeout(t); }
  }

  async function check(){
    const base = cfg().proxyUrl.replace(/\/+$/, "");
    if(!base){ setState("limited", "The AI service isn't set up on this deployment yet."); return statusInfo(); }
    if(Date.now() - lastCheck < 20000) return statusInfo();
    lastCheck = Date.now();
    setState("checking", "Connecting…");
    try{
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(base + "/health", { signal: ctl.signal }); clearTimeout(t);
      const d = await r.json().catch(() => ({}));
      if(r.ok && d.ok !== false){
        setState("ready", d.search === false ? "Connected (web research isn't enabled on the service)" : "Connected");
        caps.search = d.search !== false;
      } else setState("limited", "The AI service answered but isn't healthy.");
    }catch(e){ setState("limited", navigator.onLine ? "I couldn't reach the AI service." : "You're offline."); }
    return statusInfo();
  }
  const caps = { search: true };
  window.addEventListener("online", () => { lastCheck = 0; check(); });

  /* ---------------- generation ---------------- */
  function personaSystem(extra){
    const learned = (memory.getSettings().personalizeAI && window.DABSy.learning && window.DABSy.learning.promptSummary) ? window.DABSy.learning.promptSummary() : "";
    const prefs = memory.getPreferences().map(p => p.text).join("; ");
    return [
      "You are D.A.B.S.y, a warm, quietly witty plush study companion for a student. Keep spoken replies short and natural unless explaining a topic.",
      "Today is " + new Date().toDateString() + ", " + new Date().toLocaleTimeString() + ".",
      prefs ? "Things the student asked you to remember: " + prefs + "." : "",
      learned ? "Study habits observed: " + learned : "",
      extra || "",
    ].filter(Boolean).join("\n");
  }

  async function generate(o){
    o = o || {};
    if(state === "limited" && !cfg().proxyUrl) return { ok: false, error: "no-proxy" };
    const r = await post("/v1/generate", { task: o.task || "chat", system: personaSystem(o.system), prompt: o.prompt, json: !!o.json, image: o.image || undefined });
    return r;
  }
  function stripFences(raw){ return String(raw || "").trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim(); }
  function tryJSON(raw){
    try{ return JSON.parse(stripFences(raw)); }catch(e){
      const m = String(raw || "").match(/\{[\s\S]*\}/); if(m){ try{ return JSON.parse(m[0]); }catch(_){} }
      const a = String(raw || "").match(/\[[\s\S]*\]/); if(a){ try{ return JSON.parse(a[0]); }catch(_){} }
      return null;
    }
  }
  async function askJSON(o){
    const r = await generate(Object.assign({}, o, { json: true }));
    if(!r.ok) return null;
    return tryJSON(r.text);
  }
  async function research(o){
    const r = await post("/v1/research", { query: o.query, subject: o.subject || "", level: o.level || "", maxResults: o.maxResults || 8 });
    return r;
  }

  /* ---------------- offline understanding ---------------- */
  const SUBJECTS = [
    ["chemistry", "🧪", /chem(istry)?/i], ["physics", "⚛️", /physics/i], ["maths", "➗", /\b(maths?|mathematics|calculus|algebra|trigonometry)\b/i],
    ["biology", "🧬", /bio(logy)?/i], ["english", "📖", /english|literature/i], ["computer science", "💻", /computer|coding|programming/i],
    ["history", "🏛️", /history/i], ["geography", "🌍", /geograph/i], ["economics", "📈", /econom/i], ["accountancy", "🧾", /account(ancy|s)?/i],
  ];
  const DAYNAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  function subjectOf(text){
    for(const [name, emoji, re] of SUBJECTS) if(re.test(text)) return { name, emoji };
    return null;
  }
  function parseTimeOfDay(t){
    let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i);
    if(m){
      let h = Number(m[1]) % 12; if(/p/i.test(m[3])) h += 12;
      return { hour: h, minute: Number(m[2] || 0) };
    }
    m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if(m){ let h = Number(m[1]); if(h >= 1 && h <= 6 && !/\b0\d:/.test(t)) h += 12; return { hour: h, minute: Number(m[2]) }; }
    m = t.match(/\b(?:at|by|@)\s*(\d{1,2})\b(?!\s*(?:min|hour|hr|h\b))/i);
    if(m){ let h = Number(m[1]); if(h >= 1 && h <= 7) h += 12; if(h <= 23) return { hour: h, minute: 0 }; }
    if(/\bnoon\b/i.test(t)) return { hour: 12, minute: 0 };
    return null;
  }
  function parseDuration(t){
    let m = t.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/i);
    if(m) return Math.round(parseFloat(m[1]) * 60);
    m = t.match(/(\d+)\s*(minutes?|mins?|m)\b/i);
    if(m) return Number(m[1]);
    if(/\b(an|one) hour\b/i.test(t)) return 60;
    if(/\bhalf an hour\b/i.test(t)) return 30;
    return null;
  }
  function parseDayOffset(t){
    const now = new Date();
    if(/\bday after tomorrow\b/i.test(t)) return 2;
    if(/\btomorrow\b/i.test(t)) return 1;
    for(let i = 0; i < 7; i++){
      if(new RegExp("\\b" + DAYNAMES[i] + "\\b", "i").test(t)){
        let off = (i - now.getDay() + 7) % 7;
        if(/\bnext\b/i.test(t) && off === 0) off = 7;
        return off;
      }
    }
    return 0;
  }
  function parseRecurrence(t){
    if(/\b(every ?day|daily|each day|everyday)\b/i.test(t)) return [0,1,2,3,4,5,6];
    if(/\bweekdays\b/i.test(t)) return [1,2,3,4,5];
    if(/\bweekends?\b/i.test(t) && /every|each/i.test(t)) return [0,6];
    const days = [];
    DAYNAMES.forEach((d, i) => { if(new RegExp("every\\s+(?:other\\s+)?(?:[a-z]+,?\\s+(?:and\\s+)?)*" + d, "i").test(t) || new RegExp("every[^.]*\\b" + d + "s?\\b", "i").test(t)) days.push(i); });
    return days.length ? days : null;
  }
  function parseGoal(text){
    const t = String(text || "");
    const subj = subjectOf(t);
    const level = (t.match(/\b(class|grade|std\.?|standard)\s*(\d{1,2})\b/i) || [])[0] || (t.match(/\b(11th|12th|10th|9th|first year|second year)\b/i) || [])[0] || "";
    const minutes = parseDuration(t);
    let topic = "";
    const tm = t.match(/\b(?:chapter|topic|on|about)\s+([A-Za-z0-9 ,'’\-&]+?)(?:\s+(?:today|tonight|tomorrow|for|in|at)\b|[.?!]|$)/i);
    if(tm) topic = tm[1].trim();
    return {
      subject: subj ? subj.name : "", emoji: subj ? subj.emoji : "📚",
      level: level.replace(/\s+/g, " "), topic, minutes: minutes || null,
      when: /tomorrow/i.test(t) ? "tomorrow" : "today", raw: t,
    };
  }

  const STUDY_VERB = /\b(study|studying|revise|revision|learn|prepare for|preparing for|practice|practise|go through|brush up|cover)\b/i;
  const ASKS_FOR_HELP = /\b(want to|wanna|help me|let'?s|plan|need to study|i'?d like to|can we|should i|how should i|what should i)\b/i;

  function titleFrom(t){
    return t
      .replace(/\b(remind me to|remind me|please|can you|could you|schedule|add|set up|i have|i've got|i got|i need to|i want to|i'?m going to|i will)\b/ig, " ")
      .replace(/\b(at|by|@)\s*\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/ig, " ")
      .replace(/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/ig, " ")
      .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, " ")
      .replace(/\bfor\s+\d+(\.\d+)?\s*(hours?|hrs?|h|minutes?|mins?|m)\b/ig, " ")
      .replace(/\b(every ?day|daily|each day|everyday|weekdays|every [a-z, ]+?(?=\s+(at|for)\b|$)|today|tonight|tomorrow|day after tomorrow|next)\b/ig, " ")
      .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/ig, " ")
      .replace(/\s+/g, " ").replace(/^[\s,.\-]+|[\s,.\-?!]+$/g, "")
      .replace(/^(to|a|an|the)\s+/i, "");
  }

  function localParse(text){
    const t = String(text || "").trim();
    const time = parseTimeOfDay(t);
    const removeRe = /\b(cancel|delete|remove|drop|scrap|forget about|clear)\b/i;
    const subj = subjectOf(t);

    if(removeRe.test(t) && /\b(task|reminder|class|lecture|study|revision|homework|meeting|event|session|practice|[a-z]+)\b/i.test(t) && !/\b(history|data|everything|memory)\b/i.test(t)){
      const title = titleFrom(t.replace(removeRe, " ").replace(/\b(my|the|that|reminder|task|event)\b/ig, " "));
      if(title) return { type: "schedule_remove", reply: `Okay, I'll take "${title}" off.`, state: "IDLE", schedule: { title } };
    }
    if(STUDY_VERB.test(t) && (!time || ASKS_FOR_HELP.test(t)) && (subj || ASKS_FOR_HELP.test(t))){
      const goal = parseGoal(t);
      return { type: "study_goal", reply: "", state: "FOCUSED", goal };
    }
    if(time){
      const recur = parseRecurrence(t);
      const title = titleFrom(t) || (subj ? subj.name + " study" : "Task");
      return {
        type: "schedule_add", reply: "", state: "HAPPY", local: true,
        schedule: {
          title: title.charAt(0).toUpperCase() + title.slice(1), hour: time.hour, minute: time.minute,
          duration_minutes: parseDuration(t) || 30, recurring: !!recur, days: recur || [], date_offset_days: parseDayOffset(t),
          category: subj ? "study" : null, emoji: subj ? subj.emoji : null,
        },
      };
    }
    if(/\b(remind me|add (a )?task|note to self|to-?do)\b/i.test(t)){
      const title = titleFrom(t);
      if(title) return { type: "task_add", reply: "", state: "HAPPY", task: { title: title.charAt(0).toUpperCase() + title.slice(1), durationMin: parseDuration(t) || 30 } };
    }
    return null;
  }

  const LIMITED_REPLIES = [
    "I'm in limited mode, so I can't chat freely yet. I can still plan, schedule and remind. Try \"study chemistry for 45 minutes\".",
    "My thinking service isn't connected yet. Planning, tasks and reminders all work offline, though.",
  ];
  function limitedReply(kind){
    if(kind === "rate-limited") return "I'm a bit overloaded right now. Give me a moment and ask again.";
    if(kind === "offline") return "You're offline, so I can only do offline things like tasks, reminders and plans.";
    return LIMITED_REPLIES[Math.floor(Math.random() * LIMITED_REPLIES.length)];
  }
  function errorLine(err){
    if(err === "rate-limited") return "I'm a bit overloaded right now. Try again in a moment.";
    if(err === "offline") return "You're offline right now.";
    if(err === "no-proxy") return "My thinking service isn't set up yet, so I'm in limited mode.";
    return "I couldn't reach my thinking service just now.";
  }

  const VALID_STATES = ["IDLE","CURIOUS","HAPPY","FOCUSED","THINKING","SURPRISED","PLAYFUL","STUDY_FOCUS","CONFUSED","SUCCESS"];

  /* ---------------- main intent parser ---------------- */
  async function parseIntent(text){
    const local = localParse(text);
    // The offline rules are exact and free, so a rule match wins; the model handles everything the rules don't recognise.
    if(local) return local;
    const canAI = cfg().proxyUrl && state !== "limited";
    if(!canAI) return { type: "chat", reply: limitedReply(), state: "CONFUSED", schedule: null, limited: true };
    const recent = memory.getSession(6).map(m => m.role + ": " + m.text).join("\n");
    const prompt = [
      recent ? "Recent conversation:\n" + recent : "",
      "The user just said something. Decide what kind of message it is and respond with ONLY a JSON object, no markdown:",
      `{"type":"chat"|"schedule_add"|"schedule_remove"|"study_goal"|"task_add","reply":"<short spoken reply>","state":"IDLE|CURIOUS|HAPPY|FOCUSED|THINKING|SURPRISED|PLAYFUL|STUDY_FOCUS|CONFUSED",
"schedule":{"title":"","hour":<number>,"minute":<number>,"duration_minutes":<number>,"recurring":false,"days":[0-6],"date_offset_days":<number>,"category":"study|college|homework|personal|creative|meeting|important|deadline|null","emoji":"<one emoji or null>"},
"goal":{"subject":"","level":"","topic":"","minutes":<number|null>,"when":"today|tomorrow"},
"task":{"title":"","durationMin":<number>}}`,
      'Use "schedule_add" ONLY with an explicit clock time; hour/minute must be JSON numbers. Use "study_goal" when they want to study/revise/learn something and want help doing it. Use "task_add" for a to-do without a time. "schedule" only for schedule_add/remove, "goal" only for study_goal, "task" only for task_add.',
      "User: " + text,
    ].filter(Boolean).join("\n");
    const obj = await askJSON({ task: "intent", prompt });
    if(!obj){ return { type: "chat", reply: errorLine("net"), state: "CONFUSED", schedule: null }; }
    const type = ["schedule_add","schedule_remove","study_goal","task_add"].includes(obj.type) ? obj.type : "chat";
    const out = { type, reply: typeof obj.reply === "string" ? obj.reply : "", state: VALID_STATES.includes(obj.state) ? obj.state : "IDLE", schedule: obj.schedule || null, goal: obj.goal || null, task: obj.task || null };
    if(type === "study_goal"){ const g = parseGoal(text); out.goal = Object.assign({}, g, Object.fromEntries(Object.entries(obj.goal || {}).filter(([, v]) => v))); }
    return out;
  }

  /* ---------------- conflict conversation ---------------- */
  const fmt = d => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  async function askConflictQuestion(candidate, conflict){
    const fallback = { reply: `You already have "${conflict.title}" around ${fmt(conflict.start)}. Want me to move it, cancel it, or keep both?`, state: "CURIOUS" };
    if(!cfg().proxyUrl || state === "limited") return fallback;
    const obj = await askJSON({ task: "conflict", prompt: [
      "There is a real scheduling conflict. Describe it in one or two short spoken sentences and ask what to do. Offer: move the existing item, cancel the existing item, or keep both.",
      `New: "${candidate.title}" at ${fmt(candidate.start)}. Existing: "${conflict.title}" at ${fmt(conflict.start)}.`,
      'Respond ONLY with JSON: {"reply":"","state":"CURIOUS"}' ].join("\n") });
    return obj && obj.reply ? { reply: obj.reply, state: "CURIOUS" } : fallback;
  }
  async function resolveConflictIntent(text, candidate, conflict){
    const t = text.toLowerCase();
    const local = /\b(keep|both|anyway|double)\b/.test(t) ? "keep_both"
      : /\b(move|shift|push|later|reschedule)\b/.test(t) ? "move_existing"
      : /\b(cancel|delete|remove|drop)\b/.test(t) ? (/\b(new|that one|the new)\b/.test(t) ? "cancel_new" : "cancel_existing")
      : /\b(never ?mind|forget it|no)\b/.test(t) ? "cancel_new" : null;
    if(local) return { action: local, reply: { move_existing: "Okay, I'll move the old one.", cancel_existing: "Done, the old one is gone.", keep_both: "Keeping both.", cancel_new: "Okay, I won't add it." }[local], state: "HAPPY" };
    if(cfg().proxyUrl && state !== "limited"){
      const obj = await askJSON({ task: "conflict", prompt: [`The user is answering a scheduling conflict question. New: "${candidate.title}". Existing: "${conflict.title}". Answer: "${text}"`,
        'Respond ONLY with JSON: {"action":"move_existing|cancel_existing|keep_both|cancel_new|unclear","reply":"<short confirmation>","state":"HAPPY|IDLE|CONFUSED"}'].join("\n") });
      if(obj && ["move_existing","cancel_existing","keep_both","cancel_new"].includes(obj.action)) return { action: obj.action, reply: obj.reply || "Got it.", state: VALID_STATES.includes(obj.state) ? obj.state : "IDLE" };
    }
    return { action: "unclear", reply: "Sorry, I didn't catch that. Move it, cancel it, or keep both?", state: "CONFUSED" };
  }

  /* ---------------- long-form answers (Study Block, in-session questions) ---------------- */
  async function askDABSy(prompt, opts){
    opts = opts || {};
    const r = await generate({ task: opts.task || "explain", system: opts.context, prompt: [
      'Reply with ONLY JSON: {"reply":"<answer; for explanations use short numbered steps like 1) 2) 3)>","state":"FOCUSED"}', "User: " + prompt ].join("\n"), image: opts.imageBase64, json: true });
    if(!r.ok) return { text: errorLine(r.error), state: "CONFUSED", ok: false, error: r.error };
    const obj = tryJSON(r.text);
    return { text: (obj && obj.reply) || r.text, state: obj && VALID_STATES.includes(obj.state) ? obj.state : "FOCUSED", ok: true };
  }

  window.DABSy.ai = {
    status: () => state, statusInfo, check, generate, askJSON, research, localParse, parseGoal, parseIntent,
    askConflictQuestion, resolveConflictIntent, askDABSy, errorLine, limitedReply, parseTimeOfDay, parseDuration, subjectOf,
    get canSearch(){ return state !== "limited" && caps.search; },
  };
  window.addEventListener("load", () => setTimeout(check, 1500));
})();
