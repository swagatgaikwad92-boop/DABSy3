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
    if(cfg().mode === "message"){
      // dabsy-brain has no /health route; the first real reply is the proof. Don't claim "Ready" before that.
      caps.search = false;
      if(state === "checking") setState("ready", "Set up. I'll confirm the connection on my first reply.");
      return statusInfo();
    }
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
  const caps = { search: cfg().mode !== "message" };
  window.addEventListener("online", () => { lastCheck = 0; check(); });

  /* ---------------- generation ---------------- */
  function personaSystem(extra){
    const learned = (memory.getSettings().personalizeAI && window.DABSy.learning && window.DABSy.learning.promptSummary) ? window.DABSy.learning.promptSummary() : "";
    const prefs = memory.getPreferences().map(p => p.text).join("; ");
    return [
      "You are D.A.B.S.y: a small, warm digital desk pet and a capable personal butler for a student. You combine the discretion of a private butler, the organisation of an executive assistant and the patience of a good tutor, with a gentle companion personality. Speak with controlled warmth and understated elegance. Be concise; no excessive emojis, no repeated greetings, no empty motivation, no generic chatbot disclaimers.",
      "Principle: never make the student do organisational work you can reasonably do. Interpret what they are actually trying to achieve and answer with the most useful next step. If something is missing but a sensible draft is possible, give the draft and name your assumption; ask at most ONE short question, and only when the answer would materially change the result. Never answer 'plan my day' by telling them to add a task.",
      "Honesty about actions: you only talk in this chat. The app itself (not you) saves tasks and schedules through its buttons. So NEVER say you saved, added, moved, deleted, scheduled or reminded anything. You may say what you suggest and that the student can ask 'plan my day', 'plan my week', 'what should I do next', 'I have 30 minutes free', 'help me prepare for my exam', 'move my unfinished tasks to tomorrow' or 'remind me about this later' and the app will do it. Do not invent appointments, deadlines, tasks or calendar entries; use only the facts below.",
      (window.DABSy.bmem && window.DABSy.bmem.prompt) ? window.DABSy.bmem.prompt() : "",
      "A student's day is not only study: rest, meals, exercise, chores, friends and family matter too. Never steer every conversation toward studying or tasks; follow what the student wants to talk about, and offer to organise only when it fits.",
      (window.DABSy.dayplan && window.DABSy.dayplan.contextLine) ? "Facts from the app right now: " + window.DABSy.dayplan.contextLine() : "",
      "Today is " + new Date().toDateString() + ", " + new Date().toLocaleTimeString() + ".",
      prefs ? "Things the student asked you to remember: " + prefs + "." : "",
      learned ? "Study habits observed: " + learned : "",
      (function(){ const L = memory.getSettings().replyLang; const n = { en: "English", hi: "Hindi (Devanagari)", mr: "Marathi (Devanagari)" }[L];
        return n ? "Always reply in " + n + " unless the student clearly writes in another language; keep equations and technical terms readable." : "Reply in the language the student wrote in (English, Hindi, Marathi or a natural mix)."; })(),
      extra || "",
    ].filter(Boolean).join("\n");
  }

  // dabsy-brain contract: POST { message } -> { reply }. It takes ONE string, so the persona
  // and the prompt are joined into it. Nothing is stored server-side, and no history is sent.
  // A provider failure can arrive as an HTTP error, as {error:"..."} or — with some Workers — as an ordinary-looking 200 reply
  // whose text is the failure ("Gemini request failed"). None of those may be shown as if DABSy had said it.
  const FAIL_TEXT = /^\s*(gemini|google|openai|anthropic|claude|the ai|ai|request|api|upstream|server)\b[^\n]{0,60}\b(fail(ed|ure)?|error|unavailable|timed? ?out|quota|overloaded|exceeded)\b/i;
  const isTransient = e => e === "network" || e === "timeout" || e === "provider" || /^(http-5\d\d|provider-5\d\d|http-429)$/.test(e || "");
  async function postMessage(message){
    const base = cfg().proxyUrl.replace(/\/+$/, "");
    if(!base) return { ok: false, error: "no-proxy" };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), cfg().requestTimeoutMs || 25000);
    try{
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), signal: ctl.signal });
      let data = null; try{ data = await res.json(); }catch(_){}
      if(res.status === 429){ setState("ready", "Taking a short breather — busy right now."); return { ok: false, error: "rate-limited" }; }
      if(!res.ok){ setState("checking", "The last request failed. I'll retry on your next message."); return { ok: false, error: data && data.error ? "provider" : "http-" + res.status }; }
      if(data && data.error && !data.reply){ return { ok: false, error: "provider" }; }
      if(!data || typeof data.reply !== "string" || !data.reply.trim()){ return { ok: false, error: "bad-response" }; }
      if(FAIL_TEXT.test(data.reply) && data.reply.length < 160){ setState("checking", "The AI provider reported a failure."); return { ok: false, error: "provider" }; }
      setState("ready", "Connected");
      return { ok: true, text: data.reply.trim() };
    }catch(e){
      const aborted = e && e.name === "AbortError";
      setState("checking", navigator.onLine ? (aborted ? "That took too long. I'll retry on your next message." : "I couldn't reach the AI service. I'll retry on your next message.") : "You're offline.");
      return { ok: false, error: !navigator.onLine ? "offline" : aborted ? "timeout" : "network" };
    }finally{ clearTimeout(t); }
  }
  // one quiet retry for transient trouble (a flaky mobile connection, a provider hiccup) — never for rate limits, offline or bad input
  async function withRetry(fn){
    let r = await fn();
    if(!r.ok && isTransient(r.error) && navigator.onLine){ await new Promise(res => setTimeout(res, 700)); r = await fn(); }
    return r;
  }

  async function generate(o){
    o = o || {};
    if(state === "limited" && !cfg().proxyUrl) return { ok: false, error: "no-proxy" };
    if(cfg().mode === "message"){
      // images can't go through the single-message backend; say so instead of silently dropping them
      if(o.image) return { ok: false, error: "no-image" };
      const sys = personaSystem(o.system) + (o.json ? "\nRespond with valid JSON only. No markdown." : "");
      return withRetry(() => postMessage(sys + "\n\n" + (o.prompt || "")));
    }
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
    if(cfg().mode === "message") return { ok: false, error: "no-search" };
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

  // A student often names a topic, not a subject ("Newton's laws"). These map well-known topic words to the subject they belong to.
  const TOPIC_HINTS = [
    [/\b(newton|kinematics?|momentum|friction|projectile|torque|inertia|work[, ]energy|gravitation|optics|refraction|thermodynamics|circuits?|ohm'?s|magnetism|waves?|electrostatics)\b/i, "physics"],
    [/\b(mole concept|stoichiometry|periodic table|acids?|bases?|organic|redox|chemical bonding|equilibrium|electrochemistry|alkanes?|hybridi[sz]ation)\b/i, "chemistry"],
    [/\b(mitosis|meiosis|photosynthesis|respiration|dna|genetics|evolution|enzymes?|ecosystems?|cell division|human heart)\b/i, "biology"],
    [/\b(derivatives?|integrals?|quadratic|trigonometry|matrices|matrix|probability|limits|geometry|pythagoras|logarithms?|polynomials?)\b/i, "maths"],
  ];
  function subjectOf(text){
    for(const [name, emoji, re] of SUBJECTS) if(re.test(text)) return { name, emoji };
    for(const [re, name] of TOPIC_HINTS){ if(re.test(text)){ const hit = SUBJECTS.find(x => x[0] === name); return { name, emoji: hit ? hit[1] : "📚" }; } }
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
    let m = t.match(/(\d+(?:\.\d+)?)\s*-?\s*(hours?|hrs?|h)\b/i);
    if(m) return Math.round(parseFloat(m[1]) * 60);
    m = t.match(/(\d+)\s*-?\s*(minutes?|mins?|m)\b/i);
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
    const STOP = "(?=\\s+(?:in|within|for|by|today|tonight|tomorrow|using|with|at|before|so)\\b|[.?!,;]|$)";
    const verbRe = new RegExp("\\b(?:understand|understanding|learn(?:\\s+about)?|study|revise|revision of|explain|master|grasp|cover|go through|review|teach me|help me with|help me understand|brush up on)\\s+(?:the\\s+|my\\s+|me\\s+)?(.+?)" + STOP, "i");
    const tm = t.match(verbRe) || t.match(new RegExp("\\b(?:chapter|topic|on|about)\\s+([A-Za-z0-9 ,'’\\-&]+?)" + STOP, "i"));
    if(tm) topic = tm[1].trim();
    topic = topic.replace(/\b(class|grade|std\.?|standard)\s*\d{1,2}\b/ig, "").replace(/\s+/g, " ").trim();
    // "chemistry" alone is the subject, not a topic
    if(subj){ const subRe = (SUBJECTS.find(x => x[0] === subj.name) || [])[2]; if(subRe && !topic.replace(subRe, "").replace(/[^a-z]/ig, "")) topic = ""; }
    return {
      subject: subj ? subj.name : "", emoji: subj ? subj.emoji : "📚",
      level: level.replace(/\s+/g, " "), topic, minutes: minutes || null,
      when: /tomorrow/i.test(t) ? "tomorrow" : "today", raw: t,
    };
  }

  const STUDY_VERB = /\b(study|studying|revise|revision|learn|understand|grasp|master|explain|teach me|prepare for|preparing for|practice|practise|go through|brush up|cover)\b/i;
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
    if(STUDY_VERB.test(t) && (!time || ASKS_FOR_HELP.test(t)) && (subj || ASKS_FOR_HELP.test(t) || parseGoal(t).topic)){
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
    if(err === "no-image") return "I can't look at pictures with the current setup yet.";
    if(err === "timeout") return "That took too long. Tap Retry, or ask me in a shorter way.";
    if(err === "provider") return "My thinking service had a hiccup on its side. Tap Retry in a moment.";
    if(err === "bad-response") return "I got a strange answer back from my thinking service. Try again.";
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
    const raw = await generate({ task: "intent", prompt, json: true });
    if(!raw.ok){ return { type: "chat", reply: errorLine(raw.error), state: "CONFUSED", schedule: null, failed: true, error: raw.error }; }
    const obj = tryJSON(raw.text);
    // the model answered in plain words instead of JSON: that is still a perfectly good chat reply
    if(!obj || typeof obj !== "object") return { type: "chat", reply: String(raw.text).trim(), state: "IDLE", schedule: null };
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
      'Reply with ONLY JSON: {"reply":"<answer, formatted to fit the question: concise for simple facts, natural prose for concepts, numbered steps ONLY for maths or real procedures; write in the language the user used>","state":"FOCUSED"}', "User: " + prompt ].join("\n"), image: opts.imageBase64, json: true });
    if(!r.ok) return { text: errorLine(r.error), state: "CONFUSED", ok: false, error: r.error };
    const obj = tryJSON(r.text);
    return { text: (obj && obj.reply) || r.text, state: obj && VALID_STATES.includes(obj.state) ? obj.state : "FOCUSED", ok: true };
  }


  /* ---------------- language ---------------- */
  // Reply in the language/style of the LATEST message. An explicit request ("reply in Hindi") wins and sticks for the session
  // until the student asks for another; the Settings reply-language, if set, comes next; otherwise we mirror what they wrote.
  const LANG_NAMES = { en: "English", hi: "Hindi", mr: "Marathi", hinglish: "Hinglish" };
  let sessionLang = null;
  const HI_WORDS = /\b(kya|kaise|kaisa|kyu|kyun|kab|kahan|kaun|nahi|nahin|nhi|hai|hain|ho|hoga|tha|thi|mujhe|mera|meri|mere|tum|aap|apna|bata(o|na|ye)?|samjha(o|na|iye)?|batao|karo|kar|karna|chahiye|chahta|chahti|bhi|aur|lekin|par|se|ko|ka|ki|ke|me|mein|abhi|kal|aaj|padhai|padhna|samajh)\b/gi;
  const MR_WORDS = /\b(kay|kasa|kashi|kuthe|kadhi|nahi|aahe|ahe|ahet|mala|tula|tumhi|mazha|majha|maza|sang|sanga|samja(v|va|vun)|kara|karaycha|pahije|pahije|ani|pan|aaj|udya|abhyas|shik(ayche|va)?)\b/gi;
  const MR_DEV = /(आहे|काय|मला|तुम्ही|नाही|करा|आणि|माझे|माझा|कसे|सांग|पाहिजे|होते|आहेत|मी |तू )/;
  const HI_DEV = /(है|हैं|क्या|मुझे|नहीं|और|करो|कैसे|मेरा|मेरी|बताओ|समझाओ|चाहिए|कृपया|आप )/;
  function explicitLang(t){
    const x = String(t || "").toLowerCase();
    const pick = s => /marathi|मराठी|marathit|marathi madhe/.test(s) ? "mr" : /hinglish/.test(s) ? "hinglish" : /hindi|हिंदी|हिन्दी/.test(s) ? "hi" : /english|अंग्रेज/.test(s) ? "en" : null;
    let m = x.match(/\b(?:reply|answer|respond|speak|talk|explain|write|say|tell me|bolo|bol|batao|bata|samjhao|likho|sang|sanga)\b[^.?!]{0,30}\b(?:in|me|mein|madhe|मध्ये|में)\s+(english|hindi|marathi|hinglish)\b/);
    if(m) return pick(m[1]);
    m = x.match(/\b(english|hindi|marathi|hinglish)\s+(?:me|mein|madhe|mai)\s+(?:bolo|bol|batao|bata|samjhao|likho|sang|sanga|answer|reply|baat)/);
    if(m) return pick(m[1]);
    m = x.match(/\b(?:in|use|switch to|speak)\s+(english|hindi|marathi|hinglish)\s*(?:please|pls|only|from now)?\b/);
    if(m && /\b(please|pls|only|from now|switch|use|speak)\b/.test(x)) return pick(m[1]);
    m = x.match(/(हिंदी|हिन्दी|मराठी|English|अंग्रेज़ी)\s*(में|मध्ये|मधे|त)\s*(बोलो|बताओ|समझाओ|सांग|बोला|उत्तर)/);
    if(m) return pick(m[1]);
    return null;
  }
  function detectLang(text){
    const t = String(text || "");
    const dev = (t.match(/[\u0900-\u097F]/g) || []).length, lat = (t.match(/[A-Za-z]/g) || []).length;
    if(dev > 0 && dev >= lat * .5){ return MR_DEV.test(t) && !/(है|हैं|क्या|मुझे|नहीं|करो)/.test(t) ? "mr" : "hi"; }
    const mr = (t.match(MR_WORDS) || []).length, hi = (t.match(HI_WORDS) || []).length;
    if(dev > 0 && lat > 0){ return "hinglish"; }
    if(mr >= 2 && mr >= hi) return "mr-roman";
    if(hi >= 2) return "hinglish";
    return "en";
  }
  function resolveLang(text){
    const ex = explicitLang(text);
    if(ex){ sessionLang = ex; return { code: ex, source: "request" }; }
    if(sessionLang) return { code: sessionLang, source: "session" };
    const L = memory.getSettings().replyLang;
    if(L && L !== "auto" && LANG_NAMES[L]) return { code: L, source: "settings" };
    return { code: detectLang(text), source: "message" };
  }
  function langRule(l){
    const c = l.code;
    const how = { en: "English", hi: "Hindi in Devanagari script", mr: "Marathi in Devanagari script", hinglish: "Hinglish: Hindi written in English letters, mixing in English words the way the student does", "mr-roman": "Marathi written in English letters, mixing English words the way the student does" }[c] || "English";
    return "Reply in " + how + (l.source === "message" ? " (the language of the student's latest message)" : "") + ". Do not switch language part-way through. Keep equations, formulas and technical terms easy to read.";
  }
  function setSessionLang(c){ sessionLang = c && LANG_NAMES[c] ? c : null; }

  /* ---------------- fast conversational path ---------------- */
  // A plain question or chat doesn't need the heavy intent-JSON prompt: one compact call, plain text back.
  const ACTION_CUES = /\b(remind|reminder|schedule|task|todo|to-do|study|revise|revision|learn|plan|tomorrow|tonight|today|deadline|submit|homework|assignment|exam|test|quiz|cancel|delete|remove|calendar|meeting|event|alarm|timer|every|daily|weekly|at \d|\d ?(am|pm)|kal|aaj|udya|yaad)\b/i;
  function isPlainChat(text){
    const t = String(text || "").trim();
    if(!t || t.length > 600) return false;
    if(ACTION_CUES.test(t)) return false;
    return true;
  }
  function recentContext(n){
    return memory.getSession(n || 4).map(m => (m.role === "user" ? "Student: " : "D.A.B.S.y: ") + String(m.text).slice(0, 220)).join("\n");
  }
  const NORMAL_RULE = "Style: a small floating chat card. Answer in 1-3 short sentences (under about 45 words), or a short list of at most 4 items. No preamble, no headings, no markdown symbols. Give the useful core, not a lecture; the student can tap 'Explain more' for depth. If something essential is missing, ask ONE short question instead of guessing.";
  const STUDY_RULE = "Style: Study Mode. Teach properly: short clear paragraphs, worked steps for maths or procedures, a quick example if it helps, and a one-line takeaway. Be as long as the explanation needs, but organised and easy to scan on a phone. No markdown symbols.";
  async function chat(text, o){
    o = o || {};
    const lang = resolveLang(text);
    const ctx = recentContext(4);
    const prompt = [ o.study ? STUDY_RULE : NORMAL_RULE, langRule(lang), ctx ? "Conversation so far:\n" + ctx : "", "Student: " + text, "D.A.B.S.y:" ].filter(Boolean).join("\n");
    const r = await generate({ task: "chat", prompt });
    if(!r.ok) return { ok: false, error: r.error, text: errorLine(r.error), lang: lang.code };
    return { ok: true, text: cleanReply(r.text), lang: lang.code, study: !!o.study };
  }
  async function expand(question, answer, o){
    o = o || {};
    const lang = resolveLang(o.langHint || question);
    const prompt = [ "The student asked for MORE DETAIL on your previous answer. Explain it fully but clearly (about 90-180 words): why it is so, one concrete example, and a one-line takeaway. Short paragraphs, no headings, no markdown symbols.", langRule(lang),
      "Student's question: " + question, "Your short answer: " + answer, "D.A.B.S.y (detailed):" ].join("\n");
    const r = await generate({ task: "explain", prompt });
    if(!r.ok) return { ok: false, error: r.error, text: errorLine(r.error) };
    return { ok: true, text: cleanReply(r.text) };
  }
  // models sometimes echo the speaker label or wrap in quotes/markdown
  function cleanReply(t){
    return String(t || "").trim().replace(/^(d\.?a\.?b\.?s\.?y\.?\s*(\(detailed\))?\s*:)\s*/i, "").replace(/^["“](.*)["”]$/s, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,4}\s*/gm, "").trim();
  }
  // "What I understood": only for long, multi-part requests. Returns null when the request is clear (no card, no interruption).
  async function refine(text){
    if(!cfg().proxyUrl || state === "limited") return null;
    const lang = resolveLang(text);
    const obj = await askJSON({ task: "intent", prompt: [
      "Decide if this request is long or ambiguous enough that restating it would help. Reply ONLY with JSON:",
      '{"needs_preview":true|false,"understood":"<one or two sentences restating exactly what the student wants, same language as the student>"}',
      "needs_preview is true only when the request has several parts or an unclear goal. Never add details the student did not say.", langRule(lang), "Student: " + text ].join("\n") });
    if(!obj || obj.needs_preview !== true || typeof obj.understood !== "string" || !obj.understood.trim()) return null;
    return { understood: cleanReply(obj.understood) };
  }

  window.DABSy.ai = {
    status: () => state, statusInfo, check, generate, askJSON, research, localParse, parseGoal, parseIntent,
    askConflictQuestion, resolveConflictIntent, askDABSy, errorLine, chat, expand, refine, isPlainChat, detectLang, explicitLang, resolveLang, setSessionLang, FAIL_TEXT, limitedReply, parseTimeOfDay, parseDuration, subjectOf,
    get canSearch(){ return state !== "limited" && caps.search; },
  };
  window.addEventListener("load", () => setTimeout(check, 1500));
})();
