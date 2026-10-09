/* ============================================================
   D.A.B.S.y — notify-engine.js
   The notification engine. Not "Reminder: Complete Chemistry" —
   contextual, staged follow-ups that adapt when you ignore them.

   Stages for a task occurrence
     due     (at its start time)     Start / Move / Skip
     missed  (10 min after it ended) Reschedule / Skip
     slipping (recurring, 3+ misses) Find a slot / Keep it
   Tasks with no time yet            Find a slot / Later  (at most once a day)

   Guard rails: quiet hours, a daily budget, no toasts while you are
   mid-study, and back-off — ignore a task's nudges twice and the gap
   doubles, ignore it three times and DABSy leaves it alone until tomorrow.

   Delivery
     1. Every notification lands in the in-app inbox (the glass
        notification centre, notification-center.js).
     2. Foreground -> a swipe-away glass toast with the same actions.
     3. Background -> a real system notification via the service
        worker, ONLY if the user allowed it. Honest limit: a PWA with no
        push server can notify while it is alive in the background, not
        wake itself from a fully closed state (see docs/INTEGRATION.md).
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const ui = window.DABSy.ui;
  const tasks = window.DABSy.tasks;
  const SKEY = "notify_settings_v1", LKEY = "notify_ledger_v1", IKEY = "notify_inbox_v1";
  const dk = ui.dateKey;

  const DEFAULTS = () => ({
    enabled: true, system: false,
    quiet: { from: window.DABSy.config.notifications.quietFrom, to: window.DABSy.config.notifications.quietTo },
    dailyLimit: window.DABSy.config.notifications.dailyLimit,
  });
  const settings = () => Object.assign(DEFAULTS(), memory.read(SKEY, {}));
  function saveSettings(p){ const n = Object.assign(settings(), p); memory.write(SKEY, n); bus.emit("notify:settings", n); return n; }

  function ledger(){
    let l = memory.read(LKEY, null);
    if(!l || l.day !== dk()) l = { day: dk(), sent: 0, stages: l && l.stages ? pruneStages(l.stages) : {}, lastNonurgent: l && l.lastNonurgent || "", lastAt: 0 };
    return l;
  }
  function pruneStages(st){ const out = {}; Object.keys(st).forEach(k => { if(st[k].day >= dk(new Date(Date.now() - 2 * 864e5))) out[k] = st[k]; }); return out; }
  const saveLedger = l => memory.write(LKEY, l);

  /* ---------------- inbox ---------------- */
  function inbox(){ return memory.read(IKEY, []); }
  function saveInbox(l){ memory.write(IKEY, l.slice(-40)); bus.emit("notify:inbox"); }
  const unread = () => inbox().filter(n => n.status === "new").length;
  function find(id){ return inbox().find(n => n.id === id) || null; }
  function setStatus(id, status){ const l = inbox(); const n = l.find(x => x.id === id); if(n){ n.status = status; saveInbox(l); } }
  function markAllSeen(){ const l = inbox(); l.forEach(n => { if(n.status === "new") n.status = "seen"; }); saveInbox(l); }
  function dismiss(id){ saveInbox(inbox().filter(n => n.id !== id)); }
  function clearAll(){ saveInbox([]); }

  /* ---------------- quiet hours ---------------- */
  function toMin(s){ const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + (m || 0); }
  function inQuietHours(d){
    d = d || new Date(); const s = settings().quiet;
    const m = d.getHours() * 60 + d.getMinutes(), a = toMin(s.from), b = toMin(s.to);
    return a === b ? false : (a < b ? (m >= a && m < b) : (m >= a || m < b));
  }

  /* ---------------- delivery ---------------- */
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // push({ kind, title, body, actions:[{id,label}], taskId, key, stage, countBudget, silent })
  function push(n){
    const rec = {
      id: ui.uid("n"), ts: Date.now(), status: "new",
      kind: n.kind || "info", title: n.title || "DABSy", body: n.body || "",
      actions: n.actions || [], taskId: n.taskId || null, key: n.key || null, stage: n.stage || null,
    };
    const l = inbox(); l.push(rec); saveInbox(l);
    if(n.countBudget){ const lg = ledger(); lg.sent++; lg.lastAt = Date.now(); saveLedger(lg); }

    const quietCtx = window.DABSy.context.isQuiet();
    if(document.visibilityState === "visible"){
      window.DABSy.director.dispatch("NOTIF_ARRIVED");
      if(!quietCtx && !n.silent) showToast(rec);
    } else if(settings().system && "Notification" in window && Notification.permission === "granted"){
      showSystem(rec);
    }
    bus.emit("notify:new", rec);
    return rec;
  }

  function showToast(rec){
    let acted = false;
    ui.toast({
      title: rec.title, text: rec.body, timeout: 14000,
      actions: rec.actions.slice(0, 3).map((a, i) => ({ label: a.label, primary: i === 0, onClick: () => { acted = true; act(rec.id, a.id); } })),
      onDismiss: () => { if(!acted && rec.taskId) markIgnored(rec); },
    });
  }
  async function showSystem(rec){
    try{
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(rec.title, {
        body: rec.body, tag: rec.taskId ? "task-" + rec.taskId : rec.id, renotify: false, icon: "./icon-192.png", badge: "./icon-192.png",
        data: { id: rec.id }, actions: rec.actions.slice(0, 2).map(a => ({ action: a.id, title: a.label })),
      });
    }catch(e){ console.warn("system notification failed", e); }
  }

  function markIgnored(rec){
    const t = tasks.get(rec.taskId); if(!t) return;
    t.nag.ignored = (t.nag.ignored || 0) + 1;
    if(t.nag.ignored >= 3){
      const tm = new Date(); tm.setDate(tm.getDate() + 1); tm.setHours(7, 0, 0, 0);
      t.nag.snoozedUntil = tm.getTime();
      tasks.update(t.id, { nag: t.nag });
      const l = inbox(); l.push({ id: ui.uid("n"), ts: Date.now(), status: "seen", kind: "info", title: "I'll leave it alone", body: `I'll stop nudging you about "${t.title}" until tomorrow.`, actions: [] }); saveInbox(l);
    } else tasks.update(t.id, { nag: t.nag });
  }

  /* ---------------- actions ---------------- */
  async function act(id, actionId){
    const rec = find(id); if(!rec) return;
    setStatus(id, "acted");
    const t = rec.taskId ? tasks.get(rec.taskId) : null;
    if(actionId === "start" && t){
      tasks.start(t.id, rec.key || dk());
      bus.emit("task:start-requested", { taskId: t.id, key: rec.key || dk() });
      window.DABSy.director.dispatch("SUCCESS_MOMENT", { speakText: `Starting ${t.title}. I'll stay quiet.` });
    } else if((actionId === "move" || actionId === "reschedule" || actionId === "slot") && t){
      await rescheduleFlow(t.id, rec.key);
    } else if(actionId === "skip" && t){
      tasks.skip(t.id, rec.key || dk());
      window.DABSy.director.dispatch("DABSY_REPLY", { speakText: `Skipped ${t.title}. No stress.` });
    } else if(actionId === "later" && t){
      t.nag.snoozedUntil = Date.now() + 3 * 3600e3; tasks.update(t.id, { nag: t.nag });
    } else if(actionId === "keep" && t){
      t.nag.ignored = 0; tasks.update(t.id, { nag: t.nag });
    } else if(actionId === "open"){
      bus.emit("notify:open-item", rec);
    }
    bus.emit("notify:acted", { id, actionId });
  }

  // Real free-slot search -> choose one -> actually move the task.
  async function rescheduleFlow(taskId, key){
    const t = tasks.get(taskId); if(!t) return false;
    key = key || dk();
    const slots = tasks.findSlots({ durationMin: t.durationMin, days: 3, count: 3, excludeKey: t.id + "@" + key });
    if(!slots.length){
      await ui.popup({ title: "No free slot found", text: "Your next few days look full. I can try again after you clear something.", actions: [{ label: "OK", value: true, kind: "primary" }] });
      return false;
    }
    const choice = await ui.popup({
      title: `When should "${t.title}" happen?`,
      text: "These times are free in your schedule" + (window.DABSyCore && window.DABSyCore.isCalendarConnected && window.DABSyCore.isCalendarConnected() ? " and Ghibli Calendar." : "."),
      actions: slots.map((s, i) => ({ label: s.label, value: i, kind: i === 0 ? "primary" : "ghost" })).concat([{ label: "Not now", value: "no", kind: "ghost" }]),
      dismissValue: "no",
    });
    if(choice === "no" || choice == null) return false;
    const s = slots[choice];
    if(t.recurrence || t.dueAt) tasks.move(t.id, key, s.start); else tasks.update(t.id, { dueAt: s.start.toISOString() });
    window.DABSy.director.dispatch("SUCCESS_MOMENT", { speakText: `Moved to ${s.label}.` });
    return true;
  }

  /* ---------------- copy ---------------- */
  function nameOf(t){ return t.title.length > 40 ? t.title.slice(0, 38) + "…" : t.title; }
  const COPY = {
    due: t => ({ title: nameOf(t), body: pick([`It's about time. Want to start?`, `Ready when you are.`, `This one's up now. Start, or shall I move it?`]),
      actions: [{ id: "start", label: "Start" }, { id: "move", label: "Move" }, { id: "skip", label: "Skip" }] }),
    missed: t => ({ title: nameOf(t), body: pick([`That slipped past. Want to find a new slot?`, `Looks like this didn't happen. Reschedule or skip?`]),
      actions: [{ id: "reschedule", label: "Reschedule" }, { id: "skip", label: "Skip" }] }),
    slipping: t => ({ title: nameOf(t), body: `This keeps slipping around this time. Want to try a different slot?`,
      actions: [{ id: "slot", label: "Find a slot" }, { id: "keep", label: "Keep it" }] }),
    nonurgent: t => ({ title: nameOf(t), body: `This doesn't have a time yet. Want me to find one?`,
      actions: [{ id: "slot", label: "Find a slot" }, { id: "later", label: "Later" }] }),
  };

  /* ---------------- the tick ---------------- */
  function gapFor(t){ return (t.nag.ignored || 0) >= 2 ? 90 * 60000 : 20 * 60000; }

  function tick(){
    const s = settings(); if(!s.enabled) return;
    const now = new Date(), lg = ledger();
    const quiet = inQuietHours(now);
    let sentNow = 0;

    const canSend = (t, hard) => {
      if(quiet || lg.sent >= s.dailyLimit + (hard ? 2 : 0)) return false;
      if(t && t.nag.snoozedUntil && t.nag.snoozedUntil > Date.now()) return false;
      if(t && t.nag.lastAt && Date.now() - t.nag.lastAt < gapFor(t)) return false;
      return true;
    };
    const send = (t, inst, stage, copyFn) => {
      const c = copyFn(t);
      lg.stages[inst.key] = { stage, day: dk(), at: Date.now() };
      t.nag.lastAt = Date.now(); tasks.update(t.id, { nag: t.nag });
      lg.sent++; lg.lastAt = Date.now(); saveLedger(lg);
      push(Object.assign({ kind: "task", taskId: t.id, key: inst.dateKey, stage }, c));
      sentNow++;
    };

    tasks.instancesForDate(dk(now)).forEach(inst => {
      if(sentNow >= 1 || inst.status !== "pending") return;
      const t = tasks.get(inst.taskId); if(!t) return;
      const prev = (lg.stages[inst.key] || {}).stage || "";
      const toStart = inst.start - now, sinceEnd = now - inst.end;
      if(toStart <= 2 * 60000 && sinceEnd < 0 && !prev){
        if(canSend(t, t.priority === "high")) send(t, inst, "due", COPY.due);
      } else if(sinceEnd > 10 * 60000 && sinceEnd < 4 * 3600e3 && prev !== "missed"){
        if(canSend(t)){
          const slip = tasks.recentSlips(t, 7) >= 3;
          send(t, inst, "missed", slip ? COPY.slipping : COPY.missed);
          if(!t.recurrence || true) tasks.markMissed(t.id, inst.dateKey);
        }
      }
    });

    // one gentle nudge a day for tasks that still have no time
    if(!sentNow && !quiet && lg.lastNonurgent !== dk() && now.getHours() >= 10 && now.getHours() < 19 && lg.sent < s.dailyLimit - 1 && Date.now() - lg.lastAt > 2 * 3600e3){
      const cand = tasks.unscheduled().filter(t => !(t.nag.snoozedUntil > Date.now())).sort((a, b) => tasks.urgency(b) - tasks.urgency(a))[0];
      if(cand && tasks.urgency(cand) >= 1){
        lg.lastNonurgent = dk(); saveLedger(lg);
        const c = COPY.nonurgent(cand);
        cand.nag.lastAt = Date.now(); tasks.update(cand.id, { nag: cand.nag });
        push(Object.assign({ kind: "task", taskId: cand.id, key: dk(), stage: "nonurgent", countBudget: true }, c));
      }
    }
  }

  // a light heartbeat; also fires when the app returns to the foreground
  setInterval(() => { if(document.visibilityState === "visible" || settings().system) tick(); }, 30000);
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible"){ setTimeout(tick, 1500); } });

  /* ---------------- system permission (just in time) ---------------- */
  async function enableSystem(reason){
    const r = await window.DABSy.permissions.ensure("notifications", { reason: reason || "I'd like to nudge you when a task is due, even when DABSy is in the background. I'll keep it gentle." , force: true });
    saveSettings({ system: !!r.granted });
    return r.granted;
  }

  // Service worker -> page (notification button taps)
  if("serviceWorker" in navigator){
    navigator.serviceWorker.addEventListener("message", e => {
      const d = e.data || {};
      if(d.type === "dabsy-notif-action"){ if(d.action) act(d.id, d.action); else bus.emit("notify:open-center"); }
      if(d.type === "dabsy-notif-close"){ const r = find(d.id); if(r && r.status === "new") markIgnored(r); }
    });
  }

  // lightweight in-flow note (e.g. from a study session): inbox + quiet toast, no budget
  function ping(n){ return push(Object.assign({ kind: "ping" }, n)); }

  window.DABSy.notify = {
    settings, saveSettings, inbox, unread, find, markAllSeen, dismiss, clearAll, push, ping, act,
    rescheduleFlow, enableSystem, tick, inQuietHours,
  };
})();
