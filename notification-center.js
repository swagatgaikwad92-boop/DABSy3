/* ============================================================
   D.A.B.S.y — notification-center.js
   The in-app glass notification centre (drops down from the top) and
   the task list ("My day"). This is DABSy's OWN surface. It is not a
   system-level glass notification — a web app can't style those; real
   system notifications (when allowed) use the platform's own look.
   ============================================================ */
(function(){
  const D = window.DABSy;
  const ui = D.ui, bus = D.bus, notify = D.notify, tasks = D.tasks;
  let openSheet = null;

  /* ---------------- notification centre ---------------- */
  function open(){
    if(openSheet) return;
    const clearBtn = ui.el("button", { class: "btn sm ghost", type: "button", onclick: () => { notify.clearAll(); render(); } }, "Clear");
    const sh = ui.sheet({ side: "top", title: "Notifications", className: "center", headerActions: [clearBtn], onClose: () => { openSheet = null; off(); } });
    openSheet = sh;
    const list = ui.el("div", { class: "nc-list" });
    const footer = ui.el("div", { class: "nc-foot" });
    sh.body.append(list, footer);
    const off = (() => { const a = bus.on("notify:inbox", render); return a; })();

    function render(){
      list.innerHTML = "";
      const items = notify.inbox().slice().reverse();
      if(!items.length) list.append(ui.el("div", { class: "empty" }, ui.el("div", {}, "All quiet. Nice."), ui.el("p", { class: "hint" }, "I only speak up when something needs you. If I get annoying, tell me in Settings → Notifications.")));
      items.forEach(n => {
        const isNew = n.status === "new";
        const row = ui.el("article", { class: "nc-item" + (isNew ? " new" : "") + (n.status === "acted" ? " acted" : ""), "aria-label": n.title + ". " + n.body },
          ui.miniFace(),
          ui.el("div", { class: "nc-main" },
            ui.el("div", { class: "nc-head" }, ui.el("strong", {}, n.title), ui.el("span", { class: "nc-time" }, ui.relTime(n.ts))),
            n.body ? ui.el("div", { class: "nc-body" }, n.body) : null,
            (n.actions.length && n.status !== "acted" && (!n.taskId || tasks.get(n.taskId))) ? ui.el("div", { class: "toast-actions" }, n.actions.map((a, i) =>
              ui.el("button", { class: "btn sm " + (i === 0 ? "primary" : "ghost"), type: "button", onclick: async () => { await notify.act(n.id, a.id); render(); } }, a.label))) : null),
          ui.el("button", { class: "icon-btn sm", type: "button", "aria-label": "Remove notification", html: ui.icon("close", 16), onclick: () => { notify.dismiss(n.id); } }));
        list.append(row);
      });
      footer.innerHTML = "";
      footer.append(ui.el("button", { class: "btn sm ghost", type: "button", onclick: () => { sh.close(); D.require("settings").then(s => s.open("notifications")); } }, ui.el("span", { html: ui.icon("sliders", 16) }), "Notification settings"));
    }
    render();
    notify.markAllSeen();
    return sh;
  }

  /* ---------------- tasks: "My day" ---------------- */
  async function openTasks(){
    const sh = ui.sheet({ title: "My day", className: "tasks" });
    const body = sh.body;
    const off = bus.on("tasks:changed", render);
    sh.closed.then(off);

    function rowFor(i){
      const t = tasks.get(i.taskId);
      const st = i.status, overdue = tasks.isOverdue(i);
      const row = ui.el("div", { class: "row task-row s-" + st + (overdue ? " overdue" : "") },
        ui.el("button", { class: "tick" + (st === "done" ? " on" : ""), type: "button", "aria-label": st === "done" ? "Mark not done" : "Mark done", onclick: () => { st === "done" ? tasks.reopen(i.taskId, i.dateKey) : tasks.complete(i.taskId, i.dateKey); }, html: st === "done" ? ui.icon("check", 18) : "" }),
        ui.el("div", { class: "grow" },
          ui.el("div", { class: "t" }, (i.emoji ? i.emoji + " " : "") + i.title),
          ui.el("div", { class: "s" }, `${ui.fmtTime(i.start)} · ${i.durationMin} min` + (i.recurring ? " · repeats" : "") + (overdue ? " · slipped" : "") + (st === "skipped" ? " · skipped" : "") + (st === "missed" ? " · missed" : ""))),
        ui.el("div", { class: "task-acts" },
          (st === "pending" || st === "active" || st === "missed") ? ui.el("button", { class: "icon-btn sm", type: "button", "aria-label": "Start " + i.title, html: ui.icon("play", 16), onclick: () => { sh.close(); tasks.start(i.taskId, i.dateKey); bus.emit("task:start-requested", { taskId: i.taskId, key: i.dateKey }); } }) : null,
          (st !== "done") ? ui.el("button", { class: "icon-btn sm", type: "button", "aria-label": "Reschedule " + i.title, html: ui.icon("clock", 16), onclick: () => notify.rescheduleFlow(i.taskId, i.dateKey) }) : null,
          ui.el("button", { class: "icon-btn sm", type: "button", "aria-label": "Delete " + i.title, html: ui.icon("trash", 16), onclick: async () => { const v = await ui.popup({ title: "Delete this task?", text: t && t.recurrence ? "This removes the whole repeating task." : "This can't be undone.", actions: [{ label: "Keep", value: "no" }, { label: "Delete", value: "yes", kind: "primary" }], dismissValue: "no" }); if(v === "yes") tasks.remove(i.taskId); } })));
      return row;
    }

    function render(){
      body.innerHTML = "";
      const today = tasks.instancesForDate(ui.dateKey());
      const tmr = tasks.instancesForDate(ui.dateKey(new Date(Date.now() + 864e5)));
      body.append(ui.el("div", { class: "section-title" }, "Today"));
      if(!today.length) body.append(ui.el("p", { class: "hint" }, "Nothing scheduled today."));
      today.forEach(i => body.append(rowFor(i)));
      const un = tasks.unscheduled();
      if(un.length){
        body.append(ui.el("div", { class: "section-title" }, "Needs a time"));
        un.forEach(t => body.append(ui.el("div", { class: "row" }, ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, t.title), ui.el("div", { class: "s" }, t.durationMin + " min")),
          ui.el("button", { class: "btn sm primary", type: "button", onclick: () => notify.rescheduleFlow(t.id) }, "Find a slot"),
          ui.el("button", { class: "icon-btn sm", type: "button", "aria-label": "Delete " + t.title, html: ui.icon("trash", 16), onclick: () => tasks.remove(t.id) }))));
      }
      if(tmr.length){ body.append(ui.el("div", { class: "section-title" }, "Tomorrow")); tmr.forEach(i => body.append(rowFor(i))); }

      // add form
      const title = ui.el("input", { class: "field", type: "text", placeholder: "Add a task…", "aria-label": "Task name", autocomplete: "off" });
      const time = ui.el("input", { class: "field", type: "time", "aria-label": "Time (optional)", style: "max-width:130px" });
      const add = () => {
        const v = title.value.trim(); if(!v) return;
        const p = { title: v, source: "manual" };
        if(time.value){ const [h, m] = time.value.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); if(d < new Date()) d.setDate(d.getDate() + 1); p.dueAt = d.toISOString(); }
        tasks.add(p);
        if(p.dueAt) setTimeout(() => D.app && notify.settings().system === false && "Notification" in window && Notification.permission === "default" && notify.enableSystem(), 1200);
      };
      title.addEventListener("keydown", e => { if(e.key === "Enter") add(); });
      body.append(ui.el("div", { class: "row" }, title, time, ui.el("button", { class: "btn sm primary", type: "button", onclick: add }, "Add")));
      body.append(ui.el("p", { class: "hint" }, "Leave the time empty and I'll find you a slot when you ask."));
    }
    render();
    return sh;
  }

  window.DABSy.notifcenter = { open, openTasks };
})();
