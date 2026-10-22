/* ============================================================
   D.A.B.S.y — dayplan-engine.js   (v11.1: the butler actually plans)
   DABSy.dayplan = { handle(text), detect(text), open(), buildPlan(spec), contextLine(), hasPending() }

   What it does, with real application data only (DABSy.tasks, and Ghibli Calendar events when connected):
     "plan my day / my evening / tomorrow"   -> draft schedule from the current local time
     "plan my week / organise my week"       -> draft week
     "what should I do next?"                -> one recommended action (+ Start / Schedule)
     "I have 30 minutes free"                -> a plan for exactly that window
     "help me prepare for my exam"           -> multi-day revision draft (asks the exam date only if it cannot find it)
     "move my unfinished tasks to tomorrow"  -> moves them (reversible, with Undo)
     "remind me about this later"            -> a real task reminder (reversible, with Undo)

   The schedule is made by ordinary deterministic code (free-time maths, priorities, breaks). The language model is only used,
   when it is reachable, to tidy a messy typed list or to suggest revision topics. A plan is a DRAFT until the student taps Accept;
   Accept writes through tasks.add / tasks.update, reads every record back, and only then says what was saved. Nothing is claimed
   that was not verified. Nothing here is ever deleted without Undo.
   ============================================================ */
(function(){
  const D = window.DABSy, tasks = D.tasks, ui = D.ui, memory = D.memory, bus = D.bus;
  const Core = () => window.DABSyCore;
  const pad = n => String(n).padStart(2, "0");
  const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const atKey = (key, min) => { const d = new Date(key + "T00:00:00"); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return d; };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const minOf = d => d.getHours() * 60 + d.getMinutes();
  const fmt = d => ui.fmtTime(d);
  const connected = () => { try{ const c = Core() && Core().getConnections().calendar; return !!(c && c.enabled); }catch(e){ return false; } };
  const hm = m => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`; };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const clean = s => String(s || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const BUF = 5, BREAK = 10, CHUNK = 50;                  // minutes: buffer around fixed things, short break, longest single focus block

  /* ---------------- time window (the hours that are not quiet hours) ---------------- */
  function toMin(hhmm){ const [h, m] = String(hhmm || "00:00").split(":").map(Number); return h * 60 + (m || 0); }
  function dayWindow(){
    const cfg = memory.read("notify_settings_v1", null), q = D.config.notifications;
    const from = (cfg && cfg.quiet && cfg.quiet.from) || q.quietFrom, to = (cfg && cfg.quiet && cfg.quiet.to) || q.quietTo;
    let start = Math.max(toMin(to), 6 * 60), end = Math.min(toMin(from), 22 * 60);
    try{                                                  // routines the student told me (butler-memory.js)
      const wake = D.bmem && D.bmem.get("wake"), sleep = D.bmem && D.bmem.get("sleep");
      if(wake){ const w = toMin(wake) + 30; if(w >= 4 * 60 && w <= 12 * 60) start = w; }
      if(sleep){ let sl = toMin(sleep); if(sl < 4 * 60) sl += 24 * 60; sl -= 60; if(sl >= 16 * 60 && sl <= 23 * 60 + 30) end = sl; }
    }catch(e){}
    if(end - start < 120){ start = 7 * 60; end = 22 * 60; }
    return { start, end };
  }

  /* ---------------- gathering what exists ---------------- */
  function fixedFor(key){                                  // everything already on that day (tasks with a time + calendar events), as ms intervals
    return tasks.busyForDate(key).map(b => ({ s: b.s, e: b.e, title: b.title, src: b.src })).sort((a, b) => a.s - b.s);
  }
  function freeIntervals(key, fromMin, toMin_){
    const win = [atKey(key, fromMin).getTime(), atKey(key, toMin_).getTime()];
    const busy = fixedFor(key).map(b => [b.s - BUF * 60000, b.e + BUF * 60000]).sort((a, b) => a[0] - b[0]);
    const out = []; let cur = win[0];
    busy.forEach(([s, e]) => { if(e <= cur) return; if(s > cur) out.push([cur, Math.min(s, win[1])]); cur = Math.max(cur, e); });
    if(cur < win[1]) out.push([cur, win[1]]);
    return out.filter(([s, e]) => e - s >= 15 * 60000);
  }
  function candidates(now){                                // real tasks that still need a time: unscheduled, or today's that slipped past
    const out = [], key = dk(now);
    tasks.unscheduled().forEach(t => out.push({ taskId: t.id, title: t.title, durationMin: t.durationMin, priority: t.priority, subject: t.subject, score: tasks.urgency(t, now), why: t.priority === "high" ? "High priority" : t.deadline ? "Has a deadline" : "No time set yet" }));
    tasks.instancesForDate(key).forEach(i => {
      if(i.recurring || !(i.status === "pending") || i.end.getTime() > now.getTime()) return;
      const t = tasks.get(i.taskId); if(!t) return;
      out.push({ taskId: t.id, title: t.title, durationMin: t.durationMin, priority: t.priority, subject: t.subject, score: tasks.urgency(t, now) + 1, why: "Slipped earlier today", overdue: true });
    });
    return out.sort((a, b) => b.score - a.score || a.durationMin - b.durationMin);
  }

  /* ---------------- the scheduler ----------------
     spec = { days:[{ key, from, to }], queue:[{ qid, title, taskId?, durationMin, priority, why, day? , isNew? }], maxPerDay?:minutes }
     -> { items:[work/break blocks in time order], overflow:[queue entries that did not fit] } */
  function schedule(spec){
    const items = [], placed = new Set();
    const queue = spec.queue.map(q => Object.assign({}, q, { left: q.durationMin, parts: 0 }));
    const total = q => Math.ceil(q.durationMin / CHUNK) > 1 && q.durationMin > 60;
    spec.days.forEach(day => {
      const free = freeIntervals(day.key, day.from, day.to);
      const freeMin = free.reduce((a, [s, e]) => a + (e - s) / 60000, 0);
      let budget = spec.maxPerDay ? Math.min(spec.maxPerDay, Math.floor(freeMin * .85)) : Infinity;   // leave ~15 % slack for the unexpected
      let workSinceBreak = 0, lastEnd = 0;
      free.forEach(([fs, fe]) => {
        let cur = fs;
        const eligible = () => queue.filter(q => q.left > 0 && (!q.day || q.day === day.key));
        for(;;){
          const q = eligible()[0]; if(!q || budget < 15) break;
          const room = Math.floor((fe - cur) / 60000);
          if(room < Math.min(15, q.left)) break;
          if(workSinceBreak >= 90 && cur - lastEnd < BREAK * 60000 && room > BREAK + 15){   // long stretch: a proper break first
            items.push({ kind: "break", title: workSinceBreak >= 150 ? "Longer break" : "Break", start: new Date(cur), end: new Date(cur + BREAK * 60000), durationMin: BREAK, dayKey: day.key });
            cur += BREAK * 60000; workSinceBreak = 0; continue;
          }
          const cc = total(q) ? CHUNK : q.left;
          const len = Math.min(q.left, cc, room, budget);
          if(len < Math.min(15, q.left)) break;
          q.parts++; q.left -= len; budget -= len; workSinceBreak += len; placed.add(q.qid);
          items.push({ kind: "work", qid: q.qid, title: q.title, taskId: q.taskId || null, isNew: !!q.isNew, priority: q.priority, why: q.why, subject: q.subject, part: q.parts, start: new Date(cur), end: new Date(cur + len * 60000), durationMin: len, dayKey: day.key });
          cur += len * 60000; lastEnd = cur;
          const more = eligible().length > 0 && budget >= 15;
          if(more && (fe - cur) / 60000 >= BREAK + 15){
            items.push({ kind: "break", title: "Break", start: new Date(cur), end: new Date(cur + BREAK * 60000), durationMin: BREAK, dayKey: day.key });
            cur += BREAK * 60000; workSinceBreak = 0;
          }
        }
      });
    });
    items.forEach(it => { if(it.kind === "work"){ const q = queue.find(x => x.qid === it.qid); it.parts = q.parts; } });
    // a trailing break with nothing after it is just noise
    while(items.length && items[items.length - 1].kind === "break") items.pop();
    for(let i = items.length - 2; i >= 0; i--) if(items[i].kind === "break" && items[i + 1].kind === "break") items.splice(i, 1);
    const overflow = queue.filter(q => q.left > 0).map(q => ({ qid: q.qid, title: q.title, durationMin: q.left }));
    return { items, overflow };
  }

  /* ---------------- plan object (editable) ---------------- */
  let seq = 0, current = null;
  function makePlan(kind, title, spec, extra){
    const p = Object.assign({ id: "plan" + Date.now().toString(36) + (++seq), kind, title, createdAt: Date.now(), spec, assumptions: [], saved: false, rejected: false }, extra || {});
    p.spec.queue.forEach((q, i) => { if(q.qid == null) q.qid = "q" + i + "_" + Math.random().toString(36).slice(2, 6); });
    reflow(p); return p;
  }
  function reflow(p){
    const r = schedule(p.spec); p.items = r.items; p.overflow = r.overflow;
    p.fixed = {}; p.spec.days.forEach(d => { p.fixed[d.key] = fixedFor(d.key).filter(f => f.e > atKey(d.key, d.from).getTime() - 1 && f.s < atKey(d.key, d.to).getTime()); });
  }

  /* ---------------- building the specific plans ---------------- */
  function dayRange(now, part){
    const w = dayWindow(); let from = w.start, to = w.end;
    if(part === "morning") to = Math.min(to, 12 * 60);
    if(part === "afternoon"){ from = Math.max(from, 12 * 60); to = Math.min(to, 17 * 60); }
    if(part === "evening"){ from = Math.max(from, 17 * 60); }
    return { from, to };
  }
  function toQueue(list){ return list.map(c => ({ title: c.title, taskId: c.taskId || null, durationMin: c.durationMin, priority: c.priority || "normal", why: c.why, subject: c.subject || "", isNew: !!c.isNew, day: c.day || null })); }

  function planDay(o){
    o = o || {};
    const now = new Date(); let target = o.tomorrow ? addDays(now, 1) : now, notes = [];
    let { from, to } = dayRange(now, o.part);
    const isToday = dk(target) === dk(now);
    if(isToday){
      const nm = Math.ceil((minOf(now) + 5) / 5) * 5;
      if(nm >= to - 20){ target = addDays(now, 1); ({ from, to } = dayRange(now, o.part)); notes.push(`It's already ${fmt(now)}, so I planned tomorrow instead.`); }
      else from = Math.max(from, nm);
    }
    const key = dk(target), isNow = key === dk(now);
    const cand = o.extra && o.extra.length ? o.extra.concat(candidates(now).filter(c => !o.extra.some(e => e.taskId === c.taskId))) : candidates(now);
    const free = freeIntervals(key, from, to), freeMin = Math.round(free.reduce((a, [s, e]) => a + (e - s) / 60000, 0));
    const fixed = fixedFor(key).filter(f => f.e > atKey(key, from).getTime() && f.s < atKey(key, to).getTime());
    if(!cand.length) return { empty: true, key, freeMin, fixed };
    const p = makePlan("day", isNow ? (o.part ? `Your ${o.part}` : "The rest of today") : "Tomorrow", { days: [{ key, from, to }], queue: toQueue(cand) }, { assumptions: notes });
    if(!connected()) p.assumptions.push("Ghibli Calendar isn't connected, so I only worked around the tasks that have a time.");
    { const w0 = dayWindow(); p.assumptions.push(`Kept inside your waking hours, ${fmt(atKey(key, w0.start))}–${fmt(atKey(key, w0.end))}.`); }
    return p;
  }
  function planWeek(){
    const now = new Date(), w = dayWindow(), days = [], notes = [];
    for(let i = 0; i < 7; i++){
      const d = addDays(now, i), key = dk(d); let from = w.start;
      if(i === 0){ const nm = Math.ceil((minOf(now) + 5) / 5) * 5; if(nm >= w.end - 60) continue; from = Math.max(from, nm); }
      days.push({ key, from, to: w.end });
    }
    const cand = candidates(now);
    if(!cand.length) return { empty: true };
    const p = makePlan("week", "Your week", { days, queue: toQueue(cand), maxPerDay: 240 }, { assumptions: notes });
    p.assumptions.push("No more than about 4 hours of focus work per day, so there's room for surprises.");
    if(!connected()) p.assumptions.push("Ghibli Calendar isn't connected, so calendar events aren't in this plan.");
    return p;
  }
  function planFree(minutes, extra){
    const now = new Date(), key = dk(now), start = Math.ceil((minOf(now) + 3) / 5) * 5, end = Math.min(start + minutes, 24 * 60 - 1);
    const all = (extra && extra.length ? extra : []).concat(candidates(now).filter(c => !(extra || []).some(e => e.taskId === c.taskId)));
    if(!all.length) return { empty: true, minutes };
    // choose what fits: take the most urgent, and a first slice of it if it is longer than the window
    const picked = []; let left = minutes;
    for(const c of all){
      if(left < 15) break;
      const slice = Math.min(c.durationMin, left);
      if(slice < Math.min(15, c.durationMin)) continue;
      picked.push(Object.assign({}, c, { durationMin: slice, why: slice < c.durationMin ? `First ${slice} min of ${hm(c.durationMin)}` : c.why }));
      left -= slice + BREAK;
    }
    if(!picked.length) return { empty: true, minutes };
    const p = makePlan("free", `Your ${hm(minutes)}`, { days: [{ key, from: start, to: end }], queue: toQueue(picked) });
    p.assumptions.push(`Starts at ${fmt(atKey(key, start))}, ends by ${fmt(atKey(key, end))}.`);
    return p;
  }

  /* ---------------- exam preparation ---------------- */
  const GENERIC_PHASES = ["Review your notes and summaries", "Practise questions on the weak topics", "Do a timed past paper or mixed practice", "Fix mistakes from practice", "Quick final review (light)"];
  function findExam(subject){
    const now = new Date(), today = dk(now); let best = null;
    const re = subject ? new RegExp("\\b" + subject.replace(/[^\p{L}\p{N}]/gu, "") + "\\b", "i") : null;
    const isExam = s => /\b(exam|test|quiz|midterm|finals?|viva|boards?)\b/i.test(s);
    try{ if(connected()) Core().getCalendarEvents().forEach(e => { if(e.date >= today && isExam(e.title) && (!re || re.test(e.title)) && (!best || e.date < best.date)) best = { date: e.date, title: e.title, src: "calendar" }; }); }catch(e){}
    tasks.list().forEach(t => { const d = t.deadline || t.dueAt; if(!d || t.status === "done" || t.status === "cancelled") return; const k = dk(new Date(d)); if(k >= today && isExam(t.title) && (!re || re.test(t.title)) && (!best || k < best.date)) best = { date: k, title: t.title, src: "task" }; });
    return best;
  }
  async function topicsFor(subject){
    const ai = D.ai;
    if(ai && ai.status() !== "limited" && ai.askJSON){
      try{
        const r = await Promise.race([ai.askJSON({ task: "plan", prompt: `List 4 to 6 core revision topics a student should cover for a ${subject} exam. Reply ONLY with JSON: {"topics":["..."]}. Short topic names, no explanations.` }), new Promise(res => setTimeout(() => res(null), 9000))]);
        const t = r && Array.isArray(r.topics) ? r.topics.map(x => String(x).trim()).filter(Boolean).slice(0, 6) : [];
        if(t.length >= 3) return { topics: t, generic: false };
      }catch(e){}
    }
    return { topics: GENERIC_PHASES, generic: true };
  }
  async function planExam(subject, dateKey_){
    const now = new Date(), today = dk(now), w = dayWindow();
    const daysLeft = Math.round((new Date(dateKey_ + "T00:00:00") - new Date(today + "T00:00:00")) / 864e5);
    if(daysLeft < 0) return { error: "That date has already passed." };
    const span = Math.max(1, Math.min(daysLeft || 1, 7));                 // revise on the days BEFORE the exam (today only when it is tomorrow or today)
    const { topics, generic } = await topicsFor(subject || "the subject");
    const dayList = [];
    for(let i = 0; i < span; i++){
      const key = dk(addDays(now, i)); if(key >= dateKey_ && daysLeft > 0) break;
      let from = w.start; if(i === 0){ const nm = Math.ceil((minOf(now) + 5) / 5) * 5; if(nm >= w.end - 45){ continue; } from = Math.max(from, nm); }
      dayList.push({ key, from, to: w.end });
    }
    if(!dayList.length) return { error: "There isn't enough time left today to plan sessions. Want me to plan tomorrow?" };
    const label = subject ? cap(subject) : "Exam";
    const queue = []; let t = 0;
    dayList.forEach((d, di) => {
      const last = di === dayList.length - 1 && dayList.length > 1;
      const perDay = last ? 1 : 2;
      for(let s = 0; s < perDay; s++){
        const topic = last ? "Quick final review (light)" : topics[t++ % topics.length];
        queue.push({ title: `${label}: ${topic}`, durationMin: last ? 30 : 45, priority: "high", why: generic ? "Revision step" : "Key topic", subject: subject || "", isNew: true, day: d.key });
      }
    });
    const p = makePlan("exam", `${label} exam${daysLeft > 0 ? ` in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : " today"}`, { days: dayList, queue });
    if(generic) p.assumptions.push("I used a general revision order. Tell me your syllabus or weak topics and I'll tailor it.");
    p.assumptions.push(`Exam date: ${new Date(dateKey_ + "T00:00:00").toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}.`);
    return p;
  }

  /* ---------------- accepting: write, read back, report honestly ---------------- */
  function saveStep(p){
    const undo = [], created = [], touched = [], failed = [];
    const works = p.items.filter(i => i.kind === "work");
    const byQ = {}; works.forEach(w => { (byQ[w.qid] = byQ[w.qid] || []).push(w); });
    Object.keys(byQ).forEach(qid => {
      const blocks = byQ[qid].sort((a, b) => a.start - b.start);
      blocks.forEach((b, i) => {
        const iso = b.start.toISOString(), title = i === 0 || !b.parts || b.parts < 2 ? b.title : `${b.title} (part ${i + 1})`;
        const prevT = b.taskId && i === 0 ? tasks.get(b.taskId) : null;
        if(prevT){
          const prev = { dueAt: prevT.dueAt, durationMin: prevT.durationMin };
          tasks.update(prevT.id, { dueAt: iso, durationMin: b.durationMin });
          const now = tasks.get(prevT.id);
          if(now && now.dueAt === iso) { undo.push({ id: prevT.id, prev }); touched.push({ id: prevT.id, iso }); } else failed.push(b.title);
        }else{
          const t = tasks.add({ title: i === 0 ? b.title : title, dueAt: iso, durationMin: b.durationMin, priority: b.priority || "normal", subject: b.subject || "", source: "dabsy-plan", notes: "Added from a DABSy plan." });
          const back = t && tasks.get(t.id);
          if(back && back.dueAt === iso){ created.push(t.id); touched.push({ id: t.id, iso }); } else failed.push(b.title);
        }
      });
    });
    return { undo, created, touched, failed, total: works.length };
  }
  function undoSave(r){
    r.created.forEach(id => tasks.remove(id));
    r.undo.forEach(u => tasks.update(u.id, u.prev));
    const ok = r.created.every(id => !tasks.get(id)) && r.undo.every(u => (tasks.get(u.id) || {}).dueAt === u.prev.dueAt);
    return ok;
  }
  function notifyNote(){
    try{ const s = D.notify && D.notify.settings(); if(typeof Notification !== "undefined" && Notification.permission === "granted" && s && s.system) return ""; }catch(e){}
    return " Reminders will show inside DABSy; turn on system notifications in Settings to get them when the app is closed.";
  }

  /* ---------------- the plan card ---------------- */
  let sheetRef = null;
  function say(r){ D.app.say(r.text, r.state, r.opts); }
  function accept(p){
    const r = saveStep(p);
    p.saved = true; p.rejected = false;
    const ok = r.touched.length, n = r.total;
    let text;
    if(!n) text = "There was nothing in that plan to save.";
    else if(!r.failed.length) text = `Saved. ${ok} ${ok === 1 ? "task is" : "tasks are"} on your list at the times shown.${notifyNote()}`;
    else text = `I saved ${ok} of ${n}, but couldn't confirm: ${r.failed.slice(0, 3).join(", ")}. Nothing else was changed.`;
    if(sheetRef){ sheetRef.close("accepted"); sheetRef = null; }
    const opts = (r.touched.length) ? { actions: [{ label: "Undo", onClick: () => { const ok2 = undoSave(r); p.saved = false; say(ok2 ? { text: "Okay, I've taken that plan back out of your tasks.", state: "IDLE" } : { text: "I tried to undo the plan but couldn't confirm every change. Please check your tasks.", state: "CONFUSED" }); } }] } : undefined;
    say({ text, state: r.failed.length ? "CONCERNED" : "HAPPY", opts });
    return r;
  }
  function reject(p){
    p.rejected = true;
    if(sheetRef){ sheetRef.close("rejected"); sheetRef = null; }
    say({ text: "No problem — I've discarded that plan and changed nothing.", state: "IDLE" });
  }

  function open(p){
    p = p || current; if(!p) return false;
    current = p;
    if(sheetRef){ try{ sheetRef.close("replaced"); }catch(e){} sheetRef = null; }
    D.require && D.loadCSS && D.loadCSS("dayplan.css");
    const sh = ui.sheet({ title: p.title, className: "dp-sheet", onClose: res => { if(sheetRef === sh) sheetRef = null; if(!res && !p.saved && !p.rejected) say({ text: "I've kept that plan as a draft. Say “show my plan” to open it again.", state: "IDLE", opts: { actions: [{ label: "Open plan", primary: true, onClick: () => open(p) }] } }); } });
    sheetRef = sh;
    paint(p, sh);
    return true;
  }
  function paint(p, sh){
    const body = sh.body; body.textContent = "";
    const works = p.items.filter(i => i.kind === "work"), mins = works.reduce((a, b) => a + b.durationMin, 0);
    const el = ui.el;
    body.append(el("div", { class: "dp-sum" },
      el("div", { class: "dp-sum-main" }, works.length ? `${new Set(works.map(w => w.qid)).size} ${new Set(works.map(w => w.qid)).size === 1 ? "task" : "tasks"} · ${hm(mins)} of focus` : "Nothing fits in this window"),
      works.length ? el("div", { class: "dp-sum-sub" }, `${fmt(works[0].start)} – ${fmt(works[works.length - 1].end)}`) : null));
    if(p.assumptions.length) body.append(el("ul", { class: "dp-assume" }, p.assumptions.map(a => el("li", { text: a }))));
    const keys = p.spec.days.map(d => d.key);
    keys.forEach(key => {
      const dayItems = p.items.filter(i => i.dayKey === key), fx = p.fixed[key] || [];
      if(!dayItems.length && !fx.length) return;
      const group = el("section", { class: "dp-day" });
      if(keys.length > 1 || key !== dk(new Date())) group.append(el("h3", { text: ui.dayLabel(new Date(key + "T00:00:00")) }));
      const rows = dayItems.map(i => ({ t: i.start.getTime(), i })).concat(fx.map(f => ({ t: f.s, f }))).sort((a, b) => a.t - b.t);
      rows.forEach(r => {
        if(r.f){ group.append(el("div", { class: "dp-row fixed" }, el("span", { class: "dp-time", text: fmt(new Date(r.f.s)) }), el("span", { class: "dp-title" }, clean(r.f.title), el("small", { text: " already scheduled" })))); return; }
        const it = r.i;
        if(it.kind === "break"){ group.append(el("div", { class: "dp-row brk" }, el("span", { class: "dp-time", text: fmt(it.start) }), el("span", { class: "dp-title", text: `${it.title} · ${it.durationMin} min` }))); return; }
        const first = it.part === 1, row = el("div", { class: "dp-row work p-" + (it.priority || "normal") });
        row.append(el("span", { class: "dp-time", text: fmt(it.start) }),
          el("span", { class: "dp-title" }, (() => { const bb = el("b", { text: it.parts > 1 ? `${clean(it.title)} (${it.part}/${it.parts})` : clean(it.title) }); const qq = p.spec.queue.find(x => x.qid === it.qid); if(first && qq && !qq.taskId){ bb.classList.add("dp-edit"); bb.setAttribute("role", "button"); bb.setAttribute("tabindex", "0"); bb.title = "Tap to rename"; bb.addEventListener("click", ev => { ev.stopPropagation(); const inp = el("input", { type: "text", class: "dp-rename", value: qq.title, "aria-label": "Rename", maxlength: "80" }); const commit = () => { const v = inp.value.trim(); if(v) qq.title = v.slice(0, 80); reflow(p); paint(p, sh); }; inp.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); commit(); } }); inp.addEventListener("blur", commit); bb.replaceWith(inp); inp.focus(); inp.select(); }); } return bb; })(),
            el("small", { text: ` ${hm(it.durationMin)}${it.why && first ? " · " + it.why : ""}` })));
        if(first){
          const q = p.spec.queue.find(x => x.qid === it.qid), idx = p.spec.queue.indexOf(q);
          const btn = (label, aria, fn, dis) => el("button", { type: "button", class: "dp-btn", "aria-label": aria, disabled: dis ? "" : null, text: label, onclick: ev => { ev.stopPropagation(); fn(); reflow(p); paint(p, sh); } });
          row.append(el("span", { class: "dp-ctl" },
            btn("↑", `Move ${it.title} earlier`, () => { p.spec.queue.splice(idx, 1); p.spec.queue.splice(idx - 1, 0, q); }, idx === 0),
            btn("↓", `Move ${it.title} later`, () => { p.spec.queue.splice(idx, 1); p.spec.queue.splice(idx + 1, 0, q); }, idx === p.spec.queue.length - 1),
            btn("−", `Shorten ${it.title} by 15 minutes`, () => { q.durationMin = Math.max(15, q.durationMin - 15); }, q.durationMin <= 15),
            btn("+", `Lengthen ${it.title} by 15 minutes`, () => { q.durationMin = Math.min(240, q.durationMin + 15); }, q.durationMin >= 240),
            btn("✕", `Remove ${it.title} from the plan`, () => { p.spec.queue.splice(idx, 1); })));
        }
        group.append(row);
      });
      body.append(group);
    });
    if(p.overflow.length){
      body.append(el("div", { class: "dp-over" }, el("b", { text: "Didn't fit: " }), p.overflow.map(o => `${clean(o.title)} (${hm(o.durationMin)})`).join(", "),
        el("div", { class: "dp-over-sub", text: p.kind === "week" ? "Free up time or shorten something, and I'll fit it in." : "Shorten something above, or ask me to plan tomorrow." })));
    }
    const add = el("div", { class: "dp-add" });
    const inp = el("input", { type: "text", placeholder: "Add something (e.g. physics 30 min)", enterkeyhint: "done", "aria-label": "Add an item to this plan", autocomplete: "off" });
    const doAdd = () => { const it = parseItems(inp.value)[0]; if(!it) return; p.spec.queue.push(Object.assign({ qid: "q" + Math.random().toString(36).slice(2, 7), why: "Added by you", isNew: true }, it, { day: null })); reflow(p); paint(p, sh); };
    inp.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); doAdd(); } });
    add.append(inp, el("button", { type: "button", class: "dp-btn", text: "Add", onclick: doAdd }));
    body.append(add);
    body.append(el("div", { class: "dp-foot" },
      el("button", { type: "button", class: "dp-main", disabled: works.length ? null : "", text: works.length ? "Accept & save" : "Nothing to save", onclick: () => accept(p) }),
      el("button", { type: "button", class: "dp-ghost", text: "Reject", onclick: () => reject(p) })));
    body.append(el("p", { class: "dp-note", text: "This is a draft. Nothing is saved until you tap Accept." }));
  }

  /* ---------------- typed lists ("maths homework 1 hr, physics revision 45 min") ---------------- */
  function parseItems(text){
    const ai = D.ai;
    return String(text || "").split(/\n|;|,(?![^()]*\))|\band\b(?=\s+\p{L})/iu).map(s => s.trim()).filter(s => s.length > 1).slice(0, 8).map(s => {
      const dur = (ai && ai.parseDuration ? ai.parseDuration(s) : null) || 45;
      let title = s.replace(/\b(for|about|around)?\s*\d+(?:\.\d+)?\s*-?\s*(hours?|hrs?|h|minutes?|mins?|m)\b/ig, " ").replace(/\b(an|one) hour\b/ig, " ").replace(/\bhalf an hour\b/ig, " ").replace(/\b(i need to|i have to|i want to|i should|need to|have to|please|plan|just)\b/ig, " ").replace(/\s+/g, " ").replace(/^(of|on|for)\s+/i, "").trim();
      if(!title) return null;
      const sub = ai && ai.subjectOf ? ai.subjectOf(s) : null;
      return { title: cap(title), durationMin: Math.max(15, Math.min(240, dur)), priority: /\b(urgent|important|asap|due tomorrow|exam)\b/i.test(s) ? "high" : "normal", subject: sub ? sub.name : "" };
    }).filter(Boolean);
  }
  async function parseItemsSmart(text){
    const ai = D.ai;
    if(ai && ai.status() !== "limited" && String(text).length > 40 && ai.askJSON){
      try{
        const r = await Promise.race([ai.askJSON({ task: "plan", prompt: `The student listed things to do today. Return ONLY JSON: {"items":[{"title":"","minutes":45,"priority":"normal"}]}. Use only what they said; priority is low|normal|high; guess minutes only if missing. Text: ${text}` }), new Promise(res => setTimeout(() => res(null), 8000))]);
        if(r && Array.isArray(r.items) && r.items.length) return r.items.slice(0, 8).map(x => ({ title: cap(String(x.title || "").trim()), durationMin: Math.max(15, Math.min(240, Number(x.minutes) || 45)), priority: ["low", "normal", "high"].includes(x.priority) ? x.priority : "normal", subject: (ai.subjectOf(String(x.title || "")) || {}).name || "" })).filter(x => x.title);
      }catch(e){}
    }
    return parseItems(text);
  }

  /* ---------------- intent detection ---------------- */
  const WORD_N = { a: 1, an: 1, one: 1, half: .5 };
  function minutesFrom(t){
    let m = t.match(/\b(\d+(?:\.\d+)?|an?|one|half an?)\s*(hours?|hrs?|h)\b/i);
    if(m){ const raw = m[1].toLowerCase(); const n = /^half/.test(raw) ? .5 : (WORD_N[raw] || parseFloat(raw)); return Math.round(n * 60); }
    m = t.match(/\b(\d+)\s*(minutes?|mins?|m)\b/i); if(m) return Number(m[1]);
    if(/\bhalf an hour\b/i.test(t)) return 30;
    return null;
  }
  function detect(text){
    const t = String(text || "").toLowerCase().replace(/[’]/g, "'").trim();
    if(!t || t.length > 220) return null;
    if(/\bremind me\b/.test(t)){
      if(/\bremind me\s+(?:about\s+(?:this|that|it)|this|that|it)\b/.test(t) || /^(?:please\s+)?remind me(?:\s+(?:later|again|in\s+.+|after(?:wards)?))?[.!]?$/.test(t)) return { type: "remind" };
      const m = t.match(/\bremind me to\s+(.+?)\s+(later|in (?:an? |\d+(?:\.\d+)? ?)(?:hours?|hrs?|minutes?|mins?))\b/);
      if(m && !/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/.test(t)) return { type: "remind", target: m[1], when: m[2] };
      return null;
    }
    if(/\b(move|push|shift|carry|reschedule|postpone)\b.{0,30}\b(unfinished|incomplete|undone|pending|leftover|left ?over|remaining|overdue|missed|everything (?:left|i didn'?t))\b.{0,40}\btomorrow\b/.test(t) || /\bmove (?:what'?s|everything) (?:left|unfinished|undone) to tomorrow\b/.test(t) || /\b(?:unfinished|incomplete|undone|leftover|remaining)\s+(?:tasks?|things|work|items)\b.{0,20}\btomorrow\b/.test(t)) return { type: "moveUnfinished" };
    if(/\b(plan|organi[sz]e|schedule|sort out|map out|arrange|structure|lay out)\b.{0,24}\b(my|the|this|next|our)?\s*week\b/.test(t)) return { type: "week" };
    if(/\b(plan|organi[sz]e|schedule|sort out|map out|arrange|structure|lay out)\b.{0,24}\b(day|today|tomorrow|morning|afternoon|evening)\b/.test(t) || /^(what'?s|what is) (my|the) plan\b/.test(t) || /\bplan (it|things) for me\b/.test(t)) return { type: "day", tomorrow: /\btomorrow\b/.test(t), part: (t.match(/\b(morning|afternoon|evening)\b/) || [])[1] || null };
    if(/\b(prepare|prep|revise|revision|study|get ready|ready|cram)\b.{0,30}\b(exams?|tests?|quiz|quizzes|finals?|boards?|midterms?|vivas?)\b/.test(t) || /\b(exams?|tests?)\b.{0,20}\b(prep|preparation|revision|plan)\b/.test(t)) return { type: "exam", subject: (D.ai && D.ai.subjectOf ? (D.ai.subjectOf(t) || {}).name : "") || "" , raw: t };
    const f = t.match(/\b(?:i\s*(?:have|got|'ve got|am free for|'m free for|have got)|free for|got|have)\s+(?:about |around |just |only |roughly )?((?:\d+(?:\.\d+)?|an?|one|half an?)\s*(?:hours?|hrs?|h|minutes?|mins?|m))\b/) || t.match(/\b(\d+\s*(?:minutes?|mins?|hours?|hrs?))\s+(?:free|spare|to spare|available)\b/);
    if(f && !/\b(exam|deadline|due)\b/.test(t)){ const mins = minutesFrom(f[1]); if(mins && mins >= 5 && mins <= 480) return { type: "free", minutes: mins }; }
    if(/^(?:so,? )?(?:what (?:should|can|do) i (?:do|work on|focus on|start)(?: next| now| first)?|what'?s next(?: for me)?|what next|what now|next action|what do i do now|where (?:do|should) i start|help me (?:start|begin|get started)|i'?m (?:bored|free now)|i don'?t know what to do)\b/.test(t)) return { type: "next" };
    if(/\b(talk|chat|speak|discuss)\b.{0,25}\b(about )?(my|the)? ?(day|today)\b/.test(t) || /^how('?s| is) (my|the) day\b/.test(t)) return { type: "talkday" };
    if(/\b(show|open|see)\b.{0,12}\b(my )?(last |current )?plan\b/.test(t)) return { type: "show" };
    return null;
  }

  /* ---------------- handlers ---------------- */
  let pending = null;           // { type:"ctx"|"examdate"|"confirmMove"|"remindWhat", ... }
  const needContext = (mode, extra) => {
    pending = Object.assign({ type: "ctx", mode }, extra || {});
    const lead = mode === "week" ? "I'll build your week around what you tell me." : mode === "free" ? `I can use those ${hm(extra.minutes)} well.` : mode === "next" ? "Your list is clear, so you're free to choose." : "I'll build today around what you tell me.";
    return { text: `${lead} What do you need to get done, and roughly how long for each? For example: “maths homework 1 hr, gym 45 min, call mum”.`, state: "CURIOUS", opts: { choices: { mode: "single", options: ["30 min of study", "A workout", "Chores", "Time to rest"], allowCustom: true } } };
  };
  function planReply(p, lead){
    current = p;
    const works = p.items.filter(i => i.kind === "work");
    if(!works.length){                                    // nothing could be placed: say so plainly instead of opening an empty card
      const fx = Object.values(p.fixed || {}).flat();
      return { text: fx.length ? `That window is already booked (${clean(fx[0].title)}${fx.length > 1 ? ` and ${fx.length - 1} more` : ""}), so there's no room to add anything. Want me to plan tomorrow instead?` : "There isn't enough free time left in that window. Want me to plan tomorrow instead?", state: "CURIOUS" };
    }
    open(p);
    return { text: `${lead || "Here's a draft."} ${works.length ? `${works.length} block${works.length === 1 ? "" : "s"} · ${hm(works.reduce((a, b) => a + b.durationMin, 0))}.` : "Nothing fit."} Review it, then Accept, edit, or Reject.`, state: "HAPPY" };
  }
  /* ---------- a conversation first, a plan second ----------
     "plan my day" is not always "build a timetable now": the student may want to talk the day through, see what is on, or add
     non-study things (rest, a workout, chores, friends). So she opens with a short, context-aware question; the choices change
     with what she knows (tasks, time of day, what has been said); typing a free answer always works. */
  let lastIntroAt = 0, talk = null;
  const WANTS_NOW = /\b(just|quick(?:ly)?|straight ?away|right now|immediately|go ahead|asap|don'?t ask|no questions)\b/i;
  function taskFacts(){
    const now = new Date(), key = dk(now);
    const sched = tasks.instancesForDate(key).filter(i => i.status === "pending" || i.status === "active").length;
    return { waiting: candidates(now).length, sched };
  }
  function hourWord(){ const h = new Date().getHours(); return h < 12 ? "this morning" : h < 17 ? "this afternoon" : h < 21 ? "this evening" : "tonight"; }
  function intro(o, raw){
    const f = taskFacts(), when = o.tomorrow ? "tomorrow" : o.mode === "week" ? "this week" : "today";
    pending = { type: "dayIntro", o };
    const name = D.bmem && D.bmem.get("name");
    const lead = name ? `Of course, ${name}.` : "Of course.";
    let text, opts;
    if(f.waiting || f.sched){
      text = `${lead} I can see ${[f.waiting ? `${f.waiting} thing${f.waiting === 1 ? "" : "s"} waiting for a time` : "", f.sched ? `${f.sched} already scheduled ${o.tomorrow ? "" : "today"}`.trim() : ""].filter(Boolean).join(" and ")}. Shall I draft ${when} around that, or would you like to talk it through first?`;
      opts = ["Draft it now", "Talk it through first", "Add something else first", "Just show what's on"];
    }else{
      text = `${lead} Nothing is lined up for ${when} yet, which gives us room. Would you like to talk about how ${when} should feel, or shall I sketch it from a few things you pick?`;
      opts = ["Let's talk first", "Sketch it with me", "Just show what's on"];
    }
    return { text, state: "CURIOUS", opts: { choices: { mode: "single", options: opts, allowCustom: true } } };
  }
  async function doDay(o, raw){
    o = o || {};
    if(!WANTS_NOW.test(raw || "") && Date.now() - lastIntroAt > 10 * 60000) return intro(o, raw);
    return directDay(o);
  }
  async function directDay(o){
    const r = planDay(o);
    if(r.empty) return categoryPicker({ tomorrow: !!o.tomorrow, part: o.part || null });
    return planReply(r, r.kind === "day" && /tomorrow/i.test(r.title) ? "Here's a draft for tomorrow." : "Here's a draft built from your list and your free time.");
  }
  async function doWeek(raw){
    if(!WANTS_NOW.test(raw || "") && Date.now() - lastIntroAt > 10 * 60000) return intro({ mode: "week" }, raw);
    return directWeek();
  }
  async function directWeek(){
    const r = planWeek();
    if(r.empty) return categoryPicker({ mode: "week" });
    return planReply(r, "Here's a draft week.");
  }

  /* a day is more than study: pick what belongs in it (multi-select; typing your own is welcome) */
  const CATS = { "Study": { t: "Study block", m: 60 }, "Homework": { t: "Homework", m: 60 }, "Workout": { t: "Workout", m: 45 }, "Chores": { t: "Chores", m: 30 }, "Errands": { t: "Errands", m: 45 },
    "Rest": { t: "Rest and recharge", m: 30 }, "Meals": { t: "Cook / meal", m: 40 }, "Friends & family": { t: "Time with friends or family", m: 60 }, "Hobby": { t: "Hobby time", m: 45 }, "Reading": { t: "Reading", m: 30 } };
  function categoryPicker(ctx){
    pending = Object.assign({ type: "cats" }, ctx);
    return { text: "What should it hold? Pick anything that belongs — it doesn't all have to be study — or tell me in your own words.", state: "CURIOUS", opts: { choices: { mode: "multi", options: Object.keys(CATS), allowCustom: true } } };
  }
  function planFromItems(p, items, lead){
    const extra = items.map(i => Object.assign({ why: "You asked for it", isNew: true }, i));
    let planR;
    if(p.mode === "week"){ const now = new Date(), w = dayWindow(), days = []; for(let i = 0; i < 7; i++){ const key = dk(addDays(now, i)); let from = w.start; if(i === 0){ const nm = Math.ceil((minOf(now) + 5) / 5) * 5; if(nm >= w.end - 60) continue; from = Math.max(from, nm); } days.push({ key, from, to: w.end }); } planR = makePlan("week", "Your week", { days, queue: toQueue(extra.concat(candidates(now))), maxPerDay: 240 }); planR.assumptions.push("No more than about 4 hours of focus work per day."); }
    else if(p.mode === "free") planR = planFree(p.minutes, extra);
    else planR = planDay({ tomorrow: p.tomorrow, part: p.part, extra });
    if(planR.empty) return { text: "I couldn't fit that into the time left. Try fewer things, or ask me to plan tomorrow.", state: "CURIOUS" };
    if(items.some(i => i.generic)) planR.assumptions.unshift("Titles and lengths are general. Tap a new item's title to rename it, or use − / + to adjust.");
    return planReply(planR, lead || "Here's a draft from what you told me.");
  }

  /* small talk about the day. Each turn she answers briefly (model if reachable, otherwise a gentle scripted question) and offers
     choices that change with how far the talk has gone. She never saves anything while talking. */
  const TALK_Q = ["How's the day treating you so far?", "What's the one thing you'd most like to get done?", "Anything you want to protect time for — rest, a workout, friends?", "How's your energy right now — fresh, or running low?"];
  function startTalk(first, o){
    talk = { turns: [], n: 0, o: o || {} };
    pending = { type: "dayTalk" };
    if(first) return talkTurn(first);
    const who = D.bmem && D.bmem.lastDay && D.bmem.lastDay();
    const line = who && Date.now() - who.at < 18 * 3600e3 ? `Last time we spoke you mentioned: ${who.text.toLowerCase().replace(/\.$/, "")}. How did that go?` : TALK_Q[0];
    return { text: `Happy to. ${line}`, state: "CURIOUS", opts: { choices: { mode: "single", options: ["Plan it now", "Not now"], allowCustom: true } } };
  }
  async function talkTurn(text){
    talk.turns.push(text); talk.n++;
    try{ const learned = D.bmem && D.bmem.learnFrom(text); if(learned) ui.toast && ui.toast({ text: "Noted: " + learned.text, timeout: 5000, actions: [{ label: "Forget", onClick: () => D.bmem.forget(learned.id) }] }); }catch(e){}
    let reply = "";
    const ai = D.ai;
    if(ai && ai.status() !== "limited" && ai.generate){
      const ctx = contextLine(), mem = D.bmem ? D.bmem.prompt() : "";
      const hist = talk.turns.slice(-4).map(t => "Student: " + t).join("\n");
      const r = await Promise.race([ai.generate({ task: "chat", prompt: [
        "You are having a short, warm conversation about the student's day. Do NOT build a schedule or save anything now.",
        "Reply in 1-3 short sentences (under 45 words). Acknowledge what they said, then ask at most ONE gentle question that helps you understand the day (priorities, energy, commitments, things to protect such as rest, exercise, meals or friends). A student's day is not only study: never push study unless they bring it up.",
        "If they sound done talking, say you can turn it into a plan whenever they like. No markdown, no emojis.",
        ctx, mem, hist, "D.A.B.S.y:" ].filter(Boolean).join("\n") }), new Promise(res => setTimeout(() => res(null), 12000))]);
      if(r && r.ok) reply = (ai.chat ? String(r.text) : r.text).replace(/^(d\.?a\.?b\.?s\.?y\.?\s*:)\s*/i, "").replace(/\*\*/g, "").trim();
    }
    if(!reply) reply = talk.n === 1 ? "I see. " + TALK_Q[1] : TALK_Q[Math.min(talk.n, TALK_Q.length - 1)];
    // the choices change with the conversation: early -> keep going / plan; later -> offer to turn it into a plan or just stop
    const mentioned = (await parseItemsSmartCheap(talk.turns.join(", "))).length;
    const options = talk.n < 2 ? ["Plan it now", "Not now"] : mentioned ? ["Plan my day from this", "Keep talking", "Not now"] : ["Plan my day from this", "Keep talking", "Just show what's on", "Not now"];
    return { text: reply, state: "IDLE", opts: { choices: { mode: "single", options, allowCustom: true } } };
  }
  async function parseItemsSmartCheap(text){ try{ return parseItems(text).filter(i => !/^(yes|no|ok|okay|fine|good|tired|busy|stressed|bored|not|nothing|nope|nah|hi|hello)\b/i.test(i.title) && i.title.split(" ").length <= 6 && /\d|\b(homework|study|revise|revision|workout|gym|run|clean|cook|call|read|write|practice|class|lecture|project|assignment|exam|test|errand|shop|meet|friend|chore|laundry)\b/i.test(i.title)); }catch(e){ return []; } }
  async function endTalk(planIt){
    const turns = talk ? talk.turns.slice() : []; const o = talk ? talk.o : {}; talk = null; pending = null;
    if(turns.length){
      try{ D.bmem && D.bmem.noteDay(turns.join(" · ")); }catch(e){}
      D.bmem && D.bmem.extract(turns).then(fs => { if(fs && fs.length && ui.toast) fs.forEach(f => ui.toast({ text: "I'll remember: " + f.text, timeout: 7000, actions: [{ label: "Forget", onClick: () => D.bmem.forget(f.id) }] })); });
    }
    if(!planIt) return { text: "Of course. I'm here whenever you'd like to plan.", state: "IDLE" };
    lastIntroAt = Date.now();
    const items = turns.length ? (await parseItemsSmart(turns.join(", "))).filter(i => i.title.split(" ").length <= 7) : [];
    const real = items.length ? await parseItemsSmartCheap(turns.join(", ")) : [];
    if(real.length) return planFromItems({ tomorrow: !!o.tomorrow, part: o.part || null, mode: o.mode }, real, "From what you told me, here's a draft.");
    return o.mode === "week" ? directWeek() : directDay(o);
  }
  async function doFree(minutes){
    const r = planFree(minutes);
    if(r.empty) return needContext("free", { minutes });
    return planReply(r, `Here's how I'd use your ${hm(minutes)}.`);
  }
  async function doNext(){
    const now = new Date(), key = dk(now), inst = tasks.instancesForDate(key).filter(i => i.status === "pending" || i.status === "active");
    const nowItem = inst.find(i => i.start <= now && i.end > now);
    const upcoming = inst.filter(i => i.start > now).sort((a, b) => a.start - b.start)[0];
    const best = candidates(now)[0];
    const actions = [];
    if(nowItem){
      actions.push({ label: "Start", primary: true, onClick: () => bus.emit("task:start-requested", { taskId: nowItem.taskId, key: nowItem.dateKey }) });
      return { text: `Right now: ${clean(nowItem.title)}, until ${fmt(nowItem.end)}. Start with the first small step.`, state: "FOCUSED", opts: { actions } };
    }
    const gap = upcoming ? Math.floor((upcoming.start - now) / 60000) : null;
    if(best && (gap == null || gap >= 20)){
      const len = gap != null ? Math.min(best.durationMin, gap - 10) : best.durationMin;
      actions.push({ label: "Start now", primary: true, onClick: () => { const t = tasks.get(best.taskId); if(t){ const iso = new Date(Math.ceil((Date.now() + 60000) / 300000) * 300000).toISOString(); tasks.update(t.id, { dueAt: iso }); const back = tasks.get(t.id); if(back && back.dueAt === iso) bus.emit("task:start-requested", { taskId: t.id, key: dk(new Date(iso)) }); else D.app.say("I couldn't confirm that change, so I haven't started it.", "CONFUSED"); } } });
      actions.push({ label: "Plan my day", onClick: () => handleUserLike("plan my day") });
      return { text: `${cap(clean(best.title))}${best.why ? ` (${best.why.toLowerCase()})` : ""} is the best next move${gap != null ? `, and you have ${hm(gap)} before ${clean(upcoming.title)}` : ""}. About ${hm(len)}.`, state: "HAPPY", opts: { actions } };
    }
    if(upcoming) return { text: `Next up: ${clean(upcoming.title)} at ${fmt(upcoming.start)}${gap != null && gap < 20 ? ` — about ${hm(gap)} from now` : ""}. ${gap != null && gap >= 5 ? "Nothing else needs doing before then." : ""}`.trim(), state: "IDLE", opts: { actions: [{ label: "Start early", onClick: () => bus.emit("task:start-requested", { taskId: upcoming.taskId, key: upcoming.dateKey }) }] } };
    return needContext("next");
  }
  async function handleUserLike(t){ return D.app.handleUserUtterance(t); }

  async function doExam(o){
    let subject = o.subject || "";
    const m = o.raw && o.raw.match(/\b(?:for|on)\s+(?:my |the |our )?([a-z][a-z .&-]{2,30}?)\s+(?:exam|test|quiz|midterm|final)/i);
    if(!subject && m && !/^(upcoming|big|next|final|my|the)$/i.test(m[1].trim())) subject = m[1].trim();
    const known = findExam(subject);
    if(known) return examFrom(subject, known.date, known.src === "calendar" ? "I found it on your calendar." : "I found it in your tasks.");
    const dr = D.calIntel && D.calIntel.resolveDate ? D.calIntel.resolveDate(o.raw || "") : { date: null };
    if(dr && dr.date) return examFrom(subject, dr.date, "");
    pending = { type: "examdate", subject };
    return { text: `${subject ? cap(subject) + " it is. " : ""}When is the exam? I'll plan backwards from that day.`, state: "CURIOUS", opts: { choices: { mode: "single", options: ["Tomorrow", "In 3 days", "In a week", "Not sure"], allowCustom: true } } };
  }
  async function examFrom(subject, date, lead){
    const p = await planExam(subject, date);
    if(p.error) return { text: p.error, state: "CURIOUS" };
    return planReply(p, lead ? lead + " Here's a revision draft." : "Here's a revision draft.");
  }

  async function doMoveUnfinished(all){
    const now = new Date(), key = dk(now), tmr = addDays(now, 1), tk = dk(tmr);
    const todays = tasks.instancesForDate(key).filter(i => i.status === "pending" || i.status === "active");
    const rec = todays.filter(i => i.recurring), movable = todays.filter(i => !i.recurring);
    let list = movable.filter(i => i.end <= now), laterLeft = movable.length - list.length;
    if(!list.length && movable.length && !all){
      pending = { type: "confirmMove" };
      return { text: `Nothing has slipped past yet. Move everything still left today (${movable.length} task${movable.length === 1 ? "" : "s"}) to tomorrow?`, state: "CURIOUS", opts: { choices: { mode: "single", options: ["Yes, move them", "No, leave them"], allowCustom: false } } };
    }
    if(all) list = movable;
    if(!list.length) return { text: rec.length ? `Only repeating tasks are left today (${rec.length}); those I leave as they are.` : "You have no unfinished tasks today, so there's nothing to move.", state: "HAPPY" };
    const prev = [], extraBusy = [], moved = [], failed = [];
    for(const i of list){
      const t = tasks.get(i.taskId); if(!t) continue;
      const orig = new Date(t.dueAt); const same = new Date(tmr.getFullYear(), tmr.getMonth(), tmr.getDate(), orig.getHours(), orig.getMinutes());
      const clash = extraBusy.concat(tasks.busyForDate(tk).map(b => ({ s: b.s, e: b.e }))).some(b => same.getTime() < b.e + BUF * 60000 && b.s - BUF * 60000 < same.getTime() + t.durationMin * 60000);
      let start = same;
      if(clash){ const slot = tasks.findSlots({ durationMin: t.durationMin, days: 2, count: 1, notBefore: new Date(tmr.getFullYear(), tmr.getMonth(), tmr.getDate(), 0, 0), extraBusy }); if(!slot.length){ failed.push(t.title); continue; } start = slot[0].start; }
      prev.push({ id: t.id, dueAt: t.dueAt }); const iso = start.toISOString();
      tasks.update(t.id, { dueAt: iso });
      if((tasks.get(t.id) || {}).dueAt === iso){ moved.push({ title: t.title, start }); extraBusy.push({ s: start.getTime(), e: start.getTime() + t.durationMin * 60000 }); } else failed.push(t.title);
    }
    if(!moved.length) return { text: failed.length ? `I couldn't find room tomorrow for ${failed.slice(0, 2).map(clean).join(" or ")}, so I haven't moved anything.` : "I couldn't confirm any change, so nothing was moved.", state: "CONFUSED" };
    const lines = moved.slice(0, 4).map(m => `${clean(m.title)} → ${fmt(m.start)}`).join("; ");
    const undo = () => { prev.forEach(p => tasks.update(p.id, { dueAt: p.dueAt })); const ok = prev.every(p => (tasks.get(p.id) || {}).dueAt === p.dueAt); return ok ? { text: "Put them back where they were.", state: "IDLE" } : { text: "I couldn't confirm that every task went back. Please check your list.", state: "CONFUSED" }; };
    return { text: `Moved ${moved.length} to tomorrow: ${lines}${moved.length > 4 ? "…" : ""}.${failed.length ? ` No room for ${failed.slice(0, 2).map(clean).join(", ")}, so ${failed.length === 1 ? "that one stays" : "those stay"} put.` : ""}${laterLeft > 0 && !all ? ` ${laterLeft} later today ${laterLeft === 1 ? "is" : "are"} untouched.` : ""}`, state: failed.length ? "CONCERNED" : "HAPPY", opts: { actions: [{ label: "Undo", onClick: () => { const r = undo(); D.app.say(r.text, r.state); } }] } };
  }

  function lastTopic(current_){
    const s = memory.getSession(10).filter(m => m.role === "user" && m.text !== current_ && !/\bremind me\b/i.test(m.text) && String(m.text).trim().split(/\s+/).length >= 2);
    return s.length ? String(s[s.length - 1].text).trim().slice(0, 70) : "";
  }
  function whenFrom(w){
    const now = new Date(); let t = new Date(now.getTime() + 2 * 3600000), note = "I took “later” to mean in 2 hours.";
    w = String(w || "").toLowerCase();
    let m;
    if((m = w.match(/in (an?|\d+(?:\.\d+)?) ?(hours?|hrs?|minutes?|mins?)/))){ const n = /^an?$/.test(m[1]) ? 1 : parseFloat(m[1]); t = new Date(now.getTime() + n * (/^h/.test(m[2]) ? 3600000 : 60000)); note = ""; }
    else if(/tonight|this evening/.test(w)){ t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 30); if(t <= now) t = new Date(now.getTime() + 3600000); note = "I took “tonight” to mean 7:30 PM."; }
    t = new Date(Math.ceil(t.getTime() / 300000) * 300000);
    const m2 = minOf(t); const w2 = dayWindow();
    if(m2 >= w2.end || m2 < w2.start){ const base = m2 >= w2.end ? addDays(t, 1) : t; t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(w2.start / 60), w2.start % 60); note = (note ? note + " " : "") + "That falls in your quiet hours, so I set it for the morning."; }
    return { at: t, note };
  }
  function doRemind(o, rawText, title){
    const topic = (o.target ? cap(o.target.trim()) : title || lastTopic(rawText));
    if(!topic){ pending = { type: "remindWhat", when: o.when || "later" }; return { text: "What should I remind you about?", state: "CURIOUS" }; }
    const { at, note } = whenFrom(o.when || rawText);
    const iso = at.toISOString();
    const t = tasks.add({ title: `Reminder: ${topic}`, dueAt: iso, durationMin: 10, priority: "normal", source: "dabsy-reminder", notes: "Created by DABSy from “remind me later”." });
    const back = t && tasks.get(t.id);
    if(!back || back.dueAt !== iso) return { text: "I tried to set that reminder but couldn't confirm it was saved, so please don't rely on it.", state: "CONFUSED" };
    return { text: `Reminder set for ${ui.dayLabel(at).toLowerCase()} at ${fmt(at)}: ${topic}.${note ? " " + note : ""}${notifyNote()}`, state: "HAPPY", opts: { actions: [{ label: "Undo", onClick: () => { tasks.remove(t.id); D.app.say(tasks.get(t.id) ? "I couldn't confirm it was removed. Please check your tasks." : "Reminder removed.", tasks.get(t.id) ? "CONFUSED" : "IDLE"); } }] } };
  }

  /* ---------------- answers to my own questions ---------------- */
  const isNo = t => /^(no|nope|nah|never ?mind|cancel|stop|leave (it|them)|don'?t|not now)\b/i.test(t.trim());
  async function answerPending(text){
    const p = pending; if(!p) return null;
    const t = text.trim();
    if(p.type === "confirmMove"){ pending = null; if(isNo(t)) return { text: "Okay, I've left them where they are.", state: "IDLE" }; if(/^(yes|yeah|yep|sure|ok|okay|do it|go ahead|move)/i.test(t)) return doMoveUnfinished(true); return null; }
    if(p.type === "remindWhat"){ pending = null; if(isNo(t)) return { text: "Okay, no reminder.", state: "IDLE" }; return doRemind({ when: p.when }, "", cap(t.slice(0, 70))); }
    if(p.type === "examdate"){
      if(isNo(t)){ pending = null; return { text: "Okay. Tell me the date whenever you know it and I'll plan from there.", state: "IDLE" }; }
      let date = null;
      const r = D.calIntel && D.calIntel.resolveDate ? D.calIntel.resolveDate(t) : { date: null };
      if(r && r.date) date = r.date;
      else if(/not sure|don'?t know|no idea/i.test(t)) date = dk(addDays(new Date(), 7)), p.assumed = true;
      else if(/in a week|next week|this week/i.test(t)) date = dk(addDays(new Date(), /next/.test(t) ? 7 : 6));
      else if(/in (\d+) days?/i.test(t)) date = dk(addDays(new Date(), Number(t.match(/in (\d+) days?/i)[1])));
      if(!date){ if(r && r.ask) return { text: r.ask, state: "CURIOUS" }; return { text: "I didn't catch the date. Try “Friday”, “25 Oct”, or “in 4 days”.", state: "CURIOUS" }; }
      pending = null;
      const out = await examFrom(p.subject, date, p.assumed ? "Without a date I planned for a week from now — easy to change later." : "");
      return out;
    }
    if(p.type === "dayIntro"){
      const o = p.o || {}; lastIntroAt = Date.now();
      if(/^(just show|show|what'?s on|what is on|my schedule|overview)/i.test(t)){ pending = null; return D.butler && D.butler.overview ? D.butler.overview() : { text: "Nothing to show yet.", state: "IDLE" }; }
      if(/^(draft|plan it|plan now|now|yes|yeah|yep|sure|go|go ahead|do it|ok|okay|please)\b/i.test(t) || /\bdraft it\b/i.test(t)){ pending = null; return o.mode === "week" ? directWeek() : directDay(o); }
      if(/^(sketch|pick)/i.test(t)){ pending = null; return categoryPicker({ tomorrow: !!o.tomorrow, part: o.part || null, mode: o.mode }); }
      if(/add something|something else|add more|add\b/i.test(t)){ pending = null; return needContext(o.mode === "week" ? "week" : "day", { tomorrow: !!o.tomorrow, part: o.part || null }); }
      if(/^(not now|no|nope|nah|later|never ?mind|cancel)\b/i.test(t)){ pending = null; return { text: "No problem. Just say the word when you'd like to plan.", state: "IDLE" }; }
      if(/^(let'?s )?(talk|chat|discuss)\b|talk it through|talk first|talk about/i.test(t)){ return startTalk(null, o); }
      return startTalk(t, o);                               // anything else is simply the student talking about their day
    }
    if(p.type === "dayTalk"){
      if(/^(not now|no|nope|nah|stop|that'?s all|done|enough|never ?mind)\b/i.test(t)) return endTalk(false);
      if(/^(just show|show what|what'?s on)/i.test(t)){ await endTalk(false); return D.butler && D.butler.overview ? D.butler.overview() : null; }
      if(/^(plan (it|my day|the day|this)|plan it now|plan my day from this|ok(ay)?,? plan|yes,? plan|draft (it|a plan)|make (it )?a plan|do it|go ahead|sure,? plan)\b/i.test(t) || /\b(plan|schedule|organi[sz]e|draft)\b.{0,20}\b(it|this|that|my day|the day)\b/i.test(t)) return endTalk(true);
      if(/^keep (talking|chatting)/i.test(t)){ return { text: TALK_Q[Math.min((talk ? talk.n : 0) + 1, TALK_Q.length - 1)], state: "CURIOUS", opts: { choices: { mode: "single", options: ["Plan my day from this", "Not now"], allowCustom: true } } }; }
      if(!talk) talk = { turns: [], n: 0, o: {} };
      return talkTurn(t);
    }
    if(p.type === "cats"){
      if(isNo(t)){ pending = null; return { text: "No problem. Ask me again whenever you're ready.", state: "IDLE" }; }
      const picked = Object.keys(CATS).filter(k => new RegExp("\\b" + k.split(" ")[0].toLowerCase() + "\\b", "i").test(t));
      const rest = t.split(/,/).map(x => x.trim()).filter(x => x && !Object.keys(CATS).some(k => k.toLowerCase() === x.toLowerCase())).join(", ");
      const items = picked.map(k => ({ title: CATS[k].t, durationMin: CATS[k].m, priority: k === "Rest" ? "low" : "normal", subject: "", generic: true })).concat(rest ? await parseItemsSmart(rest) : []);
      if(!items.length) return { text: "I didn't catch anything there. Tap a few, or type them, like “gym 45 min, call mum”.", state: "CURIOUS" };
      pending = null; lastIntroAt = Date.now();
      return planFromItems(p, items, "Here's a draft with what you picked.");
    }
    if(p.type === "ctx"){
      if(isNo(t)){ pending = null; return { text: "No problem. Ask me again whenever you're ready.", state: "IDLE" }; }
      const items = await parseItemsSmart(t);
      if(!items.length) return { text: "I didn't catch any tasks there. Try “maths homework 1 hr, gym 45 min”.", state: "CURIOUS" };
      pending = null; lastIntroAt = Date.now();
      return planFromItems(p, items, "Here's a draft from what you told me.");
    }
    return null;
  }

  /* ---------------- entry point ---------------- */
  async function handle(text){
    const t = String(text || "").trim(); if(!t) return null;
    if(pending){
      const fresh = detect(t);
      if(fresh && fresh.type !== "remind" && !(pending.type === "dayTalk" && (fresh.type === "day" || fresh.type === "week")) && !(pending.type === "dayIntro" && (fresh.type === "day" || fresh.type === "week"))){ pending = null; talk = null; }        // a new, clear request replaces my open question
      else { const r = await answerPending(t); if(r) return r; if(!pending) return null; return null; }
    }
    const it = detect(t); if(!it) return null;
    try{
      switch(it.type){
        case "day": return await doDay(it, t);
        case "week": return await doWeek(t);
        case "talkday": return startTalk(null, {});
        case "free": return await doFree(it.minutes);
        case "next": return await doNext();
        case "exam": return await doExam(it);
        case "moveUnfinished": return await doMoveUnfinished(false);
        case "remind": return doRemind(it, t);
        case "show": return current ? (open(current), { text: "Here's your plan.", state: "IDLE" }) : { text: "I don't have a plan open right now. Say “plan my day” and I'll draft one.", state: "IDLE" };
      }
    }catch(e){ console.error(e); return { text: "I hit a snag while planning, and nothing was changed. Please try again.", state: "CONFUSED" }; }
    return null;
  }

  /* what the language model may know (facts only), so free-form chat answers can refer to the real day */
  function contextLine(){
    try{
      const now = new Date(), key = dk(now);
      const inst = tasks.instancesForDate(key).filter(i => i.status === "pending" || i.status === "active").slice(0, 6).map(i => `${fmt(i.start)} ${clean(i.title)}${i.priority === "high" ? " (high)" : ""}`);
      const un = tasks.unscheduled().slice(0, 5).map(t => clean(t.title));
      return [`Local time now: ${now.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" })}.`,
        inst.length ? `Scheduled today: ${inst.join("; ")}.` : "Nothing is scheduled today.",
        un.length ? `Tasks without a time: ${un.join("; ")}.` : "",
        connected() ? "Calendar: connected." : "Calendar: not connected."].filter(Boolean).join(" ");
    }catch(e){ return ""; }
  }

  D.dayplan = { handle, detect, open: () => open(current), buildPlan: makePlan, schedule, contextLine, hasPending: () => !!pending, inTalk: () => !!talk, current: () => current, _planDay: planDay, _planFree: planFree, _planWeek: planWeek, _planExam: planExam, _parseItems: parseItems, _freeIntervals: freeIntervals };
})();
