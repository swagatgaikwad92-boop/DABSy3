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
   ============================================================ */

(function () {
  const CHANNEL_NAME = "dabsy-core";
  const CAL_KEY = "ghibliforest_v1";
  const CONN_KEY = "dabsy_core_connections_v1";

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
  function writeCalRaw(obj) {
    try { localStorage.setItem(CAL_KEY, JSON.stringify(obj)); } catch (e) {}
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
  function createCalendarEvent(input) {
    const record = {
      title: input.title || "Untitled",
      date: input.date,
      startTime: input.startTime || null,
      endTime: input.endTime || null,
      category: input.category || "study",
      notes: input.notes || "",
      repeat: input.repeat || null,
      source: input.source || "calendar",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    let saved;
    if (window.LF) {
      saved = window.LF.addEvent(record); // reuses LF's real id-assignment + save()
    } else {
      const obj = readCalRaw();
      record.id = uid();
      obj.events = obj.events || [];
      obj.events.push(record);
      writeCalRaw(obj);
      saved = record;
    }
    emit("calendar.event.created", { event: saved });
    return saved;
  }

  function updateCalendarEvent(id, patch) {
    let updated = null;
    if (window.LF) {
      updated = window.LF.updateEvent(id, patch);
    } else {
      const obj = readCalRaw();
      const ev = (obj.events || []).find((e) => e.id === id);
      if (ev) { Object.assign(ev, patch, { updatedAt: nowISO() }); writeCalRaw(obj); updated = ev; }
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
    emit("calendar.event.deleted", { eventId: id });
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
     Duplicate-prevention rule: every merge below is an upsert keyed
     by the event's stable id, so receiving the same message twice
     (e.g. once from BroadcastChannel, once from the "storage" fallback)
     never creates a second copy. */
  function emit(type, payload) {
    if (channel) { try { channel.postMessage({ type, payload }); } catch (e) {} }
    subscribers.forEach((fn) => { try { fn(type, payload); } catch (e) {} });
  }

  function applyRemote(type, payload) {
    if (window.LF) {
      const events = window.LF.state.events;
      if (type === "calendar.event.created") {
        if (!events.find((e) => e.id === payload.event.id)) { events.push(payload.event); window.LF.save(); }
      } else if (type === "calendar.event.updated") {
        const ev = events.find((e) => e.id === payload.event.id);
        if (ev) Object.assign(ev, payload.event);
        else events.push(payload.event); // update arrived before this tab ever saw the create
        window.LF.save();
      } else if (type === "calendar.event.deleted") {
        const i = events.findIndex((e) => e.id === payload.eventId);
        if (i >= 0) { events.splice(i, 1); window.LF.save(); }
      }
    }
    subscribers.forEach((fn) => { try { fn(type, payload); } catch (e) {} });
  }

  if (channel) {
    channel.onmessage = (e) => {
      const { type, payload } = e.data || {};
      if (!type) return;
      if (type.indexOf("calendar.") === 0) applyRemote(type, payload);
      else subscribers.forEach((fn) => { try { fn(type, payload); } catch (err) {} });
    };
  }

  // storage-event fallback — fires only in OTHER tabs on this origin, never
  // the tab that made the write, so this can never double-apply against the
  // writer's own state. Handles create/update merges; deliberately does NOT
  // infer deletions from a bare storage event (too ambiguous to do safely),
  // so BroadcastChannel remains the path that actually removes events on
  // other open tabs. This is a real, disclosed limitation, not a hidden one.
  window.addEventListener("storage", (e) => {
    if (e.key !== CAL_KEY || !e.newValue || !window.LF) return;
    try {
      const incoming = (JSON.parse(e.newValue).events) || [];
      const local = window.LF.state.events;
      let changed = false;
      incoming.forEach((inEv) => {
        const cur = local.find((x) => x.id === inEv.id);
        if (!cur) { local.push(inEv); changed = true; }
        else if (new Date(inEv.updatedAt || 0) > new Date(cur.updatedAt || 0)) { Object.assign(cur, inEv); changed = true; }
      });
      if (changed) window.LF.save();
    } catch (err) {}
    subscribers.forEach((fn) => { try { fn("calendar.sync", {}); } catch (err) {} });
  });

  function subscribe(fn) {
    subscribers.push(fn);
    return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); };
  }

  window.DABSyCore = {
    // connections
    getConnections, setConnection, isCalendarConnected, getCalendarLevel,
    // calendar CRUD
    getCalendarEvents, getEventsForDate, getEventById,
    createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
    // shared helpers
    findConflicts, toMinutes, todayKeyOffset, CATEGORIES, matchCategoryFromText,
    // sync
    subscribe,
  };
})();
