/* viewport-engine.js — keyboard-aware layout (v11.1: cheap by design).
   Publishes --kb (keyboard height) and --vvh (visible height), and toggles body.kb-open.

   What changed from v11 (root causes of the keyboard lag, all on the main thread while the keyboard animates):
     - it used to call scrollIntoView({behavior:"smooth"}) and rewrite a chat-log scrollTop on every keyboard resize.
       That smooth scroll fights the resize, and each step forced layout. The dock is position:fixed-style and is lifted by --kb,
       so the field is already visible: nothing needs scrolling, and nothing scrolls now.
     - it wrote --vvh on every visualViewport event (every frame of the keyboard animation), invalidating every rule that reads it.
       --vvh is now written once, after the keyboard has settled. --kb is written only when it moved by 2px or more.
     - it scheduled four extra timers per focus/blur (setTimeout 120/300 ms) that re-measured the layout. Gone: one rAF-coalesced
       measure per real viewport event is enough.
   Nothing here reads layout (no getBoundingClientRect / offsetHeight), so it never forces a synchronous reflow. */
(function(){
  const root = document.documentElement, vv = window.visualViewport;
  let raf = 0, lastKb = -1, lastVvh = -1, settleT = 0, kbOpen = false;
  const body = document.body;
  function measure(){
    raf = 0;
    const layoutH = window.innerHeight;
    const vh = vv ? vv.height : layoutH;
    const top = vv ? vv.offsetTop : 0;
    // keyboard = the part of the layout viewport the visual viewport no longer covers
    let kb = Math.max(0, Math.round(layoutH - vh - top));
    if(kb < 80) kb = 0;                                   // browser-chrome resize, not a keyboard
    if(kb !== lastKb && (lastKb < 0 || Math.abs(kb - lastKb) >= 2 || kb === 0)){
      lastKb = kb;
      root.style.setProperty("--kb", kb + "px");
    }
    const open = kb > 0;
    if(open !== kbOpen){ kbOpen = open; body.classList.toggle("kb-open", open); }
    clearTimeout(settleT);
    settleT = setTimeout(() => {                          // once the keyboard animation has finished
      const v = Math.round(vv ? vv.height : window.innerHeight);
      if(v !== lastVvh){ lastVvh = v; root.style.setProperty("--vvh", v + "px"); }
    }, 140);
  }
  function schedule(){ if(!raf) raf = requestAnimationFrame(measure); }
  if(vv){ vv.addEventListener("resize", schedule, { passive: true }); }
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  measure();
  window.DABSy = window.DABSy || {};
  window.DABSy.viewport = { keyboard: () => (lastKb > 0 ? lastKb : 0) };
})();
