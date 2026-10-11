/* push-engine.js — optional Web Push so reminders arrive when DABSy is closed.
   Needs the Worker in backend/ (config: push.url). Works only on browsers with Push API (Android Chrome/Edge/Firefox,
   installed PWA on iOS 16.4+). Without it nothing changes: reminders still fire while the app is open.
   DABSy.push.supported() / enabled() / enable() / disable() / sync() */
(function(){
  const D = window.DABSy, bus = D.bus, memory = D.memory;
  const base = () => String((D.config && D.config.push && D.config.push.url) || "").replace(/\/$/, "");
  const supported = () => !!(base() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  const u8 = b64 => { const p = "=".repeat((4 - b64.length % 4) % 4), s = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, c => c.charCodeAt(0)); };
  const post = (path, body) => fetch(base() + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const isOn = () => !!memory.getSettings().pushOn;
  let timer = 0;

  async function currentSub(){ const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }

  async function enable(){
    if(!supported()) return { ok: false, error: "unsupported" };
    const perm = await D.notify.enableSystem();
    if(!perm) return { ok: false, error: "permission" };
    try{
      const k = await fetch(base() + "/v1/push/key").then(r => r.json());
      if(!k.ok) return { ok: false, error: k.error || "server" };
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(k.key) });
      const r = await post("/v1/push/subscribe", { subscription: sub.toJSON() });
      if(!r.ok) return { ok: false, error: r.error || "server" };
      (await caches.open("dabsy-meta")).put("push-url", new Response(base()));   // the service worker reads this when a push arrives
      memory.saveSettings({ pushOn: true });
      sync();
      return { ok: true };
    }catch(e){ return { ok: false, error: String(e.message || e).slice(0, 60) }; }
  }
  async function disable(){
    memory.saveSettings({ pushOn: false });
    try{ const sub = await currentSub(); if(sub){ await post("/v1/push/unsubscribe", { subscription: { endpoint: sub.endpoint } }); await sub.unsubscribe(); } }catch(_){}
  }

  // send the next 48 h of pending, timed reminders to the server (outside quiet hours)
  async function sync(){
    if(!supported() || !isOn()) return;
    try{
      const sub = await currentSub(); if(!sub) return;
      const now = new Date(), items = [], T = D.tasks;
      for(let d = 0; d < 3; d++){
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
        const key = D.ui.dateKey(day);
        T.instancesForDate(key).forEach(inst => {
          if(inst.status !== "pending" || !(inst.start > now)) return;
          const t = T.get(inst.taskId); if(!t || D.notify.inQuietHours(new Date(inst.start))) return;
          items.push({ id: inst.key, at: +inst.start, title: t.title.slice(0, 40), body: "It's about time. Want to start?" });
        });
      }
      await post("/v1/push/schedule", { subscription: { endpoint: sub.endpoint }, items: items.slice(0, 40) });
    }catch(_){}
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(sync, 2500); };   // batch rapid edits
  bus.on("tasks:changed", later); bus.on("tasks:completed", later); bus.on("tasks:skipped", later);
  bus.on("settings:changed", later);
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") later(); });
  later();

  D.push = { supported, enabled: isOn, enable, disable, sync };
})();
