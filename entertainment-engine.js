/* ============================================================
   D.A.B.S.y — entertainment-engine.js : a few tiny games
   Opened from Settings → About → Play a little (and by an Easter egg).
   Rewritten for v7: v6 rendered into a Play tab that no longer exists.
   ============================================================ */
(function(){
  const D = window.DABSy;
  const ui = D.ui, el = ui.el, bus = D.bus, emotion = D.emotion;

  function open(){
    const sh = ui.sheet({ title: "Play a little" });
    const stage = el("div", { class: "game-stage" });
    const menu = el("div", { class: "hub-list" },
      gameRow("⚡", "Reaction test", "Tap the moment my eyes flash.", reaction),
      gameRow("🔢", "Guess the number", "I'm thinking of 1 to 20.", guess),
      gameRow("👀", "Follow the eye", "Guess which way I'll look.", follow));
    sh.body.append(menu, stage);
    function gameRow(icon, t, s, fn){ return el("button", { class: "row", type: "button", style: "text-align:left", onclick: () => { stage.innerHTML = ""; fn(stage); } }, el("span", { style: "font-size:1.4rem" }, icon), el("div", { class: "grow" }, el("div", { class: "t" }, t), el("div", { class: "s" }, s))); }
    return sh;
  }

  function reaction(root){
    const out = el("div", { class: "t", "aria-live": "polite" }, "");
    const go = el("button", { class: "btn primary", type: "button" }, "Start");
    let armed = false, flashAt = 0, timer = null;
    go.onclick = () => {
      if(armed){ const rt = Date.now() - flashAt; out.textContent = `${rt} ms`; armed = false; go.textContent = "Again"; if(rt < 350) emotion.flashExpression("proud", 1200); return; }
      if(timer){ clearTimeout(timer); timer = null; out.textContent = "Too early! Wait for the flash."; go.textContent = "Again"; return; }
      out.textContent = "Wait for it…"; go.textContent = "Tap!";
      timer = setTimeout(() => { timer = null; emotion.flashExpression("surprised", 1200); bus.emit("face:recoil"); flashAt = Date.now(); armed = true; }, 900 + Math.random() * 2200);
    };
    root.append(el("p", { class: "hint" }, "Press Tap! as soon as my eyes flash wide."), go, out);
  }
  function guess(root){
    const target = 1 + Math.floor(Math.random() * 20);
    const input = el("input", { class: "field", type: "number", min: 1, max: 20, "aria-label": "Your guess" });
    const out = el("div", { class: "t", "aria-live": "polite" });
    let tries = 0;
    const go = () => { const v = Number(input.value); if(!v) return; tries++; if(v === target){ out.textContent = `Got it in ${tries}! 🎉`; emotion.flashExpression("proud", 1500); D.face.react("hop"); } else out.textContent = v < target ? "Higher." : "Lower."; };
    input.addEventListener("keydown", e => { if(e.key === "Enter") go(); });
    root.append(el("p", { class: "hint" }, "I'm thinking of a number from 1 to 20."), el("div", { class: "row" }, input, el("button", { class: "btn sm primary", type: "button", onclick: go }, "Guess")), out);
  }
  function follow(root){
    const out = el("div", { class: "t", "aria-live": "polite" });
    const mk = side => el("button", { class: "btn", type: "button", onclick: () => {
      const left = Math.random() < .5; D.face.look(left ? -1 : 1, 0); out.textContent = "…";
      setTimeout(() => { out.textContent = (left === (side === "L") ? "Yes! " : "Nope. ") + "I looked " + (left ? "left" : "right") + "."; setTimeout(D.face.settle, 900); }, 700);
    } }, side === "L" ? "Left" : "Right");
    root.append(el("p", { class: "hint" }, "Guess which way I'll look."), el("div", { class: "popup-actions", style: "justify-content:flex-start" }, mk("L"), mk("R")), out);
  }

  window.DABSy.games = { open, reaction, guess, follow };
})();
