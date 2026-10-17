/* viewport-engine.js — keyboard-aware layout (v10.3: predictive + compositor-only).
   Publishes --kb (keyboard height), --kbs (how far the chat dock must rise: a transform, not a layout change),
   --vvh, and body.kb-open. window.DABSy.viewport exposes the same numbers to the world engine.

   Why the keyboard felt slow (v10.2 and earlier):
     1. Nothing moved until the browser reported the FINAL keyboard height, i.e. after the keyboard was already up.
     2. The dock moved by changing `bottom` (layout), DABSy then glided in three separate moves (open chat, kb-open,
        a correction after the keyboard settled), each 0.5–1.4 s.
   Now:
     - On focus of an input we start the move IMMEDIATELY with a predicted height (the last real height we measured
       on this phone, stored locally; otherwise 42 % of the screen). The real value then only nudges it by a few px.
       If no keyboard appears (hardware keyboard) the prediction is withdrawn after 0.7 s.
     - The dock rises with transform: translate3d (GPU only). DABSy makes ONE 0.3 s move straight to her final place.
     - One rAF-coalesced reader, writes only on real change, no scroll listener, listeners registered once. */
(function(){
  if(window.__dabsyViewport) return; window.__dabsyViewport = true;
  const root = document.documentElement, vv = window.visualViewport, body = document.body;
  window.DABSy = window.DABSy || {};
  const KEY = "dabsy_kbh";
  let raf = 0, kb = 0, vvhLast = -1, moveTimer = 0, settleTimer = 0, predTimer = 0, predicted = false;
  let learned = 0; try{ learned = Number(localStorage.getItem(KEY)) || 0; }catch(_){}
  // safe-area-inset-bottom in px (CSS env() can't be read from a custom property, so probe it once)
  const probe = document.createElement("div"); probe.style.cssText = "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(probe);
  const sab = () => parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  const guess = () => learned >= 200 ? learned : Math.round(Math.min(window.innerHeight * .42, 340));
  const shiftFor = k => k > 0 ? Math.max(0, Math.round(k + 8 - (.05 * window.innerHeight + sab()))) : 0;

  function markMoving(){
    body.classList.add("kb-moving"); clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { body.classList.remove("kb-moving"); document.dispatchEvent(new Event("dabsy:kbsettled")); }, 380);
  }
  function apply(k, isPrediction){
    if(Math.abs(k - kb) < 4 && (k > 0) === (kb > 0)) { return; }
    const opening = k > 0 && kb === 0;
    kb = k; markMoving();
    root.style.setProperty("--kb", k + "px"); root.style.setProperty("--kbs", shiftFor(k) + "px");
    body.classList.toggle("kb-open", k > 0);
    document.dispatchEvent(new CustomEvent("dabsy:kb", { detail: { kb: k, predicted: !!isPrediction } }));
    if(opening) keepFocusedVisible();
  }
  function measure(){
    raf = 0;
    const layoutH = window.innerHeight, vh = vv ? vv.height : layoutH, top = vv ? vv.offsetTop : 0;
    const vvh = Math.round(vh / 4) * 4;
    if(vvh !== vvhLast){ vvhLast = vvh; root.style.setProperty("--vvh", vvh + "px"); }
    let real = Math.max(0, Math.round(layoutH - vh - top));
    if(real < 80) real = 0;                                     // browser-chrome resize, not a keyboard
    real = Math.round(real / 4) * 4;
    if(real > 0){
      predicted = false; clearTimeout(predTimer);
      if(Math.abs(real - learned) > 8){ learned = real; try{ localStorage.setItem(KEY, String(real)); }catch(_){} }
      apply(real, false);
    } else if(!predicted){ apply(0, false); }
  }
  const schedule = () => { if(!raf) raf = requestAnimationFrame(measure); };
  const isField = el => !!el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable) && !(el.type && /^(checkbox|radio|button|range|color|file)$/.test(el.type));
  function keepFocusedVisible(){
    const el = document.activeElement; if(!isField(el)) return;
    const sheet = el.closest && el.closest(".sheet-body");
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { if(sheet){ try{ el.scrollIntoView({ block: "nearest", inline: "nearest" }); }catch(_){} } }, 240);
  }
  /* start moving the moment a field is focused, before the keyboard has finished appearing */
  document.addEventListener("focusin", e => {
    if(!isField(e.target)) return;
    if(kb === 0){
      predicted = true; apply(guess(), true);
      clearTimeout(predTimer);
      predTimer = setTimeout(() => { if(predicted){ predicted = false; schedule(); } }, 700);   // no keyboard came: withdraw
    }
    setTimeout(schedule, 120);
  }, { passive: true });
  document.addEventListener("focusout", () => { setTimeout(() => { if(!isField(document.activeElement)){ predicted = false; clearTimeout(predTimer); schedule(); } }, 140); }, { passive: true });
  if(vv) vv.addEventListener("resize", schedule, { passive: true }); else window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(schedule, 250), { passive: true });
  window.DABSy.viewport = { kb: () => kb, shift: () => shiftFor(kb), sab, chatBottomGap: () => kb > 0 ? kb + 8 : .05 * window.innerHeight + sab() };
  measure();
})();
