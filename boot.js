/* ============================================================
   D.A.B.S.y — boot.js  (runs last)
   Wake-up, a short greeting, the ONE-TIME tutorial offer, deep links
   from shortcuts / notifications, and idle-time warming of lazy modules.

   Tutorial rules (see onboarding-engine.js):
     - offered once, on first launch of a fresh install
     - an existing v6 user (prior data, no tutorial record) is marked
       "completed" silently — updates never show it again
     - Settings → Help & Tutorial → Replay Tutorial brings it back
   ============================================================ */
(function(){
  const D = window.DABSy;
  document.body.classList.add("booting");

  function greeting(first){
    const hour = new Date().getHours();
    const g = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    if(first) return "Hi, I'm DABSy. I'll help you plan, study and keep track of things.";
    const next = D.tasks.nextInstance();
    if(next && next.dateKey === D.ui.dateKey()) return `${g}. ${next.title} is at ${D.ui.fmtTime(next.start)} today.`;
    return `${g}. What are we working on?`;
  }

  function tutorialState(){ return D.memory.read("onboarding_v1", null); }

  async function deepLinks(){
    const q = new URLSearchParams(location.search);
    const action = q.get("action"), notif = q.get("notif");
    if(!action && !notif && !q.get("session")) return;
    history.replaceState(null, "", location.pathname);
    if(notif){ D.notify.act(notif, action || "open"); return; }
    if(q.get("session")){ (await D.require("session")).open(q.get("session")); return; }
    if(action === "study"){ D.app.openCommand(false); D.app.handleUserUtterance("I want to study"); }
    else if(action === "notifications") D.app.openCenter();
    else if(action === "settings") (await D.require("settings")).open();
    else if(action === "apps") D.ecosystem.open();
  }

  window.addEventListener("load", () => {
    setTimeout(async () => {
      document.body.classList.remove("booting");
      await D.face.playWakeSequence();

      // first-run / upgrade decision
      let st = tutorialState();
      const fresh = !st && !D.memory.hadPriorData();
      if(!st && D.memory.hadPriorData()){
        st = { tutorialCompleted: true, reason: "existing-user", at: Date.now() };
        D.memory.write("onboarding_v1", st);
      }
      D.app.say(greeting(fresh), "HAPPY");

      if(!st || !st.tutorialCompleted){
        setTimeout(() => D.require("onboarding").then(o => o.maybeOffer()).catch(() => {}), 2600);
      }
      if(D.memory.read("sessions_v1", []).some(x => x.status === "active" && x.run)) D.require("session").then(m => m.resumeActive()).catch(() => {});
      deepLinks();

      // warm heavier modules when the device is idle; fewer on low-end hardware
      const lite = document.body.classList.contains("lite-gfx");
      D.warm(lite ? ["notifcenter"] : ["notifcenter", "learning", "planner", "research", "cards", "bridge", "session", "agent", "settings", "easter"]);
      D.require("easter").catch(() => {});
    }, 300);
  });
})();
