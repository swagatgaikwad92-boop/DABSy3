/* ============================================================
   D.A.B.S.y — butler-memory.js   (v11.2: remembering like a good butler)
   DABSy.bmem = { remember(text,opts), forget(id), clear(), list(), get(key), prompt(), learnFrom(text), extract(turns), noteDay(summary), lastDay(), onChange }

   A butler remembers what you TELL them, quietly uses it, and never keeps secrets from you.
     - It stores short facts on THIS device only (localStorage via memory, key "butler_mem_v1"). Nothing else is stored.
     - Told directly  ("remember that I study best at night")   -> saved, confirmed.
     - Stated plainly ("I wake up at 6", "I sleep at 11")        -> saved as a routine, DABSy says what she noted, with Forget.
     - After a talk about the day, the language model (if reachable) may pick out durable facts YOU said (never guesses);
       they are shown to you as "noted", each with Forget. Settings -> What I remember lists everything, each removable.
     - The planner uses wake / sleep times; the chat model gets the short list as context so she doesn't ask twice.
   ============================================================ */
(function(){
  const D = window.DABSy, memory = D.memory, bus = D.bus, ui = D.ui;
  const KEY = "butler_mem_v1", MAX = 60;
  let st = memory.read(KEY, null) || { facts: [], last: null };
  if(!Array.isArray(st.facts)) st.facts = [];
  const save = () => { try{ memory.write(KEY, st); }catch(e){} bus.emit("bmem:changed"); };
  bus.on("memory:wiped", () => { st = { facts: [], last: null }; });
  const clean = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const norm = s => clean(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");

  function remember(text, o){
    o = o || {}; text = clean(text); if(text.length < 3) return null;
    const dup = st.facts.find(f => (o.key && f.key === o.key) || norm(f.text) === norm(text));
    if(dup){ dup.text = text; dup.value = o.value != null ? o.value : dup.value; dup.ts = Date.now(); save(); return dup; }
    const f = { id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, cat: o.cat || "note", key: o.key || null, value: o.value != null ? o.value : null, src: o.src || "told", ts: Date.now() };
    st.facts.unshift(f); st.facts = st.facts.slice(0, MAX); save(); return f;
  }
  function forget(id){ const n = st.facts.length; st.facts = st.facts.filter(f => f.id !== id); if(st.facts.length !== n) save(); return st.facts.length !== n; }
  function clear(){ st.facts = []; st.last = null; save(); }
  const list = () => st.facts.slice();
  const get = key => { const f = st.facts.find(x => x.key === key); return f ? f.value : null; };

  /* structured routines the planner can use */
  function hhmm(h, m, ap){ h = Number(h); m = Number(m || 0); if(ap){ ap = ap.toLowerCase(); if(ap.startsWith("p") && h < 12) h += 12; if(ap.startsWith("a") && h === 12) h = 0; } if(h > 23 || m > 59) return null; return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); }
  const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?";
  /* what a plain statement from the student can teach her. Returns the fact saved (or null). Only first-person statements count. */
  function learnFrom(text){
    const t = String(text || "").trim(); if(!t || t.length > 200 || /\?\s*$/.test(t)) return null;
    let m;
    if((m = t.match(/^(?:please\s+)?remember(?: that| this)?[,:]?\s+(.{3,})$/i))){ return remember(m[1].replace(/[.!]+$/, ""), { cat: "note", src: "told" }); }
    if((m = t.match(new RegExp("\\bi\\s+(?:usually |normally |always )?(?:wake(?: up)?|get up)(?: at| around| by)?\\s+" + TIME, "i"))) && hhmm(m[1], m[2], m[3] || (+m[1] >= 4 && +m[1] <= 11 ? "am" : null))){
      const v = hhmm(m[1], m[2], m[3] || "am"); if(v) return remember(`Wakes up around ${v}`, { cat: "routine", key: "wake", value: v, src: "told" }); }
    if((m = t.match(new RegExp("\\bi\\s+(?:usually |normally |always )?(?:sleep|go to (?:bed|sleep)|turn in)(?: at| around| by)?\\s+" + TIME, "i")))){
      const v = hhmm(m[1], m[2], m[3] || (+m[1] <= 11 ? "pm" : null)); if(v) return remember(`Goes to bed around ${v}`, { cat: "routine", key: "sleep", value: v, src: "told" }); }
    if((m = t.match(/\bi\s+(?:study|work|focus|concentrate|think)\s+(?:best|better|well|most)\s+(?:in the |at |during the )?(morning|afternoon|evening|night)/i))){ return remember(`Focuses best in the ${m[1].toLowerCase()}`, { cat: "routine", key: "focus", value: m[1].toLowerCase(), src: "told" }); }
    if((m = t.match(/\bi\s+(?:don'?t|do not|never)\s+(?:like|want to|study|work)\s+(?:on |in the |at )?(.{3,40}?)(?:[.!]|$)/i)) && /^(?:i\s+(?:don'?t|do not|never))/i.test(t) && t.split(" ").length <= 12){ return remember("Doesn't like to " + t.replace(/^i\s+(?:don'?t|do not|never)\s+/i, "").replace(/[.!]$/, ""), { cat: "preference", src: "told" }); }
    if((m = t.match(/\bmy name is\s+([A-Za-z][A-Za-z '-]{1,24})/i)) || (m = t.match(/\bcall me\s+([A-Za-z][A-Za-z '-]{1,20})/i))){ return remember(`Likes to be called ${m[1].trim()}`, { cat: "fact", key: "name", value: m[1].trim(), src: "told" }); }
    return null;
  }

  /* after a talk about the day: let the model pull out durable facts the student actually STATED (never guesses) */
  async function extract(turns){
    const ai = D.ai; const text = (turns || []).filter(Boolean).join("\n").slice(0, 900);
    if(!ai || ai.status() === "limited" || text.length < 25 || !ai.askJSON) return [];
    try{
      const r = await Promise.race([ai.askJSON({ task: "memory", prompt: `From what the student said below, list up to 3 DURABLE facts about their routine, preferences, commitments or people that a personal assistant should remember (e.g. "Has football practice on Tuesdays"). Use ONLY what they stated; do not guess; skip one-off moods and today-only details. Reply ONLY with JSON: {"facts":[{"text":"...","cat":"routine|preference|commitment|fact"}]}. If nothing durable, {"facts":[]}.\nStudent said:\n${text}` }), new Promise(res => setTimeout(() => res(null), 9000))]);
      const out = r && Array.isArray(r.facts) ? r.facts.slice(0, 3) : [];
      return out.map(f => remember(String(f.text || ""), { cat: ["routine", "preference", "commitment", "fact"].includes(f.cat) ? f.cat : "note", src: "noticed" })).filter(Boolean);
    }catch(e){ return []; }
  }

  function noteDay(summary){ st.last = { at: Date.now(), text: clean(summary).slice(0, 220) }; save(); }
  const lastDay = () => st.last;

  /* compact context for the language model + planner */
  function prompt(){
    const f = st.facts.slice(0, 14).map(x => "- " + x.text);
    const l = st.last && Date.now() - st.last.at < 36 * 3600e3 ? `Earlier conversation (${ui.relTime(st.last.at)}): ${st.last.text}` : "";
    return (f.length ? "What you already know about the student (told by them; do not ask again, use naturally, don't recite it):\n" + f.join("\n") : "") + (l ? (f.length ? "\n" : "") + l : "");
  }

  D.bmem = { remember, forget, clear, list, get, prompt, learnFrom, extract, noteDay, lastDay };
})();
