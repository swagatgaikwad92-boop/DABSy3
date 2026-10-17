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

  /* ---------------- transport (v10.3) ----------------
     Every AI request goes through ONE place: request() (non-streaming) or requestStream() (SSE).
     - one in-flight request per identical (task, system, prompt): a double tap / duplicate call joins the first one
     - NO automatic retry here. The Worker already makes at most one bounded retry for transient failures; retrying in
       the browser as well would multiply requests (and the quota). Generation has no side effects, and tasks are only
       created from a finished answer, so a failed request can never create a duplicate task.
     - errors keep their real kind: quota | rate-limited | busy | timeout | bad-request | blocked | auth | network | offline */
  const inflight = new Map();
  const metrics = [];                                    // last 30 requests: timings only, never content
  let streamOK = cfg().streaming !== false;              // flips to false if the Worker answers with plain JSON (an older Worker)
  let active = null;                                     // { ctl } of the request currently streaming, so it can be cancelled
  const base = () => (cfg().proxyUrl || "").replace(/\/+$/, "");
  const now = () => (window.performance || Date).now();
  function kindFromStatus(status, data){
    const e = data && typeof data.error === "string" ? data.error : "";
    if(e && e !== "provider-" + status) return e === "rate" ? "rate-limited" : e === "app-rate-limited" ? "rate-limited" : e;
    if(status === 429) return "rate-limited";
    if(status === 400) return "bad-request";
    if(status === 401 || status === 403) return "auth";
    if(status === 408 || status === 504) return "timeout";
    return "http-" + status;
  }
  function requestBody(o, stream){
    if(cfg().mode === "message"){
      const sys = personaSystem(o.system) + (o.json ? "\nRespond with valid JSON only. No markdown." : "");
      const b = { message: sys + "\n\n" + (o.prompt || ""), task: o.task || "chat" };
      if(o.json) b.json = true; if(stream) b.stream = true;
      return { path: "", body: b };
    }
    return { path: stream ? "/v1/stream" : "/v1/generate", body: { task: o.task || "chat", system: personaSystem(o.system), prompt: o.prompt, json: !!o.json, image: o.image || undefined } };
  }
  function failure(res, data){
    const kind = kindFromStatus(res.status, data);
    const ra = Number(res.headers.get("Retry-After")) || (data && Number(data.retryAfter)) || 0;
    if(kind === "rate-limited" || kind === "quota") setState("ready", kind === "quota" ? "Today's thinking allowance is used up." : "Taking a short breather.");
    else setState("checking", "The last request failed. I'll try again on your next message.");
    return { ok: false, error: kind, status: res.status, retryAfter: ra || undefined };
  }
  function netFailure(e, timedOut){
    if(e && e.name === "AbortError" && !timedOut) return { ok: false, error: "cancelled" };
    const err = timedOut ? "timeout" : (navigator.onLine ? "network" : "offline");
    setState(err === "timeout" ? "checking" : "limited", err === "offline" ? "You're offline." : err === "timeout" ? "That request timed out." : "I couldn't reach the AI service.");
    return { ok: false, error: err };
  }

  async function request(o){
    if(!base()) return { ok: false, error: "no-proxy" };
    const m = { t0: now(), stream: false };
    const { path, body } = requestBody(o, false);
    const ctl = new AbortController(); let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctl.abort(); }, cfg().requestTimeoutMs || 25000);
    try{
      const res = await fetch(base() + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      m.tHeaders = now();
      let data = null; try{ data = await res.json(); }catch(_){}
      if(!res.ok || !data || data.ok === false) return failure(res, data);
      const text = typeof data.text === "string" ? data.text : typeof data.reply === "string" ? data.reply : "";
      if(!text.trim()) return { ok: false, error: "bad-response" };
      setState("ready", "Connected"); m.tDone = now();
      return { ok: true, text: text.trim() };
    }catch(e){ return netFailure(e, timedOut); }
    finally{ clearTimeout(t); m.tEnd = now(); m.ok = !!m.tDone; record(m); }
  }
  function record(m){ metrics.push({ stream: m.stream, headersMs: m.tHeaders ? Math.round(m.tHeaders - m.t0) : null, firstTokenMs: m.tFirst ? Math.round(m.tFirst - m.t0) : null, totalMs: Math.round((m.tEnd || now()) - m.t0), ok: !!m.ok, chunks: m.chunks || 0 }); if(metrics.length > 30) metrics.shift(); }

  /* Server-Sent Events reader. Falls back to the plain JSON path if the Worker does not stream. */
  async function requestStream(o, onText){
    if(!base()) return { ok: false, error: "no-proxy" };
    if(!streamOK || o.image) return request(o);
    const m = { t0: now(), stream: true, chunks: 0 };
    const { path, body } = requestBody(o, true);
    const ctl = new AbortController(); let timedOut = false;
    const firstByte = setTimeout(() => { timedOut = true; ctl.abort(); }, cfg().requestTimeoutMs || 25000);
    active = { ctl };
    let text = "", done = false, incomplete = false, errKind = "";
    try{
      const res = await fetch(base() + path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal: ctl.signal });
      m.tHeaders = now();
      const ct = res.headers.get("content-type") || "";
      if(!res.ok){ let data = null; try{ data = await res.json(); }catch(_){} return failure(res, data); }
      if(!/event-stream/i.test(ct) || !res.body){                      // an older Worker: ordinary JSON answer
        streamOK = false;
        let data = null; try{ data = await res.json(); }catch(_){}
        const t = data && (data.text || data.reply);
        if(!t || !String(t).trim()) return { ok: false, error: "bad-response" };
        setState("ready", "Connected"); m.tDone = now(); return { ok: true, text: String(t).trim(), streamed: false };
      }
      clearTimeout(firstByte);
      // after the first byte the stream may run as long as the answer needs, but a stall of 20 s ends it
      let idle = setTimeout(() => ctl.abort(), 20000);
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
      for(;;){
        const { value, done: end } = await reader.read();
        if(end) break;
        clearTimeout(idle); idle = setTimeout(() => ctl.abort(), 20000);
        buf += dec.decode(value, { stream: true });
        let i;
        while((i = buf.search(/\r?\n\r?\n/)) >= 0){
          const evt = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
          const line = evt.split(/\r?\n/).find(l => l.startsWith("data:")); if(!line) continue;
          let d; try{ d = JSON.parse(line.slice(5).trim()); }catch(_){ continue; }
          if(typeof d.t === "string" && d.t){ if(!m.tFirst) m.tFirst = now(); m.chunks++; text += d.t; try{ onText && onText(text); }catch(_){} }
          if(d.done){ done = true; incomplete = !!d.incomplete; }
          if(d.error) errKind = d.error;
        }
      }
      clearTimeout(idle);
      if(errKind && !text.trim()) return { ok: false, error: errKind };
      if(!text.trim()) return { ok: false, error: "bad-response" };
      setState("ready", "Connected"); m.tDone = now();
      return { ok: true, text, streamed: true, incomplete: incomplete || !!errKind || !done };
    }catch(e){
      if(text.trim() && !(e && e.name === "AbortError" && !timedOut && !navigator.onLine === false)){ return { ok: true, text, streamed: true, incomplete: true }; }   // keep what arrived
      return netFailure(e, timedOut);
    }finally{ clearTimeout(firstByte); if(active && active.ctl === ctl) active = null; m.tEnd = now(); m.ok = !!m.tDone; record(m); }
  }
  /* one identical request at a time: a second identical call joins the first (extra callbacks are kept) */
  function single(key, run, onText){
    const hit = inflight.get(key);
    if(hit){ if(onText) hit.listeners.push(onText); return hit.promise; }
    const entry = { listeners: onText ? [onText] : [] };
    entry.promise = run(t => entry.listeners.forEach(f => { try{ f(t); }catch(_){} })).finally(() => inflight.delete(key));
    inflight.set(key, entry); return entry.promise;
  }
  async function post(path, body){                       // research endpoint (proxy mode only)
    if(!base()) return { ok: false, error: "no-proxy" };
    const ctl = new AbortController(); let timedOut = false; const t = setTimeout(() => { timedOut = true; ctl.abort(); }, cfg().requestTimeoutMs || 25000);
    try{
      const res = await fetch(base() + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      let data = null; try{ data = await res.json(); }catch(_){}
      if(!res.ok || !data || data.ok === false) return failure(res, data);
      setState("ready", "Connected"); return data;
    }catch(e){ return netFailure(e, timedOut); }
    finally{ clearTimeout(t); }
  }
  const abortActive = () => { if(active){ try{ active.ctl.abort(); }catch(_){} } };

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
      "You are D.A.B.S.y, a warm, quietly witty plush study companion for a student. Keep spoken replies short and natural unless explaining a topic.",
      "Today is " + new Date().toDateString() + ", " + new Date().toLocaleTimeString() + ".",
      prefs ? "Things the student asked you to remember: " + prefs + "." : "",
      learned ? "Study habits observed: " + learned : "",
      (function(){ const L = memory.getSettings().replyLang; const n = { en: "English", hi: "Hindi (Devanagari)", mr: "Marathi (Devanagari)" }[L];
        return n ? "Always reply in " + n + " unless the student clearly writes in another language; keep equations and technical terms readable." : "Reply in the language the student wrote in (English, Hindi, Marathi or a natural mix)."; })(),
      extra || "",
    ].filter(Boolean).join("\n");
  }

  async function generate(o){
    o = o || {};
    if(state === "limited" && !cfg().proxyUrl) return { ok: false, error: "no-proxy" };
    if(cfg().mode === "message" && o.image) return { ok: false, error: "no-image" };   // images can't go through the single-message backend; say so instead of silently dropping them
    return single("g|" + (o.task || "") + "|" + (o.system || "") + "|" + o.prompt, () => request(o));
  }
  /* streaming variant: onText(fullTextSoFar). For JSON answers use onReply (see replyStream) to show just the reply text as it grows. */
  async function generateStream(o, onText){
    o = o || {};
    if(state === "limited" && !cfg().proxyUrl) return { ok: false, error: "no-proxy" };
    if(cfg().mode === "message" && o.image) return { ok: false, error: "no-image" };
    return single("s|" + (o.task || "") + "|" + (o.system || "") + "|" + o.prompt, cb => requestStream(o, cb), onText);
  }
  /* Pull the value of the "reply" key out of a JSON object that is still being written, decoding escapes (\n \" \uXXXX). */
  function replyOf(partial){
    const m = /"reply"\s*:\s*"/.exec(partial); if(!m) return null;
    let out = "", i = m.index + m[0].length;
    for(; i < partial.length; i++){
      const c = partial[i];
      if(c === '"') return out;                          // finished
      if(c === "\\"){
        const n = partial[i + 1]; if(n === undefined) break;
        if(n === "u"){ const h = partial.slice(i + 2, i + 6); if(h.length < 4 || !/^[0-9a-fA-F]{4}$/.test(h)) break; out += String.fromCharCode(parseInt(h, 16)); i += 5; }
        else{ out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" })[n] ?? n; i += 1; }
      } else out += c;
    }
    return out;
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
    if(kind === "rate-limited" || kind === "quota" || kind === "busy") return errorLine(kind);
    if(kind === "offline") return "You're offline, so I can only do offline things like tasks, reminders and plans.";
    return LIMITED_REPLIES[Math.floor(Math.random() * LIMITED_REPLIES.length)];
  }
  /* v10.3: each failure now says what actually happened. "I'm a bit overloaded" used to be shown for EVERY HTTP 429 (including
     a used-up daily quota or the Worker's own per-minute cap) and the generic "couldn't reach" for every 5xx. */
  function errorLine(err, extra){
    const wait = extra && extra.retryAfter ? (extra.retryAfter <= 90 ? " in about " + Math.max(5, Math.round(extra.retryAfter)) + " seconds" : " in a few minutes") : " in a moment";
    if(err === "quota") return "I've used up my thinking allowance for now, so I can't answer questions until it resets. Tasks, reminders and plans still work.";
    if(err === "rate-limited" || err === "rate") return "My thinking service is rate-limited right now, which can be a short pause or today's allowance. Try again" + wait + ".";
    if(err === "busy" || /^http-5/.test(String(err)) || err === "upstream") return "My thinking service is having a hiccup. Try again" + wait + ". Nothing was lost.";
    if(err === "timeout") return "That took too long, so I stopped waiting. Try again, or ask it a bit shorter.";
    if(err === "bad-request") return "I couldn't process that message. Try rephrasing it.";
    if(err === "blocked") return "I can't help with that one. Ask me something else?";
    if(err === "auth" || err === "model-unavailable" || err === "no-provider") return "My thinking service needs attention on the server side (a setup problem, not you). Tasks, reminders and plans still work.";
    if(err === "offline") return "You're offline right now.";
    if(err === "network") return "I couldn't reach my thinking service. Check your connection and try again.";
    if(err === "no-proxy") return "My thinking service isn't set up yet, so I'm in limited mode.";
    if(err === "no-image") return "I can't look at pictures with the current setup yet.";
    if(err === "bad-response") return "I got a strange answer back from my thinking service. Try again.";
    if(err === "cancelled") return "";
    return "I couldn't reach my thinking service just now.";
  }

  const VALID_STATES = ["IDLE","CURIOUS","HAPPY","FOCUSED","THINKING","SURPRISED","PLAYFUL","STUDY_FOCUS","CONFUSED","SUCCESS"];

  /* ---------------- main intent parser ---------------- */
  // a bounded, trimmed slice of the recent conversation: at most 4 messages, 220 chars each, ~900 chars in all
  function recentContext(){
    let out = [], total = 0;
    const msgs = memory.getSession(4);
    for(let i = msgs.length - 1; i >= 0; i--){
      const line = (msgs[i].role === "user" ? "user" : "you") + ": " + String(msgs[i].text || "").replace(/\s+/g, " ").slice(0, 220);
      if(total + line.length > 900) break; out.unshift(line); total += line.length;
    }
    return out.join("\n");
  }
  const looksJSON = t => /^\s*\{/.test(t || "");
  async function parseIntent(text, opts){
    opts = opts || {};
    const local = localParse(text);
    // The offline rules are exact and free, so a rule match wins; the model handles everything the rules don't recognise.
    if(local) return local;
    const canAI = cfg().proxyUrl && state !== "limited";
    if(!canAI) return { type: "chat", reply: limitedReply(), state: "CONFUSED", schedule: null, limited: true };
    const recent = recentContext();
    // "reply" comes FIRST in the JSON so it can be shown while the rest is still being written
    const prompt = [
      recent ? "Recent conversation:\n" + recent : "",
      'Classify what the user just said. Answer with ONLY a JSON object, no markdown, keys in this order:',
      '{"reply":"<short spoken reply>","type":"chat|schedule_add|schedule_remove|study_goal|task_add","state":"IDLE|CURIOUS|HAPPY|FOCUSED|THINKING|SURPRISED|PLAYFUL|STUDY_FOCUS|CONFUSED",',
      '"schedule":{"title":"","hour":0,"minute":0,"duration_minutes":0,"recurring":false,"days":[0-6],"date_offset_days":0,"category":"study|college|homework|personal|creative|meeting|important|deadline|null","emoji":"<one emoji or null>"},',
      '"goal":{"subject":"","level":"","topic":"","minutes":null,"when":"today|tomorrow"},"task":{"title":"","durationMin":0}}',
      'schedule_add ONLY with an explicit clock time (hour/minute are numbers). study_goal when they want to study/revise/learn and want help. task_add for a to-do without a time. Include "schedule" only for schedule_add/remove, "goal" only for study_goal, "task" only for task_add.',
      "User: " + text,
    ].filter(Boolean).join("\n");
    const raw = await generateStream({ task: "intent", prompt, json: true }, opts.onPartial ? (t => { const r = replyOf(t); if(r) opts.onPartial(r); }) : null);
    if(!raw.ok){ return { type: "chat", reply: errorLine(raw.error, raw), state: "CONFUSED", schedule: null, error: raw.error }; }
    const obj = tryJSON(raw.text);
    if(!obj || typeof obj !== "object"){
      // a cut-off or plain-words answer: never show raw JSON braces to the student
      const r = looksJSON(raw.text) ? replyOf(raw.text) : String(raw.text).trim();
      return { type: "chat", reply: r ? (raw.incomplete ? r + " …" : r) : errorLine("bad-response"), state: "IDLE", schedule: null, incomplete: !!raw.incomplete };
    }
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
    const instr = 'Reply with ONLY JSON: {"reply":"<answer, formatted to fit the question: concise for simple facts, natural prose for concepts, numbered steps ONLY for maths or real procedures; write in the language the user used>","state":"FOCUSED"}';
    const o = { task: opts.task || "explain", system: opts.context, prompt: instr + "\nUser: " + prompt, image: opts.imageBase64, json: true };
    const cb = opts.onPartial ? (t => { const r = replyOf(t); if(r) opts.onPartial(r); }) : null;
    const r = cb ? await generateStream(o, cb) : await generate(o);
    if(!r.ok) return { text: errorLine(r.error, r), state: "CONFUSED", ok: false, error: r.error };
    const obj = tryJSON(r.text);
    const text = (obj && obj.reply) || (looksJSON(r.text) ? replyOf(r.text) : r.text) || errorLine("bad-response");
    return { text, state: obj && VALID_STATES.includes(obj.state) ? obj.state : "FOCUSED", ok: true, incomplete: !!r.incomplete };
  }

  window.DABSy.ai = {
    status: () => state, statusInfo, check, generate, generateStream, abort: abortActive, metrics: () => metrics.slice(), _replyOf: replyOf, askJSON, research, localParse, parseGoal, parseIntent,
    askConflictQuestion, resolveConflictIntent, askDABSy, errorLine, limitedReply, parseTimeOfDay, parseDuration, subjectOf,
    get canSearch(){ return state !== "limited" && caps.search; },
  };
  window.addEventListener("load", () => setTimeout(check, 1500));
})();
