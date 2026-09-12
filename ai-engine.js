/* ============================================================
   D.A.B.S.y — ai-engine.js
   Every call to Gemini goes through here.

   parseIntent()   — the main entry point for anything the user
                      says. Classifies chat vs schedule intents in
                      one call and returns a spoken reply + a face
                      state alongside any structured schedule data.
   askConflictQuestion() — given a real conflict (computed by
                      schedule-engine, not guessed by the model),
                      generates the spoken question fresh each time.
   resolveConflictIntent() — classifies the user's answer to a
                      pending conflict question into an action.
   askDABSy()       — free-form long-form explanation, used by
                      Study Mode.
   ============================================================ */

(function(){
  const memory = window.DABSy.memory;
  const MODEL = "gemini-3.6-flash";
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const VALID_STATES = ["IDLE","CURIOUS","HAPPY","FOCUSED","THINKING","SURPRISED","PLAYFUL","STUDY_FOCUS"];

  function nowContext(){
    const d = new Date();
    return `Current date/time: ${d.toDateString()}, ${d.toLocaleTimeString()}.`;
  }

  async function callGemini(promptText, imageBase64){
    const settings = memory.getSettings();
    const key = settings.geminiKey;
    if(!key) return { ok:false, error:"no-key" };

    const parts = [{ text: promptText }];
    if(imageBase64) parts.push({ inline_data: { mime_type:"image/jpeg", data: imageBase64 } });

    try{
      const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role:"user", parts }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
        })
      });
      if(!res.ok){ console.error("Gemini error", res.status, await res.text()); return { ok:false, error:"http" }; }
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("") || "";
      return { ok:true, raw };
    }catch(e){ console.error(e); return { ok:false, error:"network" }; }
  }

  function stripFences(raw){
    return raw.trim().replace(/^```json/i,"").replace(/^```/,"").replace(/```$/,"").trim();
  }

  /* ---------- main intent parser ---------- */
  async function parseIntent(text, opts={}){
    const prefs = memory.getPreferences().map(p=>p.text).join("; ") || "none yet";
    const recent = memory.getSession(6).map(m=>`${m.role}: ${m.text}`).join("\n");

    const prompt = [
      "You are D.A.B.S.y — a warm, quietly witty AI companion and personal butler that lives on someone's desk.",
      "You are talking to a Class 11 science student in India. Keep spoken replies short and natural unless it's a study explanation.",
      nowContext(),
      `Known preferences: ${prefs}.`,
      recent ? `Recent conversation:\n${recent}` : "",
      "The user just said something. Decide what kind of message this is and respond with ONLY a JSON object (no markdown fences), in this exact shape:",
      `{
  "type": "chat" | "schedule_add" | "schedule_remove",
  "reply": "<what you say out loud, plain text>",
  "state": "IDLE|CURIOUS|HAPPY|FOCUSED|THINKING|SURPRISED|PLAYFUL|STUDY_FOCUS",
  "schedule": {
    "title": "<short task/event name, only if type is schedule_add or schedule_remove>",
    "hour": <JSON number 0-23, e.g. 17 — NEVER a string like "17", only for schedule_add>,
    "minute": <JSON number 0-59, e.g. 45 — NEVER a string, only for schedule_add>,
    "duration_minutes": <JSON number, only for schedule_add, default 30 if unclear>,
    "recurring": true | false,
    "days": [<JSON numbers 0-6, 0=Sunday, only if recurring is true; if user said "every day" use [0,1,2,3,4,5,6]>],
    "date_offset_days": <JSON number, only for schedule_add or schedule_remove, non-recurring: 0 if they mean today/tonight or gave no day, 1 if "tomorrow", 2 if "day after tomorrow"; NEVER a string. If they name a weekday (e.g. "Saturday") just pick the nearest matching offset 0-6 from today, don't ask.>,
    "category": "study" | "college" | "homework" | "personal" | "creative" | "meeting" | "important" | "deadline" | null,
    "emoji": "<ONE single emoji character that best fits the specific subject/activity itself, e.g. chemistry->🧪, physics->⚛️, maths->➗, biology->🧬, english/reading->📖, coding->💻, gym/sport->🏋️, music->🎵, art->🎨, sleep->😴; if genuinely nothing fits well, use null — only for schedule_add>"
  }
}`,
      'For "category": pick confidently from the exact 8 values above whenever the subject makes it reasonably obvious (a school subject like chemistry/physics/maths -> "study"; a college class/lecture -> "college"; a worksheet/submission -> "homework"; a personal errand/chore -> "personal"; drawing/writing/music practice -> "creative"; a call/group meeting -> "meeting"; something high-stakes emphasized as important -> "important"; a submission cutoff -> "deadline"). Only use null if it is genuinely ambiguous between two very different categories — do not use null just to be safe.',
      'Use "schedule_add" ONLY when the user gave an actual clock time (today or recurring), and hour/minute must both be present as numbers. If they mention a task/reminder but give NO specific time ("remind me to submit my assignment"), use type "chat" instead, and make your reply ask what time they want it — do not guess a time.',
      'Use "schedule_remove" when they say to stop/cancel a recurring thing.',
      "If type is chat, omit the schedule field entirely.",
      "User: " + text
    ].filter(Boolean).join("\n");

    const result = await callGemini(prompt);
    if(!result.ok){
      return fallbackReply(result.error);
    }
    try{
      const obj = JSON.parse(stripFences(result.raw));
      return {
        type: obj.type === "schedule_add" || obj.type === "schedule_remove" ? obj.type : "chat",
        reply: typeof obj.reply === "string" ? obj.reply : result.raw,
        state: VALID_STATES.includes(obj.state) ? obj.state : "IDLE",
        schedule: obj.schedule ? Object.assign({}, obj.schedule, {
          category: typeof obj.schedule.category === "string" ? obj.schedule.category : null,
          emoji: typeof obj.schedule.emoji === "string" ? obj.schedule.emoji : null,
        }) : null,
      };
    }catch(e){
      return { type:"chat", reply: result.raw, state:"IDLE", schedule:null };
    }
  }

  function fallbackReply(errorKind){
    if(errorKind === "no-key"){
      return { type:"chat", reply:"I don't have an API key yet — add one in Settings so I can actually think.", state:"IDLE", schedule:null };
    }
    return { type:"chat", reply:"I couldn't reach Gemini just now — check your connection or API key.", state:"IDLE", schedule:null };
  }

  /* ---------- conflict question, generated fresh from real data ---------- */
  async function askConflictQuestion(candidate, conflict){
    const prompt = [
      "You are D.A.B.S.y, a warm AI butler. There is a real scheduling conflict — describe it naturally in one or two short spoken sentences and ask the user what to do.",
      "Offer these exact options in your own natural phrasing: move the existing item, cancel the existing item, or keep both anyway.",
      `New item the user wants: "${candidate.title}" at ${candidate.start.toLocaleTimeString()}.`,
      `Existing item it conflicts with: "${conflict.title}" at ${conflict.start.toLocaleTimeString()}.`,
      "Respond with ONLY a JSON object: {\"reply\": \"<spoken question>\", \"state\": \"CURIOUS\"}",
    ].join("\n");
    const result = await callGemini(prompt);
    if(!result.ok) return { reply: `You've already got "${conflict.title}" around then — want me to move it, cancel it, or keep both?`, state:"CURIOUS" };
    try{
      const obj = JSON.parse(stripFences(result.raw));
      return { reply: obj.reply || result.raw, state: VALID_STATES.includes(obj.state)?obj.state:"CURIOUS" };
    }catch(e){
      return { reply: result.raw, state:"CURIOUS" };
    }
  }

  /* ---------- classify the answer to a pending conflict ---------- */
  async function resolveConflictIntent(text, candidate, conflict){
    const prompt = [
      "The user is answering a scheduling conflict question.",
      `New item: "${candidate.title}". Existing conflicting item: "${conflict.title}".`,
      `User's answer: "${text}"`,
      "Classify their intent and respond with ONLY JSON:",
      `{"action": "move_existing" | "cancel_existing" | "keep_both" | "cancel_new" | "unclear", "reply": "<short natural spoken confirmation>", "state": "HAPPY|IDLE|CONFUSED"}`,
      'Use "unclear" only if you genuinely cannot tell what they mean.'
    ].join("\n");
    const result = await callGemini(prompt);
    if(!result.ok) return { action:"unclear", reply:"Sorry, I didn't catch that — move it, cancel it, or keep both?", state:"CONFUSED" };
    try{
      const obj = JSON.parse(stripFences(result.raw));
      return {
        action: ["move_existing","cancel_existing","keep_both","cancel_new"].includes(obj.action) ? obj.action : "unclear",
        reply: obj.reply || "Got it.",
        state: VALID_STATES.includes(obj.state) ? obj.state : "IDLE",
      };
    }catch(e){
      return { action:"unclear", reply:"Sorry, could you say that again — move it, cancel it, or keep both?", state:"CONFUSED" };
    }
  }

  /* ---------- long-form study explanations ---------- */
  async function askDABSy(prompt, opts={}){
    const settings = memory.getSettings();
    if(!settings.geminiKey){
      return { text: "I don't have an API key yet — add one in Settings so I can actually think.", state: "IDLE" };
    }
    const full = [
      "You are D.A.B.s.y, tutoring a Class 11 science student in India.",
      opts.context || "",
      "Reply with ONLY a JSON object: {\"reply\": \"<answer, plain text, use numbered steps like 1) 2) 3) for explanations>\", \"state\": \"FOCUSED\"}",
      "User: " + prompt
    ].filter(Boolean).join("\n");
    const result = await callGemini(full, opts.imageBase64);
    if(!result.ok) return { text: "I couldn't reach Gemini just now — check your connection or API key.", state: "IDLE" };
    try{
      const obj = JSON.parse(stripFences(result.raw));
      return { text: obj.reply || result.raw, state: VALID_STATES.includes(obj.state)?obj.state:"FOCUSED" };
    }catch(e){
      return { text: result.raw, state: "FOCUSED" };
    }
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.ai = { parseIntent, askConflictQuestion, resolveConflictIntent, askDABSy };
})();
