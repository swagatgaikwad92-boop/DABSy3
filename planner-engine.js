/* ============================================================
   D.A.B.S.y — planner-engine.js : the adaptive study planner
   Not a fixed Pomodoro. The shape of a plan comes from:
     - the time you really have (a stated goal, or the gap before your
       next scheduled thing)
     - the material you chose and how long each piece actually is
     - the subject, how hard it has felt before, and how long your focus
       blocks usually are (learning-engine)
     - urgency (an exam soon shifts time from reading to practice)
     - how often similar tasks recently slipped (shorter, safer blocks)
   Output: { totalMin, blocks:[{id,kind,title,minutes,note,resourceId}], rationale }
   ============================================================ */
(function(){
  const tasks = window.DABSy.tasks;
  const learning = window.DABSy.learning;
  const ui = window.DABSy.ui;
  const LEARN = new Set(["video", "article", "notes", "pdf", "course", "link"]);
  const round5 = n => Math.max(5, Math.ceil(n / 5) * 5);

  // minutes you can really give right now: until the next scheduled thing, minus a buffer
  function availableMinutes(now){
    now = now || new Date();
    const n = tasks.nextInstance(now);
    let m = 90;
    if(n){ const gap = Math.floor((n.start - now) / 60000) - 10; if(gap < m) m = gap; }
    if(m < 15) return { minutes: 30, constrained: false, note: "" };
    return { minutes: Math.min(120, m), constrained: !!n && m < 90, note: n ? `until ${n.title} at ${ui.fmtTime(n.start)}` : "" };
  }


  // Which of the found resources really fit the time? Returns { ids, slots:{id:minutes}, learnBudget }.
  // Videos take their real length (+15% for pausing); reading is time-boxed; nothing is stretched to fill a slot.
  function suggest(resources, totalMin){
    const total = Math.max(15, Math.round(totalMin || 30));
    const recall = total >= 30 ? 5 : 3;
    let left = total - recall;
    const slots = {}, ids = [];
    const pool = (resources || []).filter(r => r.origin !== "link").slice().sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    const slotOf = (r, cap) => r.type === "video" && r.durationMin ? Math.min(cap, Math.ceil(r.durationMin * 1.15)) : (r.type === "pdf" || r.type === "article" || r.type === "notes") ? Math.min(cap, 10) : Math.min(cap, 10);
    const add = r => { const m = slotOf(r, left); if(m < 4) return false; slots[r.id] = m; ids.push(r.id); left -= m; return true; };
    const primary = pool.find(r => r.type === "video" && !r.partial && r.durationMin && Math.ceil(r.durationMin * 1.15) <= left) || pool.find(r => r.type === "video") || pool[0];
    if(primary) add(primary);
    for(const r of pool){
      if(ids.length >= 3 || left < 6) break;
      if(ids.includes(r.id)) continue;
      if(primary && r.type === primary.type && r.type === "video" && ids.length >= 2) continue;
      if(r.type === "video" && r.durationMin && Math.ceil(r.durationMin * 1.15) > left) continue;
      add(r);
    }
    return { ids, slots, learnBudget: total - recall, recall, spare: Math.max(0, left) };
  }

  function buildFromSlots(goal, chosen, total){
    const recall = total >= 30 ? 5 : 3;
    const out = [];
    chosen.forEach(r => {
      const partial = r.partial || (r.type === "video" && r.durationMin && r.slotMin < Math.ceil(r.durationMin * 1.15));
      out.push({ id: ui.uid("b"), kind: LEARN.has(r.type) ? "learn" : "practice", title: r.title, minutes: r.slotMin, resourceId: r.id,
        note: partial ? `Watch the first ${Math.max(3, r.slotMin - 2)} of ${r.durationMin} min, then write what you learned.` : (r.type === "video" ? "Pause to write a line or two of notes." : "Read actively and note the key points.") });
    });
    const used = out.reduce((a, b) => a + b.minutes, 0);
    let spare = total - recall - used;
    if(spare >= 5) out.push({ id: ui.uid("b"), kind: "notes", title: "Write it up in your own words", minutes: spare, note: "Close the tab and summarise from memory." });
    else if(spare !== 0 && out.length) out[out.length - 1].minutes += spare;
    out.push({ id: ui.uid("b"), kind: "recall", title: "Recall check", minutes: recall, note: "I'll ask you a couple of questions. No peeking." });
    return out;
  }

  function build(o){
    const goal = o.goal || {};
    const chosen = (o.resources || []).slice();
    const subject = goal.subject || "";
    const diff = learning.difficulty(subject);
    const avail = availableMinutes();
    let total = goal.minutes || (o.totalMin) || Math.min(avail.minutes, 60);
    total = Math.max(15, Math.min(180, Math.round(total / 5) * 5));

    if(total <= 45 && chosen.length && chosen.every(r => r.slotMin)){
      const blocks = buildFromSlots(goal, chosen, total);
      const sum = blocks.reduce((a, b) => a + b.minutes, 0);
      return { totalMin: sum, blocks, rationale: `${sum} minutes: ${chosen.length} resource${chosen.length === 1 ? "" : "s"} sized to their real length, then a ${blocks[blocks.length - 1].minutes}-minute recall check.` };
    }
    const slips = tasks.list().filter(t => (t.subject || "").toLowerCase() === subject.toLowerCase() && subject).reduce((n, t) => n + tasks.recentSlips(t, 7), 0);
    let focus = learning.blockLength(subject);
    if(slips >= 2) focus = Math.max(15, focus - 5);
    if(diff === 2) focus = Math.max(15, focus - 5);
    const urgent = !!goal.urgent;
    const practiceShare = urgent ? .45 : (goal.mode === "practice" ? .6 : .3);

    // layout: how many focus blocks fit with breaks and a closing recall
    const recall = total >= 30 ? 5 : 3;
    const breakMin = focus >= 30 ? 7 : 5;
    let rest = total - recall;
    const sequence = [];       // "F" focus, "B" break
    let blocks = 0;
    while(rest >= 10){
      const f = Math.min(focus, rest);
      if(f < 10 && blocks > 0) break;
      sequence.push({ k: "F", m: f }); rest -= f; blocks++;
      if(rest >= breakMin + 12){ sequence.push({ k: "B", m: breakMin }); rest -= breakMin; }
    }
    if(rest > 0 && sequence.length){ const lastF = [...sequence].reverse().find(s => s.k === "F"); lastF.m += rest; rest = 0; }   // never leave an orphan block
    if(!sequence.length) sequence.push({ k: "F", m: total - recall });

    const learnRes = chosen.filter(r => LEARN.has(r.type)).sort((a, b) => (b.relevance || 0) * learning.typeWeight(b.type) - (a.relevance || 0) * learning.typeWeight(a.type));
    const practRes = chosen.filter(r => !LEARN.has(r.type));
    const fCount = sequence.filter(s => s.k === "F").length;
    const nPractice = chosen.length ? Math.min(practRes.length || (fCount > 1 ? 1 : 0), Math.max(0, Math.round(fCount * practiceShare))) : (fCount > 1 ? Math.max(1, Math.round(fCount * practiceShare)) : 0);

    const out = []; let fi = 0, li = 0, pi = 0;
    const topicName = goal.topic || subject || "your topic";
    sequence.forEach(s => {
      if(s.k === "B"){ out.push({ id: ui.uid("b"), kind: "break", title: "Breather", minutes: s.m, note: "Stand up, water, look away from the screen." }); return; }
      fi++;
      const isPractice = fCount > 1 && fi > fCount - nPractice;
      if(isPractice){
        const r = practRes[pi++ % Math.max(1, practRes.length)] || null;
        out.push({ id: ui.uid("b"), kind: "practice", title: r ? r.title : `Practice questions on ${topicName}`, minutes: s.m, resourceId: r ? r.id : null, note: r ? "Try it before looking at answers." : "Use your textbook or notes for questions." });
      } else {
        const r = learnRes.length ? learnRes[li++ % learnRes.length] : null;
        // a resource shorter than the slot only fills what it needs; the rest turns into notes time
        let m = s.m;
        if(r && r.durationMin && r.durationMin < m - 4){
          out.push({ id: ui.uid("b"), kind: "learn", title: r.title, minutes: round5(r.durationMin), resourceId: r.id, note: "Pause to write a line or two of notes." });
          const extra = m - round5(r.durationMin);
          if(extra >= 8) out.push({ id: ui.uid("b"), kind: "notes", title: "Write it up in your own words", minutes: extra, note: "Close the tab and summarise from memory." });
          else out[out.length - 1].minutes += extra;
        } else {
          out.push({ id: ui.uid("b"), kind: "learn", title: r ? r.title : `Study ${topicName}`, minutes: m, resourceId: r ? r.id : null, note: r ? "Pause to write a line or two of notes." : "Use your own notes or textbook." });
        }
      }
    });
    out.push({ id: ui.uid("b"), kind: "recall", title: "Recall check", minutes: recall, note: "I'll ask you a couple of questions. No peeking." });

    // exact-sum fix, then no tiny non-break/non-recall blocks
    let sum = out.reduce((a, b) => a + b.minutes, 0);
    const lastWork = [...out].reverse().find(b => b.kind === "learn" || b.kind === "practice" || b.kind === "notes");
    if(lastWork && sum !== total) lastWork.minutes = Math.max(5, lastWork.minutes + (total - sum));
    for(let i = out.length - 1; i > 0; i--){
      if((out[i].kind === "learn" || out[i].kind === "practice" || out[i].kind === "notes") && out[i].minutes < 8){
        const prev = [...out.slice(0, i)].reverse().find(b => b.kind === "learn" || b.kind === "practice" || b.kind === "notes");
        if(prev){ prev.minutes += out[i].minutes; out.splice(i, 1); }
      }
    }
    sum = out.reduce((a, b) => a + b.minutes, 0);

    const reasons = [];
    reasons.push(`${sum} minutes${avail.note && !goal.minutes ? " (" + avail.note + ")" : ""}`);
    reasons.push(`focus blocks of about ${focus} min${slips >= 2 ? ", shorter because this has slipped lately" : diff === 2 ? ", shorter because this subject has felt hard" : ""}`);
    if(urgent) reasons.push("more practice because you're short on time");
    if(!chosen.length) reasons.push("no material chosen, so I used generic blocks");
    return { totalMin: sum, blocks: out, rationale: reasons.join(", ") + "." };
  }

  // simple re-plan when someone skips ahead / runs out of time mid-session
  function trim(plan, minutesLeft){
    const keep = []; let used = 0;
    for(const b of plan.blocks){
      if(b.kind === "recall"){ keep.push(b); used += b.minutes; continue; }
      if(used + b.minutes + 3 <= minutesLeft){ keep.push(b); used += b.minutes; }
    }
    return keep;
  }

  window.DABSy.planner = { build, availableMinutes, trim, suggest };
})();
