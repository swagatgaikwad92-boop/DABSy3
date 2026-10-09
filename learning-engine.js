/* ============================================================
   D.A.B.S.y — learning-engine.js : study preferences, not surveillance
   What is learned (all on this device, all visible and erasable in
   Settings → Privacy & data):
     - which kinds of material you choose or skip (video, practice…)
     - which sites you tend to choose
     - how long your focus blocks usually are, from how sessions went
     - which hours you usually study
     - per-subject time and how it felt (too hard / just right)
   What is NOT learned or stored: free-text of what you typed, anything
   about your health, mood, location, contacts or other apps.
   Turn it off in Settings → Study & learning.
   ============================================================ */
(function(){
  const memory = window.DABSy.memory;
  const KEY = "learning_v1";
  const blank = () => ({ types: {}, sources: {}, sessions: [], blockFeedback: [], hours: {}, subjects: {}, updatedAt: 0 });
  let data = Object.assign(blank(), memory.read(KEY, {}));
  const enabled = () => memory.getSettings().learnHabits !== false;
  const save = () => { data.updatedAt = Date.now(); memory.write(KEY, data); };
  const bump = (obj, k, field) => { obj[k] = obj[k] || { chosen: 0, skipped: 0 }; obj[k][field]++; };

  function hostOf(r){ try{ return new URL(r.url).hostname.replace(/^www\./, ""); }catch(e){ return r.source || ""; } }

  function recordChoice(r, chosen){
    if(!enabled()) return;
    bump(data.types, r.type || "link", chosen ? "chosen" : "skipped");
    const h = hostOf(r); if(h) bump(data.sources, h, chosen ? "chosen" : "skipped");
    save();
  }

  // { subject, plannedMin, doneMin, blocksDone, blocksTotal, breaksSkipped }
  function recordSession(s){
    if(!enabled()) return;
    data.sessions.push({ subject: (s.subject || "").toLowerCase(), plannedMin: s.plannedMin, doneMin: s.doneMin, blocksDone: s.blocksDone, blocksTotal: s.blocksTotal, blockMin: s.blockMin || null, at: Date.now() });
    data.sessions = data.sessions.slice(-30);
    const h = new Date().getHours(); data.hours[h] = (data.hours[h] || 0) + 1;
    const k = (s.subject || "general").toLowerCase();
    const st = data.subjects[k] = data.subjects[k] || { sessions: 0, minutes: 0, lastAt: 0, hard: 0, easy: 0 };
    st.sessions++; st.minutes += s.doneMin || 0; st.lastAt = Date.now();
    save();
  }
  // "good" | "long" | "short" | "hard" | "easy"
  function recordFeedback(subject, kind, blockMin){
    if(!enabled()) return;
    if(kind === "long" || kind === "short" || kind === "good") data.blockFeedback.push({ kind, blockMin: blockMin || null, at: Date.now() });
    data.blockFeedback = data.blockFeedback.slice(-12);
    const k = (subject || "general").toLowerCase();
    const st = data.subjects[k] = data.subjects[k] || { sessions: 0, minutes: 0, lastAt: 0, hard: 0, easy: 0 };
    if(kind === "hard") st.hard++; if(kind === "easy") st.easy++;
    save();
  }

  /* ---- what the planner / ranker asks ---- */
  function typeWeight(type){
    const t = data.types[type]; if(!t) return 1;
    const n = t.chosen + t.skipped; if(n < 3) return 1;
    return 0.6 + 0.8 * (t.chosen / n);              // 0.6 … 1.4
  }
  function sourceWeight(host){
    const s = data.sources[host]; if(!s) return 1;
    const n = s.chosen + s.skipped; if(n < 2) return 1;
    return 0.7 + 0.6 * (s.chosen / n);
  }
  // typical focus block in minutes, adapted from feedback and completion
  function blockLength(subject){
    let base = 25;
    const fb = data.blockFeedback.slice(-6);
    const longN = fb.filter(f => f.kind === "long").length, shortN = fb.filter(f => f.kind === "short").length;
    base += (shortN - longN) * 5;
    const done = data.sessions.slice(-5).filter(s => s.plannedMin);
    if(done.length >= 2){
      const ratio = done.reduce((a, s) => a + (s.doneMin || 0) / s.plannedMin, 0) / done.length;
      if(ratio < .6) base -= 5; else if(ratio > .95) base += 3;
    }
    const st = subject && data.subjects[subject.toLowerCase()];
    if(st && st.hard > st.easy + 1) base -= 3;
    return Math.max(15, Math.min(45, Math.round(base / 5) * 5));
  }
  function subjectStats(subject){ return data.subjects[(subject || "general").toLowerCase()] || null; }
  function difficulty(subject){ const s = subjectStats(subject); if(!s) return 1; return s.hard > s.easy + 1 ? 2 : (s.easy > s.hard + 2 ? 0 : 1); }
  function usualHours(){
    const e = Object.entries(data.hours).sort((a, b) => b[1] - a[1]);
    return e.length >= 3 ? e.slice(0, 2).map(x => Number(x[0])) : [];
  }

  function promptSummary(){
    if(!enabled()) return "";
    const bits = [];
    const types = Object.entries(data.types).filter(([, v]) => v.chosen + v.skipped >= 3).sort((a, b) => b[1].chosen / (b[1].chosen + b[1].skipped) - a[1].chosen / (a[1].chosen + a[1].skipped));
    if(types.length){ const top = types.filter(([, v]) => v.chosen / (v.chosen + v.skipped) >= .6).map(x => x[0]); if(top.length) bits.push("prefers " + top.slice(0, 2).join(" and ") + " material"); }
    if(data.sessions.length >= 2) bits.push("usual focus block about " + blockLength() + " minutes");
    return bits.join("; ");
  }

  function snapshot(){
    return {
      enabled: enabled(),
      types: Object.entries(data.types).map(([k, v]) => ({ k, chosen: v.chosen, skipped: v.skipped })),
      sources: Object.entries(data.sources).map(([k, v]) => ({ k, chosen: v.chosen, skipped: v.skipped })).sort((a, b) => b.chosen - a.chosen).slice(0, 5),
      blockMin: blockLength(), sessions: data.sessions.length,
      subjects: Object.entries(data.subjects).map(([k, v]) => ({ k, sessions: v.sessions, minutes: v.minutes })),
      summary: promptSummary(),
    };
  }
  function reset(){ data = blank(); memory.remove(KEY); window.DABSy.bus.emit("learning:reset"); }
  window.DABSy.bus.on("memory:wiped", () => { data = blank(); });

  window.DABSy.learning = { recordChoice, recordSession, recordFeedback, typeWeight, sourceWeight, blockLength, subjectStats, difficulty, usualHours, promptSummary, snapshot, reset, hostOf };
})();
