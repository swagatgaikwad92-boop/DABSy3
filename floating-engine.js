/* ============================================================
   D.A.B.S.y — floating-engine.js : the floating-DABSy boundary
   A PWA cannot draw over other apps. That needs a native Android app
   (SYSTEM_ALERT_WINDOW overlay permission + a foreground service) — see
   docs/FLOATING.md. This module is the seam between the two worlds:

     - it reports honestly whether floating mode is available here
     - when DABSy runs inside a native Android shell (WebView) that
       exposes `window.DABSyNative`, it pushes a tiny state snapshot
       (expression, outfit, unread count) so the native bubble can look
       like the creature, and it receives bubble taps back.

   In the browser/PWA nothing is faked: enable() returns {ok:false, reason}.
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const native = () => (typeof window.DABSyNative !== "undefined" && window.DABSyNative) || null;

  const REQUIREMENTS = [
    "A native Android app (Kotlin/Java) that hosts DABSy in a WebView or renders the creature natively.",
    "The 'Display over other apps' permission (SYSTEM_ALERT_WINDOW) granted by the user in Android settings.",
    "A foreground service with a persistent notification to keep the bubble alive.",
    "The bridge below: window.DABSyNative.postMessage(json) / window.DABSyFloating.receive(json).",
  ];
  const CONTRACT = {
    toNative: ["state {expression, outfit, acc, unread, quiet}", "show {}", "hide {}"],
    fromNative: ["bubble.tap", "bubble.longpress", "bubble.doubletap", "permission.overlay {granted}"],
  };

  function status(){
    const hasNative = !!native();
    return {
      available: hasNative,
      reason: hasNative ? "Running inside the DABSy Android app." : "Floating mode needs the Android app. A web app can't draw over other apps.",
      requirements: REQUIREMENTS,
    };
  }
  function send(type, data){ const n = native(); if(!n || !n.postMessage) return false; try{ n.postMessage(JSON.stringify({ type, data, at: Date.now() })); return true; }catch(e){ return false; } }

  function snapshot(){
    const o = window.DABSy.outfits ? window.DABSy.outfits.current() : null;
    return {
      expression: (document.getElementById("face").className.match(/exp-(\w+)/) || [])[1] || "neutral",
      outfit: o && o.outfit, acc: o && o.acc,
      unread: window.DABSy.notify ? window.DABSy.notify.unread() : 0,
      quiet: window.DABSy.context.isQuiet(),
    };
  }
  function enable(){
    if(!native()) return { ok: false, reason: status().reason };
    send("show", {}); send("state", snapshot());
    return { ok: true };
  }
  function disable(){ if(native()) send("hide", {}); }

  if(native()){
    bus.on("expression:set", () => send("state", snapshot()));
    bus.on("outfit:changed", () => send("state", snapshot()));
    bus.on("notify:inbox", () => send("state", snapshot()));
  }
  window.DABSyFloating = {
    receive(json){
      let m = json; if(typeof json === "string"){ try{ m = JSON.parse(json); }catch(e){ return; } }
      if(m.type === "bubble.tap") bus.emit("face:tap", { count: 1, region: "body" });
      if(m.type === "bubble.doubletap") bus.emit("face:doubletap", { region: "body" });
      if(m.type === "bubble.longpress") bus.emit("face:longpress", { region: "body" });
    },
  };
  window.DABSy.floating = { status, enable, disable, snapshot, REQUIREMENTS, CONTRACT };
})();
