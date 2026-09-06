/* ============================================================
   D.A.B.S.y — boot.js
   Runs last. Plays the wake-up choreography, then greets and
   asks about the day — mentioning the next scheduled item if
   there already is one, so the butler side feels alive from
   the very first moment.
   ============================================================ */

(function(){
  document.body.classList.add("booting");

  function greeting(){
    const next = window.DABSy.schedule?.getNextItem?.();
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    if(next){
      const t = next.start.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
      return `${timeGreeting}! You've got "${next.title}" at ${t} today — anything else on your plate?`;
    }
    return `${timeGreeting}! Nothing on your schedule yet — what's today looking like?`;
  }

  window.addEventListener("load", ()=>{
    setTimeout(async ()=>{
      document.body.classList.remove("booting");
      await window.DABSy.face.playWakeSequence();
      window.DABSy.app.say(greeting(), "HAPPY");
    }, 300);
  });
})();
