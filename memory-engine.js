/* ============================================================
   D.A.B.S.y — memory-engine.js
   Three tiers:
     session    — in-memory only, cleared on reload (current convo)
     preferences— things DABSy was explicitly told to remember
     history    — interactions / study progress log
   Everything persisted lives in localStorage under "dabsy_*",
   so it can be viewed, exported and forgotten from Settings.

   v7 changes
     - No API key is stored any more. A leftover key from v6 is
       deleted on first run (see migrate()).
     - read()/write() are exposed so other modules share ONE
       namespaced storage helper instead of each rolling their own.
     - exportAll() / forgetEverything() cover every dabsy_* key,
       not just the ones this file knows about.
   ============================================================ */

(function(){
  const NS = "dabsy_";
  const KEYS = {
    prefs: NS + "preferences",
    history: NS + "history",
    tasks: NS + "tasks",          // v6 simple task list (kept for migration only)
    reminders: NS + "reminders",
    petStats: NS + "pet_stats",
    settings: NS + "settings",
  };
  // Kept across "forget everything" so the tutorial never re-appears by accident.
  const KEEP_ON_WIPE = [NS + "onboarding_v1", NS + "dev_proxy"];

  function readJSON(key, fallback){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch(e){ return fallback; }
  }
  function writeJSON(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch(e){ console.error("memory write failed", e); return false; }
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

  /* ---------- v6 simple tasks / reminders ----------
     Superseded by task-engine.js (rich task objects). These stay only so
     old data can be migrated and old callers don't break. */
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

  /* ---------- settings ---------- */
  const SETTINGS_DEFAULTS = {
    voiceURI: "",
    sound: true,
    speakReplies: true,      // DABSy speaks replies aloud (text always shows)
    cheer: true,             // short, text-only encouragement between study blocks
    personalizeAI: true,     // include my learned study preferences in AI requests
    showShortcuts: false,    // on-screen buttons for the gestures (accessibility)
    reduceMotion: "auto",    // auto | on | off
  };
  function getSettings(){ return { ...SETTINGS_DEFAULTS, ...readJSON(KEYS.settings, {}) }; }
  function saveSettings(patch){
    const next = { ...getSettings(), ...patch };
    writeJSON(KEYS.settings, next);
    window.DABSy.bus?.emit("settings:changed", { patch, settings: next });
    return next;
  }

  /* ---------- migration ---------- */
  function migrate(){
    // v6 stored the user's own Gemini key here. v7 never uses one, and a
    // leftover secret in localStorage is a liability — remove it.
    const raw = readJSON(KEYS.settings, null);
    if(raw && "geminiKey" in raw){
      delete raw.geminiKey;
      writeJSON(KEYS.settings, raw);
    }
  }
  migrate();

  /* ---------- generic namespaced helpers for other modules ---------- */
  function read(name, fallback){ return readJSON(NS + name, fallback); }
  function write(name, val){ return writeJSON(NS + name, val); }
  function remove(name){ try{ localStorage.removeItem(NS + name); }catch(e){} }

  function allKeys(){
    const out = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.startsWith(NS)) out.push(k);
    }
    return out;
  }
  // Captured ONCE, at load, before any v7 module has had a chance to write
  // anything — so "was there data from an earlier DABSy?" stays truthful.
  const PRIOR_DATA = allKeys().some(k => k !== NS + "onboarding_v1" && k !== NS + "dev_proxy");
  function hadPriorData(){ return PRIOR_DATA; }
  function exportAll(){
    const out = {};
    allKeys().forEach(k => { out[k] = readJSON(k, null); });
    return out;
  }

  /* ---------- full wipe ---------- */
  function forgetEverything(){
    allKeys().filter(k => !KEEP_ON_WIPE.includes(k)).forEach(k => localStorage.removeItem(k));
    session = [];
    window.DABSy.bus?.emit("memory:wiped");
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.memory = {
    addSession, getSession, clearSession,
    getPreferences, addPreference, removePreference,
    getHistory, addHistory, clearHistory,
    getTasks, addTask, toggleTask, removeTask,
    getReminders, addReminder, removeReminder,
    getPetStats, savePetStats,
    getSettings, saveSettings, SETTINGS_DEFAULTS,
    read, write, remove, allKeys, hadPriorData, exportAll,
    forgetEverything,
  };
})();
