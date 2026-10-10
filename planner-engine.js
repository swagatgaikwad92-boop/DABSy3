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
  const round5 = n => Math.max(5, Math.round(n / 5) * 5);

  // minutes you can really give right now: until the next scheduled thing, minus a buffer
  function availableMinutes(now){
    now = now || new Date();
    const n = tasks.nextInstance(now);
    let m = 90;
    if(n){ const gap = Math.floor((n.start - now) / 60000) - 10; if(gap < m) m = gap; }
    if(m < 15) return { minutes: 30, constrained: false, note: "" };
    return { minutes: Math.min(120, m), constrained: !!n && m < 90, note: n ? `until ${n.title} at ${ui.fmtTime(n.start)}` : "" };
  }

  function build(o){
    const goal = o.goal || {};
    const chosen = (o.resources || []).slice();
    const subject = goal.subject || "";
    const diff = learning.difficulty(subject);
    const avail = availableMinutes();
    let total = goal.minutes || (o.totalMin) || Math.min(avail.minutes, 60);
    total = Math.max(15, Math.min(180, Math.round(total / 5) * 5));

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

  window.DABSy.planner = { build, availableMinutes, trim };
})();
