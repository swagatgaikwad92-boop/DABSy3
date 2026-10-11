/* ============================================================
   D.A.B.S.y — easter-engine.js : hidden surprises
   Data-driven. Add an egg by appending one object to EGGS. Eggs are
   NEVER mentioned in the tutorial or Settings. Found eggs are
   remembered (easter_v1) so a reward unlocks exactly once.

   Egg = { id, trigger:{...}, act(ctx), reward?: outfit/accessory id }
   Triggers: text (phrase regex, optional hours), rhythm (press pattern
   on the bow tie). No motion/shake triggers: they fire by accident.
   ============================================================ */
(function(){
  const D = window.DABSy;
  const bus = D.bus, memory = D.memory;
  const KEY = "easter_v1";
  let found = memory.read(KEY, []);
  const mark = id => { if(!found.includes(id)){ found.push(id); memory.write(KEY, found); return true; } return false; };
  const say = (t, s) => D.app && D.app.say(t, s);

  const EGGS = [
    { id: "barrel-roll", trigger: { text: /^(please )?(do a )?barrel roll[.!]?$/i }, act: () => { D.face.react("spin"); say("Wheee!", "PLAYFUL"); } },
    { id: "dance", trigger: { text: /^(please )?(dance|do a dance|boogie)( dabsy)?[.!]?$/i }, act: () => { D.face.react("dance"); say("I've been practising.", "HAPPY"); } },
    { id: "secret", trigger: { text: /^(tell me a secret|whisper( something)?)[.!]?$/i }, act: () => say("Between us: I think you're doing better than you believe.", "HAPPY") },
    { id: "who", trigger: { text: /^who (are|made) you\??$/i }, act: () => say("I'm DABSy. Soft on the outside, spreadsheets on the inside.", "PLAYFUL") },
    { id: "meaning", trigger: { text: /\bmeaning of life\b/i }, act: () => say("Forty-two. Or a good night's sleep before exams.", "PLAYFUL") },
    { id: "night-owl", trigger: { text: /^good ?night( dabsy)?[.!]?$/i, hours: [0, 4] }, reward: "night-owl", act: () => { D.emotion.flashExpression("sleepy", 2500); D.face.react("yawn"); say("Sleep well. Even night owls need rest.", "SLEEPY"); } },
    { id: "secret-rhythm", trigger: { rhythm: "..-." }, reward: "golden", sticker: "milk", stickerName: "Banana Milk", act: () => { fizz(); D.emotion.flashExpression("happy", 1800); } },
    { id: "play", trigger: { text: /^(let'?s )?play( a game)?[.!]?$/i }, act: () => { D.require("games").then(g => g.open()); } },
  ];

  /* ---- Soda fizz: one restrained celebration (bubbles rise from the bottom; no input blocked) ---- */
  function fizz(){
    if(D.ui.reducedMotion && D.ui.reducedMotion()) return;
    const old = document.getElementById("fizz"); if(old) old.remove();
    const f = document.createElement("div"); f.id = "fizz"; f.setAttribute("aria-hidden", "true");
    for(let i = 0; i < 14; i++){
      const b = document.createElement("i");
      const size = 8 + Math.random() * 16;
      b.style.cssText = `left:${8 + Math.random() * 84}%;width:${size}px;height:${size}px;animation-delay:${(Math.random() * .7).toFixed(2)}s;animation-duration:${(1.6 + Math.random() * 1).toFixed(2)}s`;
      f.append(b);
    }
    document.body.append(f); setTimeout(() => f.remove(), 3000);
  }
  /* ---- tiny sticker book: collectibles for discoveries and milestones ---- */
  const BOOK = "sticker_book_v1";
  function collect(id, sticker, name){
    const book = memory.read(BOOK, []); if(book.includes(id)) return false;
    book.push(id); memory.write(BOOK, book);
    D.ui.toast({ sticker, title: "New sticker", text: name + " added to your collection.", timeout: 6000 });
    return true;
  }
  /* ---- milestone: first focus session of 25+ minutes each day gets the fizz; the 10th ever, a sticker ---- */
  bus.on("session:finished", ({ doneMin }) => {
    if(!doneMin || doneMin < 25) return;
    const day = D.ui.dateKey(), last = memory.read("fizz_day_v1", "");
    const total = memory.read("focus_total_v1", 0) + 1; memory.write("focus_total_v1", total);
    if(last !== day){ memory.write("fizz_day_v1", day); setTimeout(() => { fizz(); D.emotion.flashExpression("happy", 1800); }, 900); }
    if(total >= 10) setTimeout(() => collect("ten-focus", "soda", "Soda Pop (10 focus sessions)"), 2600);
  });

  function fire(egg, ctx){
    const first = mark(egg.id);
    egg.act(ctx || {});
    if(egg.reward && first) setTimeout(() => D.outfits.unlock(egg.reward), 1400);
    if(first && egg.sticker) setTimeout(() => collect("egg-" + egg.id, egg.sticker, egg.stickerName || "A new sticker"), 1800);
  }

  function handleText(text){
    const h = new Date().getHours();
    const egg = EGGS.find(e => e.trigger.text && e.trigger.text.test(text) && (!e.trigger.hours || (h >= e.trigger.hours[0] && h < e.trigger.hours[1])));
    if(!egg) return false;
    fire(egg, { text }); return true;
  }

  /* rhythm: press pattern on the bow tie region, "." < 180ms, "-" 180–500ms */
  let seq = "", seqTimer = null, downAt = 0, downRegion = "";
  bus.on("face:pressdown", ({ region }) => { downAt = Date.now(); downRegion = region; });
  bus.on("face:pressup", ({ region }) => {
    if(downRegion !== "tie") { seq = ""; return; }
    const d = Date.now() - downAt;
    if(d > 520) { seq = ""; return; }
    seq += d < 180 ? "." : "-";
    clearTimeout(seqTimer); seqTimer = setTimeout(() => { seq = ""; }, 2200);
    seq = seq.slice(-6);
    EGGS.filter(e => e.trigger.rhythm).forEach(e => { if(seq.endsWith(e.trigger.rhythm)){ seq = ""; fire(e); } });
  });

  window.DABSy.easter = { handleText, EGGS, fizz, collect, found: () => found.slice(), fire };
})();
