/* ============================================================
   D.A.B.S.y — settings-engine.js
   One sheet, grouped sections. Opened from the Settings bubble.
   There is deliberately NO API-key field: the AI row only shows status.
   ============================================================ */
(function(){
  const D = window.DABSy;
  const ui = D.ui, memory = D.memory, bus = D.bus;
  const el = ui.el;
  const VERSION = D.config.version;
  let devTaps = 0, devTimer = null;

  function switchRow(title, sub, checked, onChange, extra){
    const input = el("input", { type: "checkbox", "aria-label": title }); input.checked = !!checked;
    input.addEventListener("change", () => onChange(input.checked, input));
    return el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, title), sub ? el("div", { class: "s" }, sub) : null), extra || null, el("label", { class: "switch" }, input, el("i")));
  }
  function section(id, title, ...kids){
    return el("section", { id: "set-" + id, class: "set-sec" }, el("div", { class: "section-title" }, title), ...kids);
  }

  async function open(which){
    const sh = ui.sheet({ title: "Settings", className: "settings", onClose: () => offs.forEach(f => f()) });
    const offs = [];
    const body = sh.body;

    /* ---------- DABSy AI ---------- */
    const aiRow = el("div", { class: "row" });
    const aiChip = el("span", { class: "chip" });
    const aiDetail = el("div", { class: "s" });
    function paintAI(){
      const i = D.ai.statusInfo();
      aiChip.className = "chip " + (i.state === "ready" ? "ok" : i.state === "checking" ? "" : "warn");
      aiChip.textContent = i.label;
      aiDetail.textContent = i.state === "ready" ? "Chat, explanations and web research are available." : i.detail + " Planning, tasks and reminders still work.";
    }
    aiRow.append(el("span", { html: ui.icon("sparkle", 22) }), el("div", { class: "grow" }, el("div", { class: "t" }, "DABSy AI"), aiDetail), aiChip);
    paintAI(); offs.push(bus.on("ai:status", paintAI));
    const aiBtn = el("button", { class: "btn sm ghost", type: "button", onclick: () => { D.ai.check(); } }, "Check again");
    const aiNote = el("p", { class: "hint" }, "There's nothing to set up on your side. The AI runs through DABSy's own service, so no keys live in this app.");

    /* ---------- wardrobe ---------- */
    const wardrobe = el("div", {});
    function paintWardrobe(){
      wardrobe.innerHTML = "";
      const cur = D.outfits.current();
      const grid = el("div", { class: "wd-grid" });
      D.outfits.list().forEach(o => {
        const hidden = !o.unlocked && (o.unlock && o.unlock.type === "egg");
        const tile = el("button", { class: "wd-tile" + (cur.outfit === o.id ? " on" : "") + (o.equippable ? "" : " locked"), type: "button", "aria-pressed": String(cur.outfit === o.id),
          "aria-label": (hidden ? "Mystery outfit" : o.name) + (o.equippable ? "" : ", " + (o.note || "locked")),
          onclick: () => { if(!o.equippable){ ui.toast({ text: o.note || "Locked" }); return; } D.outfits.equipOutfit(o.id); D.face.react("perk"); paintWardrobe(); } });
        tile.innerHTML = (hidden ? '<div class="wd-q">?</div>' : D.outfits.preview(o.id)) + `<span class="wd-name">${hidden ? "Mystery" : ui.escapeHtml(o.name)}</span>` + (o.equippable ? "" : `<span class="wd-note">${ui.escapeHtml(o.note || "")}</span>`);
        grid.append(tile);
      });
      wardrobe.append(grid);
      wardrobe.append(el("div", { class: "section-title" }, "Accessories"));
      const accGrid = el("div", { class: "wd-grid" });
      D.outfits.listAccessories().forEach(a => {
        const on = cur.acc[a.slot] === a.id;
        const hidden = !a.unlocked && a.unlock && a.unlock.type === "egg";
        const tile = el("button", { class: "wd-tile" + (on ? " on" : "") + (a.equippable ? "" : " locked"), type: "button", "aria-pressed": String(on), "aria-label": (hidden ? "Mystery accessory" : a.name) + (a.equippable ? "" : ", " + (a.note || "locked")),
          onclick: () => { if(!a.equippable){ ui.toast({ text: a.note || "Locked" }); return; } D.outfits.equipAccessory(a.slot, on ? null : a.id); paintWardrobe(); } });
        tile.innerHTML = (hidden ? '<div class="wd-q">?</div>' : D.outfits.preview(a.id, true)) + `<span class="wd-name">${hidden ? "Mystery" : ui.escapeHtml(a.name)}</span>` + (a.equippable ? "" : `<span class="wd-note">${ui.escapeHtml(a.note || "")}</span>`);
        accGrid.append(tile);
      });
      wardrobe.append(accGrid, el("p", { class: "hint" }, "Some things unlock by using DABSy. A few are hidden."));
    }
    paintWardrobe();

    /* ---------- notifications ---------- */
    const ns = D.notify.settings();
    const permChip = el("span", { class: "chip" });
    D.permissions.describe("notifications").then(d => { permChip.textContent = d.text; permChip.className = "chip " + (d.state === "granted" ? "ok" : d.state === "denied" ? "bad" : ""); });
    const qFrom = el("input", { class: "field", type: "time", value: ns.quiet.from, "aria-label": "Quiet hours start" });
    const qTo = el("input", { class: "field", type: "time", value: ns.quiet.to, "aria-label": "Quiet hours end" });
    const saveQuiet = () => D.notify.saveSettings({ quiet: { from: qFrom.value || "22:00", to: qTo.value || "07:00" } });
    qFrom.onchange = saveQuiet; qTo.onchange = saveQuiet;
    const limit = el("select", { class: "field", "aria-label": "Maximum nudges per day" }, [2, 4, 6, 8, 12].map(n => el("option", { value: n }, n + " a day")));
    limit.value = String(ns.dailyLimit); limit.onchange = () => D.notify.saveSettings({ dailyLimit: Number(limit.value) });
    const notifSection = section("notifications", "Notifications",
      switchRow("Nudges from DABSy", "Gentle follow-ups about tasks. They adapt if you ignore them.", ns.enabled, v => D.notify.saveSettings({ enabled: v })),
      switchRow("Alerts when DABSy is in the background", "Uses your phone's own notifications. Works while the app is open or recently used. A web app can't wake itself when fully closed.", ns.system && Notification.permission === "granted", async (v, input) => {
        if(v){ const ok = await D.notify.enableSystem(); input.checked = ok; D.permissions.describe("notifications").then(d => { permChip.textContent = d.text; permChip.className = "chip " + (d.state === "granted" ? "ok" : d.state === "denied" ? "bad" : ""); }); }
        else D.notify.saveSettings({ system: false });
      }, permChip),
      el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, "Quiet hours"), el("div", { class: "s" }, "No nudges in this window.")), qFrom, qTo),
      el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, "Most nudges per day")), limit),
      el("button", { class: "btn sm ghost", type: "button", onclick: () => D.notify.push({ kind: "info", title: "Test nudge", body: "This is what a nudge looks like.", actions: [{ id: "keep", label: "Nice" }] }) }, "Send a test nudge"));

    /* ---------- study & learning ---------- */
    const learnBox = el("div", {});
    function paintLearn(){
      learnBox.innerHTML = "";
      const sn = D.learning.snapshot();
      learnBox.append(el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, "What I've noticed"),
        el("div", { class: "s" }, sn.sessions || sn.types.length ? (sn.summary || "Not enough yet to say anything.") + (sn.sessions ? ` Typical focus block: ${sn.blockMin} min.` : "") : "Nothing yet. I learn from the material you choose and how your sessions go.")),
        el("button", { class: "btn sm ghost", type: "button", onclick: async () => { const v = await ui.popup({ title: "Reset what I've learned?", text: "Your tasks and sessions stay. Only my notes about your study habits are cleared.", actions: [{ label: "Keep", value: "no" }, { label: "Reset", value: "yes", kind: "primary" }], dismissValue: "no" }); if(v === "yes"){ D.learning.reset(); paintLearn(); } } }, "Reset")));
    }
    paintLearn();
    const studySection = section("study", "Study & learning",
      switchRow("Learn my study habits", "Material types you pick, usual block length, usual hours. Never what you type.", memory.getSettings().learnHabits !== false, v => memory.saveSettings({ learnHabits: v })),
      switchRow("Use that to personalise AI answers", "Adds a one-line summary of your habits to AI requests.", memory.getSettings().personalizeAI, v => memory.saveSettings({ personalizeAI: v })),
      switchRow("Encouragement between blocks", "Short, text-only cheers.", memory.getSettings().cheer, v => memory.saveSettings({ cheer: v })),
      learnBox);

    /* ---------- voice ---------- */
    const sel = el("select", { class: "field", "aria-label": "DABSy's voice" });
    const fillVoices = () => { sel.innerHTML = ""; sel.append(el("option", { value: "" }, "Automatic")); D.voice.getVoices().forEach(v => sel.append(el("option", { value: v.voiceURI }, v.name + " (" + v.lang + ")"))); sel.value = memory.getSettings().voiceURI || ""; };
    fillVoices(); offs.push(bus.on("voice:voices-ready", fillVoices)); sel.onchange = () => memory.saveSettings({ voiceURI: sel.value });
    const voiceSection = section("voice", "Voice",
      switchRow("DABSy speaks replies", "Text always shows. Turn this off for silent replies.", memory.getSettings().speakReplies, v => memory.saveSettings({ speakReplies: v })),
      el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, "Voice")), sel));

    /* ---------- accessibility ---------- */
    const rm = el("select", { class: "field", "aria-label": "Reduce motion" }, [["auto", "Follow my device"], ["on", "Always reduce"], ["off", "Never reduce"]].map(([v, l]) => el("option", { value: v }, l)));
    rm.value = memory.getSettings().reduceMotion; rm.onchange = () => memory.saveSettings({ reduceMotion: rm.value });
    const a11y = section("access", "Accessibility",
      switchRow("Show on-screen buttons for gestures", "Adds Apps and Talk buttons, so nothing needs a double-tap or long-press. Keyboard: Enter = tap, ↓ = apps, ↑ = commands.", memory.getSettings().showShortcuts, v => memory.saveSettings({ showShortcuts: v })),
      el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, "Reduce motion"), el("div", { class: "s" }, "Calmer creature, no bobbing bubbles.")), rm));

    /* ---------- connections ---------- */
    const conn = el("div", {});
    (async () => {
      const Core = window.DABSyCore, c = Core.getConnections().calendar;
      const lvl = el("select", { class: "field", "aria-label": "Calendar permission level" }, [["read", "Read only: I can see events"], ["suggest", "Suggest: I ask before changing anything"], ["automatic", "Automatic: I can add events"]].map(([v, l]) => el("option", { value: v }, l)));
      lvl.value = c.level || "read"; lvl.onchange = () => Core.setConnection("calendar", { level: lvl.value });
      conn.append(switchRow("🌿 Ghibli Calendar", "Off by default. Lets me avoid clashes and, if you allow, add events.", c.enabled, v => Core.setConnection("calendar", { enabled: v })), el("div", { class: "row" }, el("div", { class: "grow s" }, "Permission level"), lvl));
      for(const a of D.ecosystem.apps().filter(x => !x.builtin && x.id !== "calendar")){
        const chip = el("span", { class: "chip" }, "checking…");
        conn.append(el("div", { class: "row" }, el("span", { html: ui.icon(a.icon || "sparkle", 20) }), el("div", { class: "grow" }, el("div", { class: "t" }, a.name), el("div", { class: "s" }, "Shares data through this site's own storage")), chip));
        D.ecosystem.probe(a).then(ok => { chip.textContent = ok ? "Reachable" : "Not reachable"; chip.className = "chip " + (ok ? "ok" : "warn"); });
      }
    })();

    /* ---------- privacy & data ---------- */
    const priv = section("privacy", "Privacy & data",
      el("div", { class: "row" }, el("span", { html: ui.icon("device", 20) }), el("div", { class: "grow" }, el("div", { class: "t" }, "Stays on this device"), el("div", { class: "s" }, "Tasks, plans, sessions, outfits, settings, what I've learned, and my notification history."))),
      el("div", { class: "row" }, el("span", { html: ui.icon("cloud", 20) }), el("div", { class: "grow" }, el("div", { class: "t" }, "Sent to DABSy AI"), el("div", { class: "s" }, "Only what you ask me or what I need to plan: your message, the subject, and a short summary of your habits (if enabled). Never keys, contacts, or location."))),
      el("div", { class: "popup-actions", style: "justify-content:flex-start" },
        el("button", { class: "btn sm", type: "button", onclick: () => exportData() }, "Export my data"),
        el("button", { class: "btn sm danger", type: "button", onclick: async () => { const v = await ui.popup({ title: "Forget everything?", text: "This clears tasks, plans, sessions, outfits and everything I've learned on this device. It can't be undone.", actions: [{ label: "Keep", value: "no" }, { label: "Forget everything", value: "yes", kind: "primary" }], dismissValue: "no" }); if(v === "yes"){ memory.forgetEverything(); sh.close(); D.app.say("All clear. Fresh start.", "IDLE"); } } }, "Forget everything")));

    /* ---------- floating ---------- */
    const fl = D.floating.status();
    const floatSec = section("floating", "Floating DABSy",
      el("div", { class: "row" }, el("span", { html: ui.icon("device", 20) }), el("div", { class: "grow" }, el("div", { class: "t" }, fl.available ? "Available" : "Needs the Android app"), el("div", { class: "s" }, fl.reason)),
        el("span", { class: "chip " + (fl.available ? "ok" : "warn") }, fl.available ? "On" : "Not here")));

    /* ---------- help ---------- */
    const help = section("help", "Help & Tutorial",
      el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, "Replay Tutorial"), el("div", { class: "s" }, "A tiny tour of what I can do.")), el("button", { class: "btn sm primary", type: "button", onclick: () => { sh.close(); setTimeout(() => D.require("onboarding").then(o => o.start({ replay: true })), 300); } }, "Replay")),
      el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "t" }, "Gestures"), el("div", { class: "s" }, "Tap: say hi · Double-tap: your apps · Long-press: talk or type · Stroke: pet me. Everything has a button alternative in Accessibility."))));

    /* ---------- about ---------- */
    const installBtn = el("button", { class: "btn sm", type: "button", hidden: true, onclick: async () => { if(await D.pwa.promptInstall()) installBtn.hidden = true; } }, "Install app");
    if(D.pwa.canInstall()) installBtn.hidden = false;
    offs.push(bus.on("pwa:installable", () => { installBtn.hidden = false; }));
    const about = section("about", "About",
      el("div", { class: "row", onclick: devTap }, el("div", { class: "grow" }, el("div", { class: "t" }, "D.A.B.S.y " + VERSION), el("div", { class: "s" }, "A plush study companion and hub for your study apps.")), installBtn),
      el("button", { class: "btn sm ghost", type: "button", onclick: () => { sh.close(); D.require("games").then(g => g.open()); } }, "🎮 Play a little"));

    body.append(
      section("ai", "DABSy AI", aiRow, el("div", { class: "popup-actions", style: "justify-content:flex-start" }, aiBtn), aiNote),
      section("wardrobe", "Wardrobe", wardrobe),
      notifSection, studySection, voiceSection, a11y,
      section("connections", "Connections", conn),
      priv, floatSec, help, about);
    if(which) setTimeout(() => { const t = body.querySelector("#set-" + which); t && t.scrollIntoView({ block: "start", behavior: "smooth" }); }, 360);
    return sh;
  }

  /* hidden developer shortcut: tap the version 7 times to point DABSy at your own AI service URL.
     This is a plain https URL (the address of YOUR proxy), never a secret. */
  async function devTap(){
    devTaps++; clearTimeout(devTimer); devTimer = setTimeout(() => { devTaps = 0; }, 2500);
    if(devTaps < 7) return; devTaps = 0;
    const input = ui.el("input", { type: "text", placeholder: "https://your-service.example.workers.dev", "aria-label": "Service address", value: localStorage.getItem("dabsy_dev_proxy") || "" });
    const v = await ui.popup({ title: "Developer: service address", text: "The web address of your DABSy AI service (see BACKEND.md). Leave empty to clear. Reload afterwards.", content: input, actions: [{ label: "Cancel", value: "no" }, { label: "Save", value: "ok", kind: "primary" }], dismissValue: "no" });
    if(v !== "ok") return;
    const val = input.value.trim();
    try{
      if(!val) localStorage.removeItem("dabsy_dev_proxy");
      else if(/^https:\/\/[^\s]+$/i.test(val)) localStorage.setItem("dabsy_dev_proxy", val.replace(/\/+$/, ""));
      else { ui.toast({ text: "That doesn't look like an https address." }); return; }
      ui.toast({ text: "Saved. Reloading…" }); setTimeout(() => location.reload(), 900);
    }catch(e){}
  }

  function exportData(){
    const data = JSON.stringify({ app: "dabsy", version: VERSION, exportedAt: new Date().toISOString(), data: memory.exportAll() }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "dabsy-data-" + ui.dateKey() + ".json"; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    ui.toast({ text: "Exported. The file stays on your device." });
  }

  window.DABSy.settings = { open, exportData };
})();
