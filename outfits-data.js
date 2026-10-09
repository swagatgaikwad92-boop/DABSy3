/* ============================================================
   D.A.B.S.y — outfits-data.js
   The wardrobe is DATA. Adding an outfit never touches the creature
   code: append one object to OUTFITS (or ACCESSORIES) below.

   All art is drawn in DABSy's own coordinate space, a 300 × 330 box:
     body   x 38–262, y 78–312        eyes   centres (106,172) (194,172)
     bow tie centre (150,262)          ears   top y≈58

   An OUTFIT       = a base look.  parts: { neck, eyes, ears, head }
   An ACCESSORY    = one extra piece in a single slot; it overrides the
                     outfit's piece for that slot.
   `parts` values are SVG fragments, optionally with <defs>.
   Gradient ids must be unique per item (prefix with the item id).

   unlock:
     { type:"default" }
     { type:"achievement", metric:"sessions"|"tasksDone"|"visits", gte:N, hint:"…" }
     { type:"egg", id:"…" }               (hint is deliberately vague)
   availability (optional):
     { months:[11,12,1,2] }               only equippable in these months
     { from:"MM-DD", to:"MM-DD" }         only equippable in this date window
   ============================================================ */

(function(){
  const bow = (id, c1, c2, knot) => `
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <ellipse cx="150" cy="284" rx="46" ry="6" fill="rgba(0,0,0,.28)"/>
    <path d="M150 262 L106 241 Q95 262 106 283 Z" fill="url(#g-${id})"/>
    <path d="M150 262 L194 241 Q205 262 194 283 Z" fill="url(#g-${id})"/>
    <path d="M111 247 Q103 262 111 277" stroke="rgba(255,255,255,.38)" fill="none" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M189 247 Q197 262 189 277" stroke="rgba(0,0,0,.18)" fill="none" stroke-width="1.7" stroke-linecap="round"/>
    <rect x="140" y="249" width="20" height="26" rx="8" fill="${knot || c2}"/>
    <rect x="144" y="252" width="6" height="14" rx="3" fill="rgba(255,255,255,.28)"/>`;

  const roundGlasses = `
    <g fill="rgba(255,255,255,.05)" stroke="#e9eefc" stroke-width="3.6" stroke-linecap="round">
      <circle cx="106" cy="172" r="41"/><circle cx="194" cy="172" r="41"/>
      <path d="M147 166 Q150 160 153 166" fill="none"/>
      <path d="M65 168 L48 162M235 168 L252 162" fill="none"/>
    </g>
    <path d="M82 146 Q96 134 114 140" stroke="rgba(255,255,255,.5)" stroke-width="3" fill="none" stroke-linecap="round"/>`;

  const sunglasses = `
    <defs><linearGradient id="g-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262c46"/><stop offset="1" stop-color="#0b0e1b"/></linearGradient></defs>
    <rect x="62" y="142" width="80" height="62" rx="26" fill="url(#g-sun)" stroke="#dfe6ff" stroke-width="3"/>
    <rect x="158" y="142" width="80" height="62" rx="26" fill="url(#g-sun)" stroke="#dfe6ff" stroke-width="3"/>
    <path d="M142 160 Q150 154 158 160" stroke="#dfe6ff" stroke-width="3" fill="none"/>
    <path d="M74 156 Q86 150 100 153M170 156 Q182 150 196 153" stroke="rgba(143,216,255,.7)" stroke-width="3" fill="none" stroke-linecap="round"/>`;

  const headphones = `
    <defs><linearGradient id="g-hp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef2ff"/><stop offset="1" stop-color="#aab4d8"/></linearGradient></defs>
    <path d="M60 170 Q58 52 150 52 Q242 52 240 170" fill="none" stroke="url(#g-hp)" stroke-width="9" stroke-linecap="round"/>
    <rect x="42" y="150" width="32" height="60" rx="16" fill="url(#g-hp)"/>
    <rect x="226" y="150" width="32" height="60" rx="16" fill="url(#g-hp)"/>
    <rect x="49" y="164" width="18" height="32" rx="9" fill="none" stroke="#8fd8ff" stroke-width="2.4" opacity=".9"/>
    <rect x="233" y="164" width="18" height="32" rx="9" fill="none" stroke="#8fd8ff" stroke-width="2.4" opacity=".9"/>`;

  const earFlower = (() => {
    let petals = "";
    for(let i=0;i<5;i++){ const a = i * 72 * Math.PI / 180; petals += `<circle cx="${(222 + Math.cos(a)*9).toFixed(1)}" cy="${(96 + Math.sin(a)*9).toFixed(1)}" r="7" fill="#ffc4dd"/>`; }
    return petals + `<circle cx="222" cy="96" r="5.5" fill="#ffd96a"/>`;
  })();

  const beanie = `
    <defs><linearGradient id="g-bn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f1ff"/><stop offset="1" stop-color="#cfc8ee"/></linearGradient>
    <linearGradient id="g-bn2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8627a"/><stop offset="1" stop-color="#b93352"/></linearGradient></defs>
    <path d="M104 100 Q104 44 150 42 Q196 44 196 100 Z" fill="url(#g-bn2)"/>
    <rect x="98" y="92" width="104" height="22" rx="11" fill="url(#g-bn)"/>
    <path d="M110 96 v14M122 96 v14M134 96 v14M146 96 v14M158 96 v14M170 96 v14M182 96 v14" stroke="rgba(0,0,0,.08)" stroke-width="2"/>
    <circle cx="150" cy="40" r="15" fill="url(#g-bn)"/>`;

  const gradCap = `
    <path d="M110 86 V108 Q150 124 190 108 V86 Q150 100 110 86Z" fill="#242a4e"/>
    <path d="M150 44 L232 72 L150 100 L68 72Z" fill="#171b36"/>
    <path d="M150 44 L232 72 L150 100 L68 72Z" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>
    <path d="M214 76 V112" stroke="#ffd39a" stroke-width="3" stroke-linecap="round"/><circle cx="214" cy="116" r="5.5" fill="#ffd39a"/>`;

  const partyHat = `
    <defs><linearGradient id="g-ph" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ad0"/><stop offset="1" stop-color="#8f7bff"/></linearGradient></defs>
    <path d="M150 20 L186 100 Q150 112 114 100 Z" fill="url(#g-ph)"/>
    <path d="M136 58 L172 70M128 78 L180 90" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="150" cy="19" r="8" fill="#ffe28a"/>`;

  const sleepCap = `
    <defs><linearGradient id="g-sc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4a56b8"/><stop offset="1" stop-color="#2c3578"/></linearGradient></defs>
    <path d="M98 100 Q106 42 160 44 Q212 52 238 118 Q200 84 164 92 Q130 100 98 100Z" fill="url(#g-sc)"/>
    <path d="M100 98 Q130 104 164 94 Q200 86 232 112" stroke="#dfe3ff" stroke-width="9" fill="none" stroke-linecap="round"/>
    <circle cx="240" cy="124" r="11" fill="#dfe3ff"/>
    <path d="M168 66 l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z" fill="#ffe28a" opacity=".9"/>`;

  const scarf = `
    <defs><linearGradient id="g-sf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0ecff"/><stop offset="1" stop-color="#cdc6ee"/></linearGradient></defs>
    <path d="M80 246 Q150 284 220 246 L224 276 Q150 314 76 276 Z" fill="url(#g-sf)"/>
    <path d="M78 258 Q150 296 222 258M77 268 Q150 306 223 268" stroke="#e8627a" stroke-width="5" fill="none"/>
    <path d="M186 288 L210 326 L186 332 L170 296Z" fill="url(#g-sf)"/>
    <path d="M178 312 L196 308M182 322 L200 318" stroke="#e8627a" stroke-width="4"/>`;

  const garland = (() => {
    let c = "";
    for(let i=0;i<=10;i++){
      const t = i/10, x = (1-t)**2*78 + 2*(1-t)*t*150 + t*t*222, y = (1-t)**2*246 + 2*(1-t)*t*306 + t*t*246;
      c += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="${i%2 ? "#ffb02e" : "#ff7f1f"}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="rgba(255,255,255,.35)"/>`;
    }
    return c;
  })();

  const collar = `<path d="M116 236 L150 264 L122 282Z" fill="#eef1ff" opacity=".92"/><path d="M184 236 L150 264 L178 282Z" fill="#eef1ff" opacity=".92"/>`;

  /* ---------------- outfits ---------------- */
  const OUTFITS = [
    { id:"classic",  name:"Classic bow tie", category:"casual",     unlock:{ type:"default" },
      parts:{ neck: bow("classic", "#cdb9ff", "#8a67f0") } },

    { id:"scholar",  name:"Scholar",         category:"scholar",    unlock:{ type:"default" },
      parts:{ neck: bow("scholar", "#7db3ff", "#2f63d6"), eyes: roundGlasses } },

    { id:"formal",   name:"Formal",          category:"formal",     unlock:{ type:"default" },
      parts:{ neck: collar + bow("formal", "#3a3f5c", "#0f1220", "#1a1e33") } },

    { id:"tech",     name:"Tech",            category:"technology", unlock:{ type:"default" },
      tint:{ eye:"190,255,238", glow:"121,255,225" },
      parts:{ neck: bow("tech", "#8fffe6", "#17b8a0"), ears: headphones } },

    { id:"winter",   name:"Winter",          category:"winter",     unlock:{ type:"default" },
      availability:{ months:[11,12,1,2] },
      parts:{ neck: scarf + bow("winter", "#ff8aa0", "#c8365a"), head: beanie } },

    { id:"festival", name:"Festival garland", category:"festival",  unlock:{ type:"default" },
      availability:{ from:"10-15", to:"11-20" },
      parts:{ neck: garland + bow("festival", "#ffd27a", "#f08a1c") } },

    { id:"graduate", name:"Graduate",        category:"scholar",    unlock:{ type:"achievement", metric:"sessions", gte:3, hint:"Finish 3 study sessions" },
      parts:{ neck: bow("graduate", "#6c78c9", "#2a3158", "#ffd39a"), head: gradCap } },

    { id:"night-owl", name:"Night owl",      category:"special",    unlock:{ type:"egg", id:"night-owl" },
      tint:{ fur:["#3a4a8c","#222c58","#121733"] },
      parts:{ neck: bow("owl", "#7d8cff", "#3946a8"), head: sleepCap } },

    { id:"golden",   name:"Golden bow tie",  category:"special",    unlock:{ type:"egg", id:"secret-rhythm" },
      parts:{ neck: bow("golden", "#fff0b8", "#e0a526", "#f4c24d") } },
  ];

  /* ---------------- accessories (one slot each) ---------------- */
  const ACCESSORIES = [
    { id:"round-glasses", name:"Round glasses", slot:"eyes", category:"scholar",    unlock:{ type:"default" },      part: roundGlasses },
    { id:"headphones",    name:"Headphones",    slot:"ears", category:"technology", unlock:{ type:"default" },      part: headphones },
    { id:"ear-flower",    name:"Ear flower",    slot:"ears", category:"casual",     unlock:{ type:"default" },      part: earFlower },
    { id:"sunglasses",    name:"Sunglasses",    slot:"eyes", category:"casual",     unlock:{ type:"achievement", metric:"visits", gte:3, hint:"Visit 3 days in a row" }, part: sunglasses },
    { id:"party-hat",     name:"Party hat",     slot:"head", category:"festival",   unlock:{ type:"achievement", metric:"tasksDone", gte:5, hint:"Complete 5 tasks" }, part: partyHat },
  ];

  window.DABSy = window.DABSy || {};
  window.DABSy.outfitData = { OUTFITS, ACCESSORIES, SLOTS: ["neck", "eyes", "ears", "head"] };
})();
