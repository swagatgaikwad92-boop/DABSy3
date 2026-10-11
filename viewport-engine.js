/* viewport-engine.js — keyboard-aware layout.
   Tracks the visual viewport and publishes --kb (keyboard height), --vvh (visible height).
   Chat dock and sheets lift above the keyboard via CSS; the focused field is kept in view. */
(function(){
  const root = document.documentElement, vv = window.visualViewport;
  let raf = 0, lastKb = -1;
  function measure(){
    raf = 0;
    const layoutH = window.innerHeight;
    const vh = vv ? vv.height : layoutH;
    const top = vv ? vv.offsetTop : 0;
    // keyboard = part of the layout viewport that the visual viewport no longer covers
    let kb = Math.max(0, Math.round(layoutH - vh - top));
    if(kb < 80) kb = 0;                                   // browser-chrome resize, not a keyboard
    root.style.setProperty("--vvh", vh + "px");
    if(kb === lastKb) return;
    lastKb = kb;
    root.style.setProperty("--kb", kb + "px");
    document.body.classList.toggle("kb-open", kb > 0);
    if(kb > 0) keepFocusedVisible();
  }
  function schedule(){ if(!raf) raf = requestAnimationFrame(measure); }
  function keepFocusedVisible(){
    const el = document.activeElement;
    if(!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName) && !el.isContentEditable) return;
    setTimeout(() => { try{ el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); }catch(_){} }, 60);
    const log = document.getElementById("chat-log") || document.querySelector(".sheet-body");
    if(log) log.scrollTop = log.scrollHeight;
  }
  if(vv){ vv.addEventListener("resize", schedule); vv.addEventListener("scroll", schedule); }
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", () => setTimeout(schedule, 250));
  document.addEventListener("focusout", () => setTimeout(schedule, 120));
  document.addEventListener("focusin", () => setTimeout(schedule, 300));
  measure();
})();
