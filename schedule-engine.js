/* ============================================================
   D.A.B.S.y — schedule-engine.js
   The butler's brain for time — as seen from the voice/chat flow.

   v7: this is now a thin FACADE over task-engine.js. The public API is
   unchanged (so the conflict-resolution conversation in app.js keeps
   working exactly as before), but every item it creates is a real Task
   object — which means the same item can be followed up on, moved or
   skipped by the notification engine.

     recurring rule  = Task with a `recurrence`
     one-off event   = Task with a `dueAt`

   "Today's schedule" is still computed fresh and never stored.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const tasks = window.DABSy.tasks;
  const ui = window.DABSy.ui;

  // tasks:changed is the single source of truth; relay it under the old name
  bus.on("tasks:changed", () => bus.emit("schedule:changed"));

  function getRules(){
    return tasks.list().filter(t => t.recurrence).map(t => ({
      id: t.id, title: t.title, hour: t.recurrence.hour, minute: t.recurrence.minute,
      days: t.recurrence.days, durationMin: t.durationMin,
    }));
  }
  function getOneOffs(){
    return tasks.list().filter(t => !t.recurrence && t.dueAt).map(t => ({
      id: t.id, title: t.title, startISO: t.dueAt, durationMin: t.durationMin,
    }));
  }

  function addRecurring({ title, hour, minute, days, durationMin = 30, emoji, category }){
    return tasks.add({ title, recurrence: { days, hour, minute }, durationMin, emoji, category, source: "voice" });
  }
  function removeRecurringByTitle(title){ tasks.removeRecurringByTitle(title); }
  function addOneOff({ title, startISO, durationMin = 30, emoji, category, subject }){
    return tasks.add({ title, dueAt: startISO, durationMin, emoji, category, subject, source: "voice" });
  }
  function removeOneOff(id){ tasks.remove(id); }
  function updateOneOff(id, patch){
    const p = {};
    if(patch.startISO) p.dueAt = patch.startISO;
    if(patch.title) p.title = patch.title;
    if(patch.durationMin) p.durationMin = patch.durationMin;
    tasks.update(id, p);
  }

  /* ---------- today's schedule, computed fresh ---------- */
  function getTodaysSchedule(){
    return tasks.instancesForDate(ui.dateKey())
      .filter(i => i.status !== "skipped")
      .map(i => ({
        id: i.taskId, key: i.key, title: i.title, source: i.recurring ? "recurring" : "oneoff",
        start: i.start, durationMin: i.durationMin, status: i.status, emoji: i.emoji,
      }));
  }
  function getNextItem(){
    const now = new Date();
    return getTodaysSchedule().find(item => item.start > now && item.status === "pending") || null;
  }

  /* ---------- conflict detection (deterministic) ---------- */
  function findConflict(candidateStart, candidateDurationMin){
    const candEnd = new Date(candidateStart.getTime() + candidateDurationMin * 60000);
    const day = tasks.instancesForDate(ui.dateKey(candidateStart)).map(i => ({ id: i.taskId, key: i.key, title: i.title, source: i.recurring ? "recurring" : "oneoff", start: i.start, durationMin: i.durationMin, status: i.status, dateKey: i.dateKey }));
    return day.find(item => {
      if(item.status === "done" || item.status === "skipped") return false;
      const itemEnd = new Date(item.start.getTime() + item.durationMin * 60000);
      return candidateStart < itemEnd && item.start < candEnd;
    }) || null;
  }

  /* ---------- resolving a conflict once the user answers ---------- */
  // action: "move_existing" | "cancel_existing" | "keep_both" | "cancel_new"
  function resolveConflict(action, conflictItem, candidate){
    if(action === "cancel_existing"){
      if(conflictItem.source === "oneoff") removeOneOff(conflictItem.id);
      else tasks.skip(conflictItem.id, conflictItem.dateKey || ui.dateKey(conflictItem.start)); // skip just today's occurrence, not the whole habit
    }
    if(action === "move_existing"){
      const newStart = new Date(conflictItem.start.getTime() + 45 * 60000);
      tasks.move(conflictItem.id, conflictItem.dateKey || ui.dateKey(conflictItem.start), newStart); // now works for recurring items too
    }
    if(action === "cancel_new") return;
    addOneOff({ title: candidate.title, startISO: candidate.start.toISOString(), durationMin: candidate.durationMin });
  }

  window.DABSy.schedule = {
    getRules, getOneOffs, addRecurring, removeRecurringByTitle,
    addOneOff, removeOneOff, updateOneOff,
    getTodaysSchedule, getNextItem, findConflict, resolveConflict,
  };
})();
