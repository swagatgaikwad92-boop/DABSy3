/* ============================================================
   D.A.B.S.y — schedule-engine.js
   The butler's brain for time. Two lists, kept deliberately
   separate so "stop reminding me about X" stays reliable:

     recurringRules  — { id, title, hour, minute, days[0-6], durationMin }
     oneOffEvents    — { id, title, startISO, durationMin }

   "Today's schedule" is always computed fresh (recurring rules
   expanded for today + one-offs whose date is today), never
   stored as its own persisted list — so it can't drift out of
   sync with the rules that generate it.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const NS = "dabsy_";
  const KEY_RULES = NS + "recurring_rules";
  const KEY_ONEOFF = NS + "oneoff_events";

  function read(key, fallback){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch(e){ return fallback; }
  }
  function write(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }

  function getRules(){ return read(KEY_RULES, []); }
  function getOneOffs(){ return read(KEY_ONEOFF, []); }

  function addRecurring({title, hour, minute, days, durationMin=30}){
    const rules = getRules();
    const rule = { id: "r"+Date.now(), title, hour, minute, days, durationMin };
    rules.push(rule);
    write(KEY_RULES, rules);
    bus.emit("schedule:changed");
    return rule;
  }

  function removeRecurringByTitle(title){
    const rules = getRules().filter(r => !titleMatches(r.title, title));
    write(KEY_RULES, rules);
    bus.emit("schedule:changed");
  }

  function addOneOff({title, startISO, durationMin=30}){
    const list = getOneOffs();
    const ev = { id: "o"+Date.now(), title, startISO, durationMin };
    list.push(ev);
    write(KEY_ONEOFF, list);
    bus.emit("schedule:changed");
    return ev;
  }

  function removeOneOff(id){
    write(KEY_ONEOFF, getOneOffs().filter(e=>e.id!==id));
    bus.emit("schedule:changed");
  }

  function updateOneOff(id, patch){
    const list = getOneOffs();
    const ev = list.find(e=>e.id===id);
    if(ev) Object.assign(ev, patch);
    write(KEY_ONEOFF, list);
    bus.emit("schedule:changed");
  }

  function titleMatches(a, b){
    return a.trim().toLowerCase() === b.trim().toLowerCase()
        || a.trim().toLowerCase().includes(b.trim().toLowerCase());
  }

  /* ---------- today's schedule, computed fresh ---------- */
  function todayAt(hour, minute){
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  function getTodaysSchedule(){
    const now = new Date();
    const dow = now.getDay(); // 0=Sun
    const rules = getRules();
    const fromRules = rules
      .filter(r => r.days.includes(dow))
      .map(r => ({
        id: r.id, title: r.title, source: "recurring",
        start: todayAt(r.hour, r.minute), durationMin: r.durationMin
      }));

    const todayStr = now.toDateString();
    const fromOneOff = getOneOffs()
      .filter(e => new Date(e.startISO).toDateString() === todayStr)
      .map(e => ({
        id: e.id, title: e.title, source: "oneoff",
        start: new Date(e.startISO), durationMin: e.durationMin
      }));

    return [...fromRules, ...fromOneOff].sort((a,b)=>a.start-b.start);
  }

  function getNextItem(){
    const now = new Date();
    return getTodaysSchedule().find(item => item.start > now) || null;
  }

  /* ---------- conflict detection (deterministic) ---------- */
  function findConflict(candidateStart, candidateDurationMin){
    const candEnd = new Date(candidateStart.getTime() + candidateDurationMin*60000);
    return getTodaysSchedule().find(item => {
      const itemEnd = new Date(item.start.getTime() + item.durationMin*60000);
      return candidateStart < itemEnd && item.start < candEnd;
    }) || null;
  }

  /* ---------- resolving a conflict once the user answers ---------- */
  // action: "move_existing" | "cancel_existing" | "keep_both" | "cancel_new"
  function resolveConflict(action, conflictItem, candidate){
    if(action === "cancel_existing"){
      if(conflictItem.source === "oneoff") removeOneOff(conflictItem.id);
      else removeRecurringByTitle(conflictItem.title); // today only isn't tracked separately; simplest reliable behaviour
    }
    if(action === "move_existing"){
      // push the existing one-off 45 min later; recurring rules are left as-is (ask again if still conflicting)
      if(conflictItem.source === "oneoff"){
        const newStart = new Date(conflictItem.start.getTime() + 45*60000);
        updateOneOff(conflictItem.id, { startISO: newStart.toISOString() });
      }
    }
    if(action === "cancel_new"){
      return; // candidate simply isn't added
    }
    // keep_both or move_existing or cancel_existing all fall through to adding the candidate
    if(action !== "cancel_new"){
      addOneOff({ title: candidate.title, startISO: candidate.start.toISOString(), durationMin: candidate.durationMin });
    }
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.schedule = {
    getRules, getOneOffs, addRecurring, removeRecurringByTitle,
    addOneOff, removeOneOff, updateOneOff,
    getTodaysSchedule, getNextItem, findConflict, resolveConflict,
  };
})();
