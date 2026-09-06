/* ============================================================
   D.A.B.S.y — entertainment-engine.js
   Small discoverable games/tricks in the Play tab.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const emotion = window.DABSy.emotion;
  const body = document.getElementById("play-body");
  const buttons = document.querySelectorAll("[data-game]");

  function reactionGame(){
    body.innerHTML = `<p class="hint">Tap the eyes the instant they flash bright.</p><button class="util-btn" id="reaction-arm">Start</button><div id="reaction-result" style="margin-top:8px;"></div>`;
    document.getElementById("reaction-arm").onclick = ()=>{
      const result = document.getElementById("reaction-result");
      result.textContent = "Get ready…";
      const delay = 900 + Math.random()*2200;
      const start = Date.now();
      setTimeout(()=>{
        emotion.flashExpression("surprised", 1200);
        bus.emit("face:recoil");
        const readyAt = Date.now();
        const onTap = ()=>{
          const rt = Date.now() - readyAt;
          result.textContent = `${rt} ms`;
          bus.off("face:tap", onTap);
        };
        bus.on("face:tap", onTap);
      }, delay);
    };
  }

  function guessGame(){
    const target = 1 + Math.floor(Math.random()*20);
    body.innerHTML = `
      <p class="hint">I'm thinking of a number from 1–20.</p>
      <div style="display:flex; gap:8px;">
        <input id="guess-input" type="number" min="1" max="20" style="flex:1; background:var(--glass-strong); border:1px solid var(--glass-border); border-radius:12px; padding:10px; color:var(--ink);" />
        <button class="util-btn" id="guess-go">Guess</button>
      </div>
      <div id="guess-result" style="margin-top:8px;"></div>
    `;
    document.getElementById("guess-go").onclick = ()=>{
      const val = Number(document.getElementById("guess-input").value);
      const result = document.getElementById("guess-result");
      if(!val){ return; }
      if(val === target){ result.textContent = "Got it! 🎉"; emotion.flashExpression("proud", 1500); }
      else if(val < target){ result.textContent = "Higher."; }
      else { result.textContent = "Lower."; }
    };
  }

  function focusGame(){
    body.innerHTML = `<p class="hint">Watch closely — DABSy will glance somewhere. Guess left or right before it settles.</p>
      <button class="util-btn" id="focus-go">Watch</button>
      <div id="focus-result" style="margin-top:8px;"></div>`;
    document.getElementById("focus-go").onclick = ()=>{
      const goLeft = Math.random() < 0.5;
      window.DABSy.face.lookAt(goLeft ? 40 : window.innerWidth-40, window.innerHeight/2);
      document.getElementById("focus-result").textContent = "…";
      setTimeout(()=>{
        document.getElementById("focus-result").textContent = goLeft ? "Looked left." : "Looked right.";
      }, 900);
    };
  }

  buttons.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const g = btn.dataset.game;
      if(g === "reaction") reactionGame();
      if(g === "guess") guessGame();
      if(g === "focus") focusGame();
    });
  });

  window.DABSy = window.DABSy || {};
  window.DABSy.entertainment = { reactionGame, guessGame, focusGame };
})();
