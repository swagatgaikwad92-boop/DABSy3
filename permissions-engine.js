/* ============================================================
   D.A.B.S.y — permissions-engine.js
   Just-in-time permissions. Nothing is requested at launch.

   When a feature genuinely needs a permission it calls
       permissions.ensure("notifications", { reason: "..." })
   and DABSy shows a short, friendly popup explaining WHY, with
   Allow / Not now. Only "Allow" triggers the real browser prompt.

   What a web app can and cannot do (be honest about it):
     - It can ask for notifications, microphone, camera and
       persistent storage through the browser's own prompt.
     - It can NOT re-prompt once the user has blocked a permission,
       and it can NOT deep-link into Android's system settings.
       In that case DABSy explains where the switch lives instead
       of pretending the prompt will appear.
   ============================================================ */

(function(){
  const memory = window.DABSy.memory;
  const ui = window.DABSy.ui;
  const COOLDOWN_MS = 3 * 24 * 3600 * 1000; // after "Not now", don't ask again for 3 days
  const KEY = "perm_v1";

  const REGISTRY = {
    notifications: {
      label: "Notifications",
      reason: "I need notification permission so I can remind you about your tasks.",
      supported: () => "Notification" in window,
      state: async () => {
        const p = Notification.permission;
        return p === "default" ? "prompt" : p;
      },
      request: async () => { const r = await Notification.requestPermission(); return r === "default" ? "prompt" : r; },
      blockedHelp: "Notifications are blocked for DABSy. Open your browser's site settings (or, for the installed app, long-press the DABSy icon → App info → Notifications) and switch them on.",
    },
    microphone: {
      label: "Microphone",
      reason: "I need the microphone so I can hear you when you talk to me.",
      supported: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      state: async () => {
        try{ const r = await navigator.permissions.query({ name: "microphone" }); return r.state; }
        catch(e){ return "prompt"; }
      },
      request: async () => {
        try{
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach(t => t.stop());
          return "granted";
        }catch(e){ return (e && e.name === "NotAllowedError") ? "denied" : "prompt"; }
      },
      blockedHelp: "The microphone is blocked for DABSy. Tap the lock or tune icon next to the address bar (or long-press the DABSy icon → App info → Permissions) and allow Microphone. You can also just type to me.",
    },
    camera: {
      label: "Camera",
      reason: "I need the camera so I can look at what you point it at.",
      supported: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      state: async () => {
        try{ const r = await navigator.permissions.query({ name: "camera" }); return r.state; }
        catch(e){ return "prompt"; }
      },
      request: async () => {
        try{
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          s.getTracks().forEach(t => t.stop());
          return "granted";
        }catch(e){ return (e && e.name === "NotAllowedError") ? "denied" : "prompt"; }
      },
      blockedHelp: "The camera is blocked for DABSy. Allow Camera in your browser's site settings (or the installed app's App info → Permissions).",
    },
    storage: {
      label: "Keep my data",
      reason: "I'd like to ask your browser to keep my notes about your tasks and study plans safe, so they aren't cleared when your phone is low on space.",
      supported: () => !!(navigator.storage && navigator.storage.persist),
      state: async () => ((await navigator.storage.persisted()) ? "granted" : "prompt"),
      request: async () => ((await navigator.storage.persist()) ? "granted" : "denied"),
      blockedHelp: "Your browser decided not to protect DABSy's data from automatic clean-up. Installing DABSy to your home screen usually helps.",
    },
  };

  function readLedger(){ return memory.read(KEY, {}); }
  function writeLedger(l){ memory.write(KEY, l); }

  async function status(name){
    const def = REGISTRY[name];
    if(!def || !def.supported()) return "unsupported";
    try{ return await def.state(); }catch(e){ return "prompt"; }
  }

  async function ensure(name, opts){
    opts = opts || {};
    const def = REGISTRY[name];
    if(!def) return { granted:false, state:"unsupported" };
    if(!def.supported()){
      if(!opts.silent) await ui.popup({
        title: def.label + " isn't available here",
        text: "This browser or device doesn't support it, so I'll keep working without it.",
        actions: [{ label: "OK", value: true, kind: "primary" }],
      });
      return { granted:false, state:"unsupported" };
    }

    const state = await status(name);
    if(state === "granted") return { granted:true, state };

    if(state === "denied"){
      if(!opts.silent) await ui.popup({
        title: def.label + " is switched off",
        text: def.blockedHelp,
        actions: [{ label: "Got it", value: true, kind: "primary" }],
      });
      return { granted:false, state:"denied" };
    }

    // state === "prompt": explain first, then ask.
    const ledger = readLedger();
    const last = ledger[name] && ledger[name].declinedAt;
    if(!opts.force && last && Date.now() - last < COOLDOWN_MS){
      return { granted:false, state:"prompt", skipped:true };
    }

    const choice = await ui.popup({
      title: opts.title || ("Can I use " + def.label.toLowerCase() + "?"),
      text: opts.reason || def.reason,
      actions: [
        { label: "Not now", value: "no", kind: "ghost" },
        { label: "Allow", value: "yes", kind: "primary" },
      ],
      dismissValue: "no",
    });

    if(choice !== "yes"){
      const l = readLedger(); l[name] = { declinedAt: Date.now() }; writeLedger(l);
      return { granted:false, state:"prompt", declined:true };
    }
    const result = await def.request();
    const l = readLedger(); delete l[name]; writeLedger(l);
    window.DABSy.bus.emit("permission:changed", { name, state: result });
    return { granted: result === "granted", state: result };
  }

  // Used by Settings to show a row's current state without prompting.
  async function describe(name){
    const st = await status(name);
    const text = { granted:"Allowed", denied:"Blocked", prompt:"Not asked yet", unsupported:"Not supported here" }[st] || st;
    return { state: st, text };
  }

  window.DABSy.permissions = { ensure, status, describe, REGISTRY };
})();
