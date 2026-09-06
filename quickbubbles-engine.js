/* ============================================================
   D.A.B.S.y — quickbubbles-engine.js
   Double-tap the EYES -> 4 small quick-action bubbles (lightweight).
   Double-tap the BOW TIE -> the full World menu (handled elsewhere).
   Kept deliberately tiny: no navigation, no settings, just fast
   day-to-day actions.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const emotion = window.DABSy.emotion;
  const face = document.getElementById("face");
  const container = document.getElementById("quick-bubbles");
  const backdrop = document.getElementById("quick-bubbles-backdrop");

  const ACTIONS = [
    { id:"next", icon:"⏭️", label:"What's next", angle:-55 },
    { id:"note", icon:"📝", label:"Quick note", angle:-18 },
    { id:"pet",  icon:"🐾", label:"Pet DABSy",   angle:18  },
    { id:"play", icon:"🎮", label:"Play",        angle:55  },
  ];

  let built = false;
  function build(){
    if(built) return;
    built = true;
    ACTIONS.forEach(a=>{
      const btn = document.createElement("button");
      btn.className = "qb-bubble";
      btn.dataset.action = a.id;
      btn.innerHTML = `<span class="qb-icon">${a.icon}</span><span>${a.label}</span>`;
      container.appendChild(btn);
      btn.addEventListener("click", ()=>{ close(); handle(a.id); });
    });
  }

  function position(){
    const rect = face.getBoundingClientRect();
    const cx = rect.left + rect.width/2;
    const cy = rect.top + rect.height/2;
    const radius = Math.min(160, window.innerWidth*0.36);
    container.querySelectorAll(".qb-bubble").forEach((btn)=>{
      const a = ACTIONS.find(x=>x.id===btn.dataset.action);
      const rad = (a.angle - 90) * Math.PI/180;
      const tx = Math.cos(rad) * radius;
      const ty = Math.sin(rad) * radius - 40; // arc sits above the face
      btn.style.left = cx + "px";
      btn.style.top = cy + "px";
      btn.style.setProperty("--tx", tx.toFixed(0)+"px");
      btn.style.setProperty("--ty", ty.toFixed(0)+"px");
    });
  }

  function open(){
    build();
    position();
    container.classList.add("open");
    emotion.flashExpression("curious", 600);
  }
  function close(){
    container.classList.remove("open");
  }

  backdrop.addEventListener("click", close);

  bus.on("face:doubletap", ()=>{
    if(container.classList.contains("open")) close(); else open();
  });
  bus.on("world:opened", close); // if the full menu opens for any reason, don't overlap

  function handle(action){
    if(action === "next"){
      const next = window.DABSy.schedule.getNextItem();
      const text = next
        ? `Next up: ${next.title} at ${next.start.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}.`
        : "Nothing else on your schedule for today.";
      bus.emit("dabsy:say", { text });
    }
    if(action === "note"){
      bus.emit("quickbubbles:focus-input");
    }
    if(action === "pet"){
      emotion.nudge("affection", 0.08);
      emotion.nudge("happiness", 0.06);
      emotion.flashExpression("happy", 1300);
      const lines = ["That's nice.", "Mm, more of that.", "I appreciate you.", "Feeling good today."];
      bus.emit("dabsy:say", { text: lines[Math.floor(Math.random()*lines.length)] });
    }
    if(action === "play"){
      bus.emit("world:open", { tab: "play" });
    }
  }

  window.addEventListener("resize", ()=>{ if(container.classList.contains("open")) position(); });

  window.DABSy = window.DABSy || {};
  window.DABSy.quickbubbles = { open, close };
})();
