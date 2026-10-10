/* ============================================================
   D.A.B.S.y — easter-engine.js : hidden surprises
   Data-driven. Add an egg by appending one object to EGGS. Eggs are
   NEVER mentioned in the tutorial or Settings. Found eggs are
   remembered (easter_v1) so a reward unlocks exactly once.

   Egg = { id, trigger:{...}, act(ctx), reward?: outfit/accessory id }
   Triggers: text (phrase regex, optional hours), rhythm (press pattern
   on the bow tie), shake (device shake).
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
    { id: "secret-rhythm", trigger: { rhythm: "..-." }, reward: "golden", act: () => { D.face.react("dance"); D.emotion.flashExpression("happy", 1800); } },
    { id: "shake", trigger: { shake: true }, act: () => { D.face.react("dizzy"); D.emotion.flashExpression("confused", 1400); say("Whoa. Careful with the fluff!", "SURPRISED"); } },
    { id: "play", trigger: { text: /^(let'?s )?play( a game)?[.!]?$/i }, act: () => { D.require("games").then(g => g.open()); } },
  ];

  function fire(egg, ctx){
    const first = mark(egg.id);
    egg.act(ctx || {});
    if(egg.reward && first) setTimeout(() => D.outfits.unlock(egg.reward), 1400);
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

  /* shake: only listens while the page is visible; throttled; never requests permission */
  let lastShake = 0, last = null;
  window.addEventListener("devicemotion", ev => {
    if(document.hidden) return;
    const a = ev.accelerationIncludingGravity; if(!a) return;
    if(last){
      const delta = Math.abs(a.x - last.x) + Math.abs(a.y - last.y) + Math.abs(a.z - last.z);
      if(delta > 38 && Date.now() - lastShake > 8000){ lastShake = Date.now(); fire(EGGS.find(e => e.id === "shake")); }
    }
    last = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
  }, { passive: true });

  window.DABSy.easter = { handleText, EGGS, found: () => found.slice(), fire };
})();
