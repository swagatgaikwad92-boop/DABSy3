/* ============================================================
   D.A.B.S.y — task-engine.js
   Tasks are ongoing objects, not one-shot reminders.

   Task {
     id, title, subject, project, priority: low|normal|high,
     status: pending|active|done|skipped|paused|cancelled,
     dueAt     : ISO start time (null = "needs a slot")
     deadline  : ISO hard deadline (optional)
     durationMin,
     recurrence: { days:[0-6], hour, minute } | null,
     occurrences: { "YYYY-MM-DD": { status, movedTo?, startedAt?, doneAt? } },
     reschedule : { count, history:[{from,to,at}] },
     nag        : { ignored, snoozedUntil, lastAt }   // used by notify-engine
     sessionId  : a prepared study session this task starts (optional)
     emoji, category, notes, source, createdAt, updatedAt
   }

   A recurring task is ONE object whose per-day outcomes live in
   `occurrences`, so "Chemistry keeps slipping" is something DABSy can
   actually see and adapt to.

   "Instances" are what actually happens on a given day: one-off tasks
   whose dueAt falls on that day, plus recurring tasks expanded for it.
   They are computed fresh and never stored, so they can't drift out of
   sync with the tasks that generate them.

   Also here: findSlots() — a real free-time search over tasks and (when
   connected) Ghibli Calendar events — used by every "Move", "Reschedule"
   and "Find a slot" action.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const ui = window.DABSy.ui;
  const KEY = "tasks_v2";
  const MIGRATED = "tasks_migrated_v2";

  let cache = null;
  function load(){ if(!cache) cache = memory.read(KEY, []); return cache; }
  function save(){ memory.write(KEY, cache || []); bus.emit("tasks:changed"); }
  window.addEventListener("storage", e => { if(e.key === "dabsy_" + KEY){ cache = null; bus.emit("tasks:changed"); } });

  const dk = ui.dateKey;
  function atKey(key, h, m){ const d = new Date(key + "T00:00:00"); d.setHours(h, m, 0, 0); return d; }
  function toMin(hhmm){ const [h, m] = (hhmm || "00:00").split(":").map(Number); return h * 60 + m; }

  /* ---------------- CRUD ---------------- */
  function make(p){
    const now = Date.now();
    return {
      id: p.id || ui.uid("t"),
      title: String(p.title || "Untitled").trim(),
      subject: p.subject || "", project: p.project || "",
      priority: ["low","normal","high"].includes(p.priority) ? p.priority : "normal",
      status: p.status || "pending",
      dueAt: p.dueAt || null, deadline: p.deadline || null,
      durationMin: Math.max(5, Number(p.durationMin) || 30),
      recurrence: p.recurrence || null,
      occurrences: p.occurrences || {},
      reschedule: p.reschedule || { count: 0, history: [] },
      nag: p.nag || { ignored: 0, snoozedUntil: 0, lastAt: 0 },
      sessionId: p.sessionId || null,
      emoji: p.emoji || null, category: p.category || null,
      notes: p.notes || "", source: p.source || "manual",
      createdAt: p.createdAt || now, updatedAt: now,
    };
  }
  function list(){ return load().slice(); }
  function get(id){ return load().find(t => t.id === id) || null; }
  function add(p){
    const t = make(p);
    load().push(t); save();
    return t;
  }
  function update(id, patch){
    const t = get(id); if(!t) return null;
    Object.assign(t, patch, { updatedAt: Date.now() });
    save(); return t;
  }
  function remove(id){
    cache = load().filter(t => t.id !== id); save();
  }
  function removeRecurringByTitle(title){
    const q = String(title || "").trim().toLowerCase(); if(!q) return;
    cache = load().filter(t => !(t.recurrence && (t.title.toLowerCase() === q || t.title.toLowerCase().includes(q)))); save();
  }

  /* ---------------- instances ---------------- */
  function occOf(t, key){ return t.occurrences[key] || null; }

  function instancesForDate(key){
    const out = [];
    const day = new Date(key + "T00:00:00").getDay();
    load().forEach(t => {
      if(t.status === "cancelled" || t.status === "paused") return;
      if(t.recurrence){
        const origins = new Set();
        if(t.recurrence.days.includes(day)) origins.add(key);
        Object.keys(t.occurrences).forEach(k => { if(t.occurrences[k].movedTo) origins.add(k); });
        origins.forEach(k => {
          const occ = occOf(t, k) || {};
          const start = occ.movedTo ? new Date(occ.movedTo) : atKey(k, t.recurrence.hour, t.recurrence.minute);
          if(dk(start) !== key) return;
          // a rule created at 8pm must not instantly report this morning's 7am as "missed"
          if(!occ.movedTo && k === dk(new Date(t.createdAt)) && start.getTime() < t.createdAt - 5 * 60000) return;
          if(!occ.movedTo && k < dk(new Date(t.createdAt))) return;
          out.push(inst(t, k, start, occ.status || "pending", true));
        });
      } else if(t.dueAt){
        const start = new Date(t.dueAt);
        if(dk(start) === key) out.push(inst(t, key, start, t.status, false));
      }
    });
    return out.sort((a, b) => a.start - b.start);
  }
  function inst(t, originKey, start, status, recurring){
    return {
      key: t.id + "@" + originKey, taskId: t.id, dateKey: originKey,
      title: t.title, subject: t.subject, emoji: t.emoji, category: t.category,
      priority: t.priority, start, end: new Date(start.getTime() + t.durationMin * 60000),
      durationMin: t.durationMin, status, recurring,
    };
  }
  function findInstance(taskId, key){
    return instancesForDate(key).find(i => i.taskId === taskId) || null;
  }

  function isOverdue(i, now){ return (i.status === "pending") && i.end.getTime() < (now || new Date()).getTime(); }

  function nextInstance(now){
    now = now || new Date();
    for(let d = 0; d < 8; d++){
      const day = new Date(now.getTime() + d * 864e5);
      const hit = instancesForDate(dk(day)).find(i => i.status === "pending" && i.start > now);
      if(hit) return hit;
    }
    return null;
  }

  /* tasks with no time yet ("needs a slot") */
  function unscheduled(){
    return load().filter(t => !t.recurrence && !t.dueAt && (t.status === "pending" || t.status === "active"));
  }

  /* ---------------- outcomes ---------------- */
  function setOutcome(taskId, key, status, extra){
    const t = get(taskId); if(!t) return null;
    if(t.recurrence){
      t.occurrences[key] = Object.assign({}, t.occurrences[key] || {}, { status }, extra || {});
      // keep the ledger from growing forever
      const keys = Object.keys(t.occurrences).sort();
      while(keys.length > 60) delete t.occurrences[keys.shift()];
    } else {
      t.status = status; Object.assign(t, extra || {});
    }
    t.updatedAt = Date.now(); save();
    return t;
  }
  function complete(taskId, key){
    key = key || dk();
    setOutcome(taskId, key, "done", { doneAt: Date.now() });
    const t = get(taskId); if(t){ t.nag.ignored = 0; save(); }
    bus.emit("tasks:completed", { taskId, key });
  }
  function skip(taskId, key){
    setOutcome(taskId, key, "skipped", { skippedAt: Date.now() });
    bus.emit("tasks:skipped", { taskId, key });
  }
  function start(taskId, key){
    setOutcome(taskId, key || dk(), "active", { startedAt: Date.now() });
    bus.emit("tasks:started", { taskId, key: key || dk() });
  }
  function markMissed(taskId, key){ setOutcome(taskId, key, "missed", { missedAt: Date.now() }); }
  function reopen(taskId, key){ setOutcome(taskId, key || dk(), "pending", {}); }

  // Move one occurrence (or a one-off task) to a new start time.
  function move(taskId, key, newStart){
    const t = get(taskId); if(!t) return null;
    const from = t.recurrence
      ? ((t.occurrences[key] && t.occurrences[key].movedTo) || atKey(key, t.recurrence.hour, t.recurrence.minute).toISOString())
      : t.dueAt;
    const to = new Date(newStart).toISOString();
    if(t.recurrence){
      t.occurrences[key] = Object.assign({}, t.occurrences[key] || {}, { status: "pending", movedTo: to });
    } else {
      t.dueAt = to; t.status = "pending";
    }
    t.reschedule.count++;
    t.reschedule.history.push({ from, to, at: Date.now() });
    if(t.reschedule.history.length > 10) t.reschedule.history.shift();
    t.nag.ignored = 0;
    t.updatedAt = Date.now(); save();
    bus.emit("tasks:moved", { taskId, key, to });
    return t;
  }

  /* ---------------- reasoning helpers ---------------- */
  // Higher = more pressing. Used to decide WHICH pending task DABSy raises first.
  function urgency(t, now){
    now = now || new Date();
    let s = { low: 0, normal: 1, high: 2 }[t.priority] || 1;
    const when = t.deadline || t.dueAt;
    if(when){
      const h = (new Date(when) - now) / 36e5;
      if(h < 0) s += 3; else if(h < 24) s += 2; else if(h < 72) s += 1;
    }
    s += Math.min(2, t.reschedule.count * 0.4);
    return s;
  }

  // How often has this recurring task slipped lately?
  function recentSlips(t, days){
    if(!t.recurrence) return 0;
    const cutoff = dk(new Date(Date.now() - (days || 7) * 864e5));
    return Object.keys(t.occurrences).filter(k => k >= cutoff && (t.occurrences[k].status === "missed" || t.occurrences[k].status === "skipped")).length;
  }

  /* ---------------- free-time search ---------------- */
  function busyForDate(key, excludeKey){
    const busy = instancesForDate(key)
      .filter(i => i.key !== excludeKey && i.status !== "skipped" && i.status !== "missed" && i.status !== "done")
      .map(i => ({ s: i.start.getTime(), e: i.end.getTime(), title: i.title, src: "task", key: i.key }));
    const Core = window.DABSyCore;
    if(Core && Core.isCalendarConnected && Core.isCalendarConnected()){
      Core.getEventsForDate(key).forEach(ev => {
        if(!ev.startTime) return;
        const s = atKey(key, ...ev.startTime.split(":").map(Number)).getTime();
        const e = ev.endTime ? atKey(key, ...ev.endTime.split(":").map(Number)).getTime() : s + 30 * 60000;
        busy.push({ s, e, title: ev.title, src: "calendar" });
      });
    }
    return busy;
  }

  function conflictsFor(start, durationMin, excludeKey){
    const s = start.getTime(), e = s + durationMin * 60000;
    return busyForDate(dk(start), excludeKey).filter(b => s < b.e && b.s < e);
  }

  function dayWindow(){
    const cfg = memory.read("notify_settings_v1", null);
    const from = (cfg && cfg.quiet && cfg.quiet.from) || window.DABSy.config.notifications.quietFrom;
    const to = (cfg && cfg.quiet && cfg.quiet.to) || window.DABSy.config.notifications.quietTo;
    // working window = the hours that are NOT quiet hours, clamped to something sensible
    return { startMin: Math.max(toMin(to), 6 * 60), endMin: Math.min(toMin(from), 22 * 60) };
  }

  // findSlots({ durationMin, days=2, count=3, bufferMin=10, excludeKey, notBefore, extraBusy:[{s,e}] })
  function findSlots(o){
    o = o || {};
    const dur = o.durationMin || 30, buffer = o.bufferMin == null ? 10 : o.bufferMin;
    const count = o.count || 3, days = o.days || 2;
    const win = dayWindow();
    const now = o.notBefore ? new Date(o.notBefore) : new Date();
    const picks = [];
    for(let d = 0; d < days && picks.length < count; d++){
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      const key = dk(day);
      const busy = busyForDate(key, o.excludeKey).concat(o.extraBusy || []);
      let cursor = win.startMin;
      if(d === 0){
        const nm = now.getHours() * 60 + now.getMinutes() + 10;
        cursor = Math.max(cursor, Math.ceil(nm / 5) * 5);
      }
      let lastPick = -1e9;
      for(let m = cursor; m + dur <= win.endMin && picks.length < count; m += 5){
        const s = atKey(key, Math.floor(m / 60), m % 60).getTime();
        const e = s + dur * 60000;
        const clash = busy.some(b => s < b.e + buffer * 60000 && b.s - buffer * 60000 < e);
        if(clash) continue;
        // spread the suggestions out instead of offering three back-to-back minutes
        if(m - lastPick < 90 && picks.length) continue;
        lastPick = m;
        const st = new Date(s);
        picks.push({ start: st, end: new Date(e), label: `${ui.dayLabel(st)} · ${ui.fmtTime(st)}` });
      }
    }
    return picks;
  }

  /* ---------------- v6 -> v7 migration (runs once, keeps old keys as backup) ---------------- */
  function migrate(){
    if(memory.read(MIGRATED, false)) return;
    const out = load();
    const now = Date.now();
    try{
      memory.read("recurring_rules", []).forEach(r => {
        const ts = Number(String(r.id || "").slice(1)) || now;
        out.push(make({ title: r.title, recurrence: { days: r.days || [0,1,2,3,4,5,6], hour: r.hour, minute: r.minute }, durationMin: r.durationMin || 30, source: "migrated", createdAt: ts }));
      });
      memory.read("oneoff_events", []).forEach(e => {
        const past = new Date(e.startISO).getTime() + (e.durationMin || 30) * 60000 < now;
        out.push(make({ title: e.title, dueAt: e.startISO, durationMin: e.durationMin || 30, status: past ? "done" : "pending", source: "migrated" }));
      });
      memory.getTasks().forEach(t => {
        out.push(make({ title: t.text, status: t.done ? "done" : "pending", source: "migrated" }));
      });
    }catch(e){ console.warn("task migration skipped", e); }
    cache = out;
    memory.write(MIGRATED, true);
    save();
  }
  migrate();

  window.DABSy.tasks = {
    list, get, add, update, remove, removeRecurringByTitle,
    instancesForDate, findInstance, isOverdue, nextInstance, unscheduled,
    complete, skip, start, reopen, move, markMissed, setOutcome,
    urgency, recentSlips, findSlots, conflictsFor, busyForDate,
  };
})();
