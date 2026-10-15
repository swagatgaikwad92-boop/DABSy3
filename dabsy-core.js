/* ============================================================
   DABSy Core — dabsy-core.js
   Shared synchronization layer between DABSy and Ghibli Calendar.

   Load this SAME file in both apps. It works because both apps are
   hosted under the same GitHub Pages origin (username.github.io) —
   localStorage, BroadcastChannel and the "storage" event are all
   scoped to ORIGIN, not to the folder path, so they're already
   shared between /DABSy3/ and /Ghibli-Calander/ with zero backend.

   IMPORTANT — no second calendar data store:
   Calendar events keep living exactly where Ghibli Calendar already
   keeps them: localStorage key "ghibliforest_v1", inside its
   `events` array, in Ghibli's existing {id,title,date,startTime,
   endTime,category,notes,repeat} shape (this file only adds
   `source`, `createdAt`, `updatedAt` to that shape). Core does not
   keep a competing copy of that data anywhere.

     - When this file runs INSIDE Ghibli Calendar's page, `window.LF`
       already exists, so every read/write here goes straight through
       LF's own real functions (LF.addEvent, LF.updateEvent,
       LF.removeItem, LF.state) — never a parallel implementation.
     - When this file runs INSIDE DABSy, `window.LF` doesn't exist on
       that page, so Core reads/writes the same localStorage key
       directly, using the identical record shape, so whatever it
       writes is exactly what Ghibli will load next time it's opened.

   Connection state (which ecosystem apps DABSy is allowed to talk
   to, and at what permission level) lives in its own small key,
   "dabsy_core_connections_v1" — that's ecosystem metadata, not
   calendar data, so it's kept separate on purpose.

   Browser-origin limitation (read this before assuming more than it
   promises): everything above only holds together because both apps
   stay under the SAME github.io username. If either app is ever
   moved to a different account or a custom domain, they stop sharing
   an origin and this entire file stops working silently — at that
   point a real backend (small API + database) would be required to
   bridge them. As currently deployed (DABSy3 + Ghibli-Calander under
   swagatgaikwad92-boop.github.io) they ARE same-origin, so this
   works for real, not just in theory.

   v2 (this file) — what changed and why, found by reading Ghibli Calendar's
   real source (state.js / app.js / dabsy-core.js, 2026-10):
     * Ghibli loads localStorage ONCE into memory and every save() writes
       the WHOLE in-memory state back. It had no 'storage'/'visibilitychange'
       re-read, so a tab that was in the background (Android freezes it, and
       freezes its BroadcastChannel/storage events with it) kept a stale
       copy: DABSy's entry appeared late, and Ghibli's next save() could
       even overwrite it. v2 therefore RE-READS the shared record whenever
       the page becomes visible / focused / is restored from the back-forward
       cache / comes back online, in addition to the live storage and
       BroadcastChannel paths. No polling, no timers.
     * Writes were fire-and-forget (errors swallowed). v2 returns a result,
       retries once, and READS THE RECORD BACK before reporting success.
     * Deletions travelled only over BroadcastChannel. v2 also leaves a small
       tombstone key so a page that was frozen still learns about them.
     * Events get a stable, content-derived id, so a retry / double send /
       repeated AI pass updates the same record instead of adding another.
     * Ghibli answers with a "calendar.ack" once it has merged and re-rendered,
       so DABSy can say "showing in Ghibli Calendar now" ONLY when that is true.
   ============================================================ */

(function () {
  const CHANNEL_NAME = "dabsy-core";
  const CAL_KEY = "ghibliforest_v1";
  const CONN_KEY = "dabsy_core_connections_v1";
  const TOMB_KEY = "dabsy_core_tombstones_v1";
  const VERSION = 2;

  let channel = null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch (e) { channel = null; }

  const subscribers = [];

  function uid() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowISO() { return new Date().toISOString(); }

  function todayKeyOffset(days = 0) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Shared category vocabulary — must stay identical to Ghibli Calendar's
  // own CATEGORIES map in state.js. This is deliberately duplicated (unlike
  // calendar events, which are never duplicated): it's a fixed, shared
  // *contract* both apps agree on, and DABSy needs it even on pages where
  // Ghibli's state.js isn't loaded at all.
  const CATEGORIES = {
    study:     { label: "Study",     emoji: "📚" },
    college:   { label: "College",   emoji: "🎓" },
    homework:  { label: "Homework",  emoji: "📝" },
    personal:  { label: "Personal",  emoji: "🌱" },
    creative:  { label: "Creative",  emoji: "🎨" },
    meeting:   { label: "Meeting",   emoji: "👥" },
    important: { label: "Important", emoji: "⭐" },
    deadline:  { label: "Deadline",  emoji: "⏰" },
  };
  function matchCategoryFromText(text) {
    const t = (text || "").toLowerCase();
    return Object.keys(CATEGORIES).find((id) => t.includes(id) || t.includes(CATEGORIES[id].label.toLowerCase())) || null;
  }

  function toMinutes(t) {
    if (!t) return null;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  /* ---------------- connections ---------------- */
  function defaultConnections() {
    return {
      calendar: { enabled: false, level: "read" }, // read | suggest | automatic
      study: { enabled: false, level: "read" },    // reserved for a future app — not built yet
      tasks: { enabled: false, level: "read" },     // reserved for a future app — not built yet
    };
  }
  function getConnections() {
    try {
      const raw = localStorage.getItem(CONN_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const merged = defaultConnections();
      Object.keys(merged).forEach((k) => { if (parsed[k]) merged[k] = Object.assign({}, merged[k], parsed[k]); });
      return merged;
    } catch (e) {
      return defaultConnections();
    }
  }
  function setConnection(appId, patch) {
    const conns = getConnections();
    conns[appId] = Object.assign({ enabled: false, level: "read" }, conns[appId], patch);
    try { localStorage.setItem(CONN_KEY, JSON.stringify(conns)); } catch (e) {}
    emit("connections.changed", { appId, state: conns[appId] });
    return conns[appId];
  }
  function isCalendarConnected() { return !!getConnections().calendar.enabled; }
  function getCalendarLevel() { return getConnections().calendar.level || "read"; }

  /* ---------------- raw fallback storage (used only when LF isn't loaded on this page) ---------------- */
  function readCalRaw() {
    try {
      const raw = localStorage.getItem(CAL_KEY);
      return raw ? JSON.parse(raw) : { version: 1, events: [] };
    } catch (e) { return { version: 1, events: [] }; }
  }
  // returns { ok, error } — never swallows a failure (quota, private mode, storage disabled)
  function writeCalRaw(obj) {
    try { localStorage.setItem(CAL_KEY, JSON.stringify(obj)); return { ok: true }; }
    catch (e) { return { ok: false, error: (e && e.name) || "storage-error" }; }
  }
  function readTomb() { try { return JSON.parse(localStorage.getItem(TOMB_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function writeTomb(t) {
    const cut = Date.now() - 30 * 86400000;                       // a month is far longer than any page stays frozen
    Object.keys(t).forEach((k) => { if (t[k] < cut) delete t[k]; });
    try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch (e) {}
  }

  /* ---------------- stable ids + duplicate detection ---------------- */
  function fnv(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function normTitle(t) {
    return String(t || "").replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }
  function stableId(input) {
    return "d" + fnv([normTitle(input.title), input.date || "", input.startTime || "", input.category || ""].join("|"));
  }
  function findDuplicate(list, input, id) {
    const nt = normTitle(input.title);
    return list.find((e) => e.id === id) ||
      list.find((e) => e.date === input.date && (e.startTime || null) === (input.startTime || null) && normTitle(e.title) === nt) || null;
  }

  /* ---------------- calendar reads (safe in either app) ---------------- */
  function getCalendarEvents() {
    if (window.LF) return window.LF.state.events.slice();
    return readCalRaw().events || [];
  }
  function getEventsForDate(dateKey) {
    return getCalendarEvents().filter((e) => e.date === dateKey);
  }
  function getEventById(id) {
    return getCalendarEvents().find((e) => e.id === id) || null;
  }

  /* ---------------- calendar writes ---------------- */
  /* saveEvent: the honest, idempotent write. Result:
       { ok, event, created, duplicate, verified, error }
     ok=false means NOTHING was saved (and error says why). verified=true means the
     record was read back from storage after the write. */
  function saveEvent(input) {
    const base = {
      title: input.title || "Untitled",
      date: input.date,
      startTime: input.startTime || null,
      endTime: input.endTime || null,
      category: CATEGORIES[input.category] ? input.category : "study",
      notes: input.notes || "",
      repeat: input.repeat || null,
      source: input.source || "calendar",
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base.date || "")) return { ok: false, error: "bad-date" };
    const id = input.id || stableId(base);
    let saved, created = true, duplicate = false;

    if (window.LF) {                                              // running inside Ghibli Calendar itself
      const dup = findDuplicate(window.LF.state.events, base, id);
      if (dup) { saved = dup; created = false; duplicate = true; }
      else saved = window.LF.addEvent(Object.assign({}, base, { createdAt: nowISO(), updatedAt: nowISO() }));
      return finish(saved, created, duplicate, !!window.LF.state.events.find((e) => e.id === saved.id));
    }

    let result = null;
    for (let attempt = 0; attempt < 2 && !(result && result.ok); attempt++) {
      const obj = readCalRaw();
      obj.events = obj.events || [];
      const dup = findDuplicate(obj.events, base, id);
      if (dup) { saved = dup; created = false; duplicate = true; result = { ok: true }; break; }
      saved = Object.assign({ id }, base, { createdAt: nowISO(), updatedAt: nowISO() });
      obj.events.push(saved);
      result = writeCalRaw(obj);
    }
    if (!result || !result.ok) return { ok: false, error: (result && result.error) || "storage-error" };
    const t = readTomb(); if (t[saved.id]) { delete t[saved.id]; writeTomb(t); }   // re-creating something that was deleted
    const verified = !!readCalRaw().events.find((e) => e.id === saved.id && e.date === base.date && e.title === saved.title);
    if (!verified) return { ok: false, error: "verify-failed" };
    return finish(saved, created, duplicate, true);

    function finish(ev, c, d, v) {
      if (c) emit("calendar.event.created", { event: ev });
      return { ok: true, event: ev, created: c, duplicate: d, verified: v };
    }
  }
  function createCalendarEvent(input) {                           // v1 signature kept: returns the event (or null)
    const r = saveEvent(input);
    return r.ok ? r.event : null;
  }

  function updateCalendarEvent(id, patch) {
    let updated = null;
    if (window.LF) {
      updated = window.LF.updateEvent(id, patch);
    } else {
      const obj = readCalRaw();
      const ev = (obj.events || []).find((e) => e.id === id);
      if (ev) { Object.assign(ev, patch, { updatedAt: nowISO() }); if (writeCalRaw(obj).ok) updated = ev; }
    }
    if (updated) emit("calendar.event.updated", { event: updated });
    return updated;
  }

  function deleteCalendarEvent(id) {
    if (window.LF) {
      window.LF.removeItem("events", id);
    } else {
      const obj = readCalRaw();
      obj.events = (obj.events || []).filter((e) => e.id !== id);
      writeCalRaw(obj);
    }
    const t = readTomb(); t[id] = Date.now(); writeTomb(t);      // lets a frozen / late-opening Ghibli page learn about it
    emit("calendar.event.deleted", { eventId: id });
  }

  /* ---------------- tasks (Ghibli's own task list — reused, not duplicated) ----------------
     Only delete is exposed here: creating/editing tasks is Ghibli's own UI
     job for now (not part of the Phase 1 calendar-integration ask), but
     "cancel/delete this" needs to reach tasks too, not just calendar events. */
  function getTasks() {
    if (window.LF) return window.LF.state.tasks.slice();
    return readCalRaw().tasks || [];
  }
  function deleteTask(id) {
    if (window.LF) {
      window.LF.removeItem("tasks", id);
    } else {
      const obj = readCalRaw();
      obj.tasks = (obj.tasks || []).filter((t) => t.id !== id);
      writeCalRaw(obj);
    }
    emit("task.deleted", { taskId: id });
  }

  /* ---------------- conflict detection on shared records ---------------- */
  function findConflicts(dateKey, candidate) {
    const start = toMinutes(candidate.startTime);
    if (start == null) return [];
    const end = candidate.endTime ? toMinutes(candidate.endTime) : start + 30;
    return getEventsForDate(dateKey).filter((e) => {
      if (candidate.excludeId && e.id === candidate.excludeId) return false;
      const eStart = toMinutes(e.startTime);
      if (eStart == null) return false;
      const eEnd = e.endTime ? toMinutes(e.endTime) : eStart + 30;
      return start < eEnd && eStart < end;
    });
  }

  /* ---------------- sync: broadcast + receive ----------------
     Every merge is an upsert keyed by the event's stable id, so receiving the same news twice
     (BroadcastChannel + storage event + a visibility re-read) can never create a second copy. */
  const sync = { lastReconcileAt: 0, lastAckAt: 0, lastReason: "" };
  const acked = new Set(), ackWaiters = [];

  function emit(type, payload) {
    if (channel) { try { channel.postMessage({ type, payload }); } catch (e) {} }
    subscribers.forEach((fn) => { try { fn(type, payload); } catch (e) {} });
  }
  function ackIds(ids) {                                          // Ghibli -> DABSy: "I merged these and re-rendered"
    if (!ids.length || !channel) return;
    try { channel.postMessage({ type: "calendar.ack", payload: { ids, at: Date.now(), app: "ghibli" } }); } catch (e) {}
  }
  function whenAcked(id, ms) {                                    // DABSy: resolves true only if an open Ghibli page confirmed
    return new Promise((resolve) => {
      if (acked.has(id)) return resolve(true);
      const w = { id, resolve, t: setTimeout(() => { const i = ackWaiters.indexOf(w); if (i >= 0) ackWaiters.splice(i, 1); resolve(false); }, ms || 2500) };
      ackWaiters.push(w);
    });
  }
  function gotAck(ids) {
    sync.lastAckAt = Date.now();
    ids.forEach((id) => acked.add(id));
    for (let i = ackWaiters.length - 1; i >= 0; i--) if (acked.has(ackWaiters[i].id)) { clearTimeout(ackWaiters[i].t); ackWaiters[i].resolve(true); ackWaiters.splice(i, 1); }
  }

  /* reconcile(): inside Ghibli, bring the in-memory state up to date with the shared record.
     Newer updatedAt wins; tombstones remove; nothing is duplicated; only writes back if something changed. */
  function reconcile(reason) {
    sync.lastReconcileAt = Date.now(); sync.lastReason = reason || "";
    if (!window.LF) return false;
    let changed = false; const touched = [];
    try {
      const stored = readCalRaw().events || [];
      const tomb = readTomb();
      const local = window.LF.state.events;
      Object.keys(tomb).forEach((id) => { const i = local.findIndex((e) => e.id === id); if (i >= 0) { local.splice(i, 1); changed = true; } });
      stored.forEach((inEv) => {
        if (!inEv || !inEv.id || tomb[inEv.id]) return;
        const cur = local.find((x) => x.id === inEv.id);
        if (!cur) { local.push(inEv); changed = true; touched.push(inEv.id); }
        else if (new Date(inEv.updatedAt || 0) > new Date(cur.updatedAt || 0)) { Object.assign(cur, inEv); changed = true; touched.push(inEv.id); }
        else touched.push(inEv.id);
      });
      if (changed) window.LF.save();
    } catch (e) { return false; }
    if (changed) subscribers.forEach((fn) => { try { fn("calendar.sync", { reason }); } catch (err) {} });   // Ghibli's app.js re-renders on any "calendar.*"
    ackIds(touched.slice(-50));
    return changed;
  }

  function applyRemote(type, payload) {
    if (window.LF && type.indexOf("calendar.") === 0) {
      if (type === "calendar.event.created" || type === "calendar.event.updated") {
        const events = window.LF.state.events;
        const ev = events.find((e) => e.id === payload.event.id);
        if (ev) Object.assign(ev, payload.event); else events.push(payload.event);
        window.LF.save();
      }
      reconcile("message");                                       // also applies deletions via the tombstone key
    } else if (window.LF && type === "task.deleted") {
      const tasks = window.LF.state.tasks;
      const i = tasks.findIndex((t) => t.id === payload.taskId);
      if (i >= 0) { tasks.splice(i, 1); window.LF.save(); }
    }
    subscribers.forEach((fn) => { try { fn(type, payload); } catch (e) {} });
  }

  if (channel) {
    channel.onmessage = (e) => {
      const { type, payload } = e.data || {};
      if (!type) return;
      if (type === "calendar.ack") { gotAck((payload && payload.ids) || []); return; }
      if (type.indexOf("calendar.") === 0 || type === "task.deleted") applyRemote(type, payload);
      else subscribers.forEach((fn) => { try { fn(type, payload); } catch (err) {} });
    };
  }

  // Other tabs only (the writer never receives its own storage event).
  window.addEventListener("storage", (e) => {
    if (e.key === CAL_KEY || e.key === TOMB_KEY) { if (window.LF) reconcile("storage"); else subscribers.forEach((fn) => { try { fn("calendar.sync", { reason: "storage" }); } catch (err) {} }); }
  });
  // The cases a background / frozen page misses: re-read the moment it can run again. Cheap (one localStorage read).
  const wake = (why) => () => { if (!document.hidden) reconcile(why); };
  document.addEventListener("visibilitychange", wake("visible"));
  window.addEventListener("focus", wake("focus"));
  window.addEventListener("pageshow", (e) => { if (e.persisted || window.LF) reconcile("pageshow"); });
  window.addEventListener("online", wake("online"));
  // Newest data on open. This file loads BEFORE Ghibli's state.js, so LF doesn't exist yet at this line: wait for the page.
  window.addEventListener("load", () => reconcile("load"));

  function subscribe(fn) {
    subscribers.push(fn);
    return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); };
  }

  window.DABSyCore = {
    // connections
    getConnections, setConnection, isCalendarConnected, getCalendarLevel,
    // calendar CRUD
    getCalendarEvents, getEventsForDate, getEventById,
    saveEvent, stableId, whenAcked, reconcile, syncInfo: () => Object.assign({ version: VERSION, hasChannel: !!channel }, sync),
    createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
    // tasks (delete only, for now)
    getTasks, deleteTask,
    // shared helpers
    findConflicts, toMinutes, todayKeyOffset, CATEGORIES, matchCategoryFromText,
    // sync
    subscribe,
  };
})();
