/* briefing-engine.js — a short, optional daily briefing.
   Shown at most once per day, only when there is something real to say, never in quiet hours, and it can be
   switched off in one tap ("Stop these") or in Settings. Also keeps a tiny study log (minutes per day) so the
   briefing can say how much you studied yesterday. Stored locally only. */
(function(){
  const D = window.DABSy, memory = D.memory, ui = D.ui, bus = D.bus;
  const LOGKEY = "study_log_v1", SHOWNKEY = "briefing_shown_v1";

  // ---- study log: { "YYYY-MM-DD": minutes } for the last 14 days ----
  const log = () => memory.read(LOGKEY, {});
  bus.on("session:finished", ({ doneMin }) => {
    const l = log(), k = ui.dateKey();
    l[k] = (l[k] || 0) + Math.max(0, Math.round(doneMin || 0));
    Object.keys(l).sort().slice(0, -14).forEach(x => delete l[x]);
    memory.write(LOGKEY, l);
  });
  const minutesOn = d => (log()[ui.dateKey(d)] || 0);

  function gather(){
    const now = new Date(), T = D.tasks, yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const today = T.instancesForDate(ui.dateKey(now)).filter(i => i.status === "pending").sort((a, b) => a.start - b.start);
    const carried = T.instancesForDate(ui.dateKey(yest)).filter(i => i.status === "pending" || i.status === "missed").length;
    return { today, carried, unscheduled: T.unscheduled().length, yMin: minutesOn(yest), streak: (memory.getPetStats().streak || 0) };
  }
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

  function lines(g){
    const out = [];
    if(g.today.length){
      const first = g.today[0];
      out.push(["today", `${plural(g.today.length, "thing")} today. First up: ${first.title} at ${ui.fmtTime(first.start)}.`]);
    }
    if(g.carried) out.push(["carried", `${plural(g.carried, "item")} from yesterday didn't get done. I can find new slots if you like.`]);
    if(g.unscheduled) out.push(["open", `${plural(g.unscheduled, "task")} still ${g.unscheduled === 1 ? "has" : "have"} no time.`]);
    if(g.yMin >= 10) out.push(["study", `Yesterday you studied for ${g.yMin} minutes. Nice.`]);
    return out;
  }

  async function maybeShow(force){
    const s = memory.getSettings(), now = new Date(), key = ui.dateKey(now);
    if(!force){
      if(s.dailyBriefing === false) return false;
      if(memory.read(SHOWNKEY, "") === key) return false;
      if(now.getHours() < 5 || now.getHours() >= 21) return false;
      if(D.notify && D.notify.inQuietHours(now)) return false;
      if(document.body.classList.contains("session-active")) return false;
    }
    const L = lines(gather());
    if(!L.length){ if(!force) return false; L.push(["none", "Nothing planned today. A clear slate."]); }
    memory.write(SHOWNKEY, key);
    const hour = now.getHours(), g = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const content = ui.el("div", { class: "briefing" }, D.stickers ? D.stickers.el("milk", 44) : null,
      ui.el("ul", { class: "briefing-list" }, L.map(([, t]) => ui.el("li", {}, t))));
    const hasWork = gather().today.length || gather().unscheduled;
    const v = await ui.popup({ title: g + ".", content,
      actions: [{ label: "Stop these", value: "off", kind: "ghost" }, { label: "Not now", value: "no", kind: "ghost" },
        { label: hasWork ? "See my tasks" : "Start studying", value: "go", kind: "primary" }], dismissValue: "no" });
    if(v === "off") memory.saveSettings({ dailyBriefing: false });
    else if(v === "go"){
      if(hasWork) D.require("notifcenter").then(c => c.openTasks());
      else { D.app.openCommand(false); D.app.handleUserUtterance("I want to study"); }
    }
    return true;
  }
  D.briefing = { maybeShow, show: () => maybeShow(true) };
})();
