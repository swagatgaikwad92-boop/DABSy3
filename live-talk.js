/* ============================================================
   D.A.B.S.y — live-talk.js : hands-free conversation mode
   An honest request-response loop, not a streaming/realtime model:
     listen -> (your browser's speech recognition) -> DABSy replies -> reply is spoken -> listen again.
   States: listening | thinking | speaking.   Only exists where the browser has speech recognition.
   Limits (shown in the panel): recognition may need internet; you can't talk over DABSy
   (tap Stop / the panel to interrupt, it then listens at once); it ends itself after 3 quiet turns,
   when the app is hidden, or when you tap End. The microphone is only on while the panel says Listening.
   ============================================================ */
(function(){
  const D = window.DABSy, bus = D.bus, voice = D.voice, ui = D.ui;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const LABEL = { listening: "Listening", thinking: "Thinking", speaking: "Speaking" };
  let on = false, state = "", lastUser = "", fallbackT = 0, quiet = 0, relistenT = 0, safetyT = 0, wake = null, panel, status, said, stopBtn;

  function build(){
    panel = ui.el("section", { id: "live-talk", "aria-label": "Live talk", hidden: true },
      ui.el("div", { class: "lt-ring", "aria-hidden": "true" }),
      status = ui.el("div", { class: "lt-state", role: "status", "aria-live": "polite" }, ""),
      said = ui.el("div", { class: "lt-said" }, ""),
      ui.el("div", { class: "lt-actions" },
        stopBtn = ui.el("button", { class: "btn glass", type: "button", onclick: interrupt }, "Stop talking"),
        ui.el("button", { class: "btn glass primary", type: "button", onclick: () => stop() }, "End")),
      ui.el("p", { class: "lt-note" }, "Uses your browser's speech recognition, which may need internet. I reply after I've finished writing, so this isn't a streaming call."));
    document.getElementById("stage").append(panel);
    const btn = ui.el("button", { id: "live-btn", type: "button", "aria-label": "Start live talk (hands-free conversation)", onclick: toggle }, "");
    btn.innerHTML = ui.icon("sparkle", 20);
    document.getElementById("mic-btn").after(btn);
  }
  function set(s, text){
    state = s; panel.dataset.state = s;
    status.textContent = LABEL[s] || "";
    stopBtn.hidden = s !== "speaking";
    if(text !== undefined) said.textContent = text;
  }
  function listen(delay){
    clearTimeout(relistenT);
    relistenT = setTimeout(() => { if(!on) return; set("listening"); voice.startListening(); }, delay || 0);
  }
  async function start(){
    if(on) return;
    if(!SR){ bus.emit("dabsy:say", { text: "This browser can't do speech recognition, so live talk isn't available. Typing still works." }); return; }
    const r = await D.permissions.ensure("microphone", { reason: "Live talk needs the microphone. It only listens while the panel says Listening." });
    if(!r.granted){ if(r.declined) bus.emit("dabsy:say", { text: "No problem. You can type to me instead." }); return; }
    on = true; quiet = 0; panel.hidden = false; document.body.classList.add("live-talk");
    try{ if(navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); }catch(_){}   // keep the screen on while talking
    listen(0);
    if(D.ai && D.ai.status() === "limited") said.textContent = "AI isn't connected, so I can only help with tasks and reminders.";
  }
  function stop(msg){
    if(!on) return;
    on = false; clearTimeout(relistenT); clearTimeout(safetyT); clearTimeout(fallbackT);
    voice.stopListening(); voice.stopSpeaking();
    panel.hidden = true; document.body.classList.remove("live-talk");
    try{ wake && wake.release(); }catch(_){} wake = null;
    if(msg) bus.emit("dabsy:say", { text: msg });
  }
  const toggle = () => on ? stop() : start();
  function interrupt(){ voice.stopSpeaking(); listen(200); }

  bus.on("voice:heard", ({ text }) => {
    if(!on) return;
    quiet = 0; lastUser = text; set("thinking", "“" + text + "”");
    clearTimeout(safetyT);                                   // if no reply is ever spoken (muted / error), don't hang
    safetyT = setTimeout(() => { if(on && state === "thinking") listen(0); }, 20000);
  });
  bus.on("voice:listening:end", () => {
    if(!on || state !== "listening") return;                 // a result moves us to "thinking" first
    if(++quiet >= 3) stop("I stopped listening because it was quiet. Tap the sparkle to start again.");
    else listen(300);
  });
  bus.on("voice:error", ({ error }) => {
    if(!on) return;
    if(error === "not-allowed" || error === "service-not-allowed") stop("The microphone is blocked. You can allow it in your browser settings, or type to me.");
    else if(error === "network") stop("Speech recognition needs an internet connection and can't reach it right now.");
    else if(error === "audio-capture") stop("I can't find a working microphone.");
    // "no-speech" / "aborted" are normal: handled by the quiet counter above
  });
  /* Mirror DABSy's written reply into the panel (the normal subtitle is hidden in this mode) and make sure it is
     actually spoken — including the "I couldn't reach my thinking service" message when the AI is offline. */
  new MutationObserver(() => {
    const t = (document.getElementById("subtitle").textContent || "").trim();
    if(!on || state !== "thinking" || !t || t === lastUser || t === "Listening…") return;
    said.textContent = t; clearTimeout(fallbackT);
    fallbackT = setTimeout(() => {
      if(!on || state !== "thinking") return;
      if(D.memory.getSettings().speakReplies === false) listen(1500);   // text-only: show it, then carry on listening
      else { voice.speak(t); safetyT = setTimeout(() => { if(on && state === "thinking") listen(0); }, 5000); }   // speech never started (no voice installed?): carry on
    }, 1200);
  }).observe(document.getElementById("subtitle"), { childList: true, characterData: true, subtree: true });
  bus.on("voice:speaking:start", () => { if(on){ clearTimeout(safetyT); clearTimeout(fallbackT); voice.stopListening(); set("speaking"); } });
  bus.on("voice:speaking:end", () => { if(on && state === "speaking") listen(500); });   // short gap so DABSy doesn't hear its own voice
  document.addEventListener("visibilitychange", () => { if(document.hidden && on) stop(); });
  document.addEventListener("keydown", e => { if(e.key === "Escape" && on) stop(); });

  if(SR){ build(); } 
  D.liveTalk = { start, stop, toggle, supported: !!SR, isOn: () => on };
})();
