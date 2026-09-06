/* ============================================================
   D.A.B.S.y — memory-engine.js
   Three tiers:
     session    — in-memory only, cleared on reload (current convo)
     preferences— things DABSy was explicitly told to remember
     history    — tasks / reminders / study progress / interaction log
   All persisted tiers live in localStorage, namespaced, with
   view/edit/forget/clear exposed for the Memory panel.
   ============================================================ */

(function(){
  const NS = "dabsy_";
  const KEYS = {
    prefs: NS + "preferences",
    history: NS + "history",
    tasks: NS + "tasks",
    reminders: NS + "reminders",
    petStats: NS + "pet_stats",
    settings: NS + "settings",
  };

  function readJSON(key, fallback){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch(e){ return fallback; }
  }
  function writeJSON(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){ console.error("memory write failed", e); }
  }

  /* ---------- session (volatile) ---------- */
  let session = []; // [{role:'user'|'dabsy', text, ts}]
  function addSession(role, text){
    session.push({ role, text, ts: Date.now() });
    if(session.length > 40) session.shift();
  }
  function getSession(limit=12){ return session.slice(-limit); }
  function clearSession(){ session = []; }

  /* ---------- preferences ---------- */
  function getPreferences(){ return readJSON(KEYS.prefs, []); }
  function addPreference(text){
    const list = getPreferences();
    list.push({ text, ts: Date.now() });
    writeJSON(KEYS.prefs, list);
  }
  function removePreference(index){
    const list = getPreferences();
    list.splice(index,1);
    writeJSON(KEYS.prefs, list);
  }

  /* ---------- history (interactions / study progress) ---------- */
  function getHistory(){ return readJSON(KEYS.history, []); }
  function addHistory(entry){
    const list = getHistory();
    list.push({ ...entry, ts: Date.now() });
    if(list.length > 200) list.shift();
    writeJSON(KEYS.history, list);
  }
  function clearHistory(){ writeJSON(KEYS.history, []); }

  /* ---------- tasks / reminders ---------- */
  function getTasks(){ return readJSON(KEYS.tasks, []); }
  function addTask(text){
    const list = getTasks();
    list.push({ id: Date.now()+"", text, done:false });
    writeJSON(KEYS.tasks, list);
    return list;
  }
  function toggleTask(id){
    const list = getTasks();
    const t = list.find(t=>t.id===id);
    if(t) t.done = !t.done;
    writeJSON(KEYS.tasks, list);
    return list;
  }
  function removeTask(id){
    const list = getTasks().filter(t=>t.id!==id);
    writeJSON(KEYS.tasks, list);
    return list;
  }

  function getReminders(){ return readJSON(KEYS.reminders, []); }
  function addReminder(text, when){
    const list = getReminders();
    list.push({ id: Date.now()+"", text, when });
    writeJSON(KEYS.reminders, list);
    return list;
  }
  function removeReminder(id){
    const list = getReminders().filter(r=>r.id!==id);
    writeJSON(KEYS.reminders, list);
    return list;
  }

  /* ---------- pet stats ---------- */
  function getPetStats(){
    return readJSON(KEYS.petStats, { lastSeen: Date.now(), affection: 0.4, streak: 0 });
  }
  function savePetStats(stats){ writeJSON(KEYS.petStats, stats); }

  /* ---------- settings (api key, voice, sound) ---------- */
  function getSettings(){ return readJSON(KEYS.settings, { geminiKey:"", voiceURI:"", sound:true }); }
  function saveSettings(patch){
    const cur = getSettings();
    const next = { ...cur, ...patch };
    writeJSON(KEYS.settings, next);
    return next;
  }

  /* ---------- full wipe ---------- */
  function forgetEverything(){
    Object.values(KEYS).forEach(k=>localStorage.removeItem(k));
    session = [];
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.memory = {
    addSession, getSession, clearSession,
    getPreferences, addPreference, removePreference,
    getHistory, addHistory, clearHistory,
    getTasks, addTask, toggleTask, removeTask,
    getReminders, addReminder, removeReminder,
    getPetStats, savePetStats,
    getSettings, saveSettings,
    forgetEverything,
  };
})();
