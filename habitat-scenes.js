/* ============================================================
   D.A.B.S.y — habitat-scenes.js   (v10.2)
   Three original, hand-built illustrated rooms, each in a REAL day and a REAL night version, drawn as SVG
   and turned into data: pictures at load time (so they never 404 on GitHub Pages and need no extra files).
   Every object DABSy can sit on is defined ONCE here as geometry in the picture's own coordinate system;
   habitats-data.js derives her sitting spots from that geometry, so she is placed relative to the object
   (pillow top, desk top, sill top), never at a hand-tuned screen coordinate.
   Picture size: 720 x 1560 (portrait, about a phone's shape).
   ============================================================ */
(function(){
  "use strict";
  const W = 720, H = 1560;
  /* ---- shared geometry (picture units): the objects DABSy can sit on ---- */
  const G = {
    bed:   { pillow: { x: 110, y: 1005, w: 220, h: 86, top: 1022 }, blanket: { x: 170, y: 1110, w: 370, top: 1126 }, sill: { x: 130, y: 730, w: 460, top: 732 } },
    desk:  { top: 1092, books: { x: 120, w: 190, top: 1034 }, shelf: { x: 480, w: 200, top: 624 }, mug: { x: 470 }, lamp: { x: 610 } },
    sill:  { top: 1010, cushion: { x: 300, w: 200, top: 990 }, left: { x: 230 }, right: { x: 600 } },
  };
  const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const f = n => +n.toFixed(1);

  /* ---- palettes ---- */
  const PAL = {
    day:   { wall: ["#f7e8d6", "#efd5b8"], floor: ["#cf9f6f", "#a97c50"], wood: "#b58150", woodD: "#8f6238", sky: ["#8fd0ff", "#e9f7ff"], hill: "#a9d6a0", hill2: "#8cc58a", cloud: "#ffffff", cloudA: .92, glass: "rgba(255,255,255,.18)", frame: "#fff4e6", frameD: "#d9bfa0", cloth: ["#f08aa6", "#ffd1dc"], cloth2: "#ffffff", pillow: ["#c6b3ff", "#a690f0"], leaf: ["#58b368", "#3b8f52"], pot: "#d98a63", shade: "#ffd9a0", rug: "#f2b9a7", paper: "#fffaf0", spine: ["#e46a6a", "#5b8fe0", "#f0c15a", "#5fb98a", "#a47be0"] },
    night: { wall: ["#2d2958", "#1d1a40"], floor: ["#4b3b4a", "#33262f"], wood: "#6f4d3c", woodD: "#4b3228", sky: ["#070b2a", "#2c2f72"], hill: "#171a47", hill2: "#10123a", cloud: "#8d93d8", cloudA: .14, glass: "rgba(160,180,255,.10)", frame: "#46406e", frameD: "#2c284d", cloth: ["#6b5bb8", "#4c3f93"], cloth2: "#b8abf0", pillow: ["#9a87e8", "#7b66cf"], leaf: ["#3c8c6a", "#256a50"], pot: "#a5624a", shade: "#ffc67a", rug: "#6a4b72", paper: "#e9e2f5", spine: ["#b45a6e", "#4d6fb8", "#c9a24f", "#47997a", "#7f62bf"] },
  };

  const grad = (id, a, b, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  const rect = (x, y, w, h, fill, rx = 0, extra = "") => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" fill="${fill}" ${extra}/>`;

  /* outside view clipped into a window area */
  function outside(day, id, x, y, w, h, seed){
    const P = PAL[day ? "day" : "night"], r = rng(seed);
    let s = `<clipPath id="c-${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26"/></clipPath><g clip-path="url(#c-${id})">`;
    s += rect(x, y, w, h, `url(#sky-${id})`);
    if(day){
      s += `<circle cx="${f(x + w * .74)}" cy="${f(y + h * .2)}" r="${f(w * .11)}" fill="#fff3b0"/><circle cx="${f(x + w * .74)}" cy="${f(y + h * .2)}" r="${f(w * .17)}" fill="#fff3b0" opacity=".35"/>`;
      for(let i = 0; i < 3; i++){ const cx = x + w * (.2 + .32 * i + r() * .08), cy = y + h * (.16 + r() * .22); s += `<g opacity="${P.cloudA}" fill="#fff"><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w * .13)}" ry="${f(h * .035)}"/><ellipse cx="${f(cx + w * .06)}" cy="${f(cy - h * .02)}" rx="${f(w * .08)}" ry="${f(h * .035)}"/></g>`; }
    } else {
      for(let i = 0; i < 46; i++) s += `<circle cx="${f(x + r() * w)}" cy="${f(y + r() * h * .7)}" r="${f(.8 + r() * 2)}" fill="#fff" opacity="${f(.35 + r() * .6)}"/>`;
      s += `<circle cx="${f(x + w * .72)}" cy="${f(y + h * .2)}" r="${f(w * .085)}" fill="#fff6cf"/><circle cx="${f(x + w * .75)}" cy="${f(y + h * .185)}" r="${f(w * .07)}" fill="#1e2260"/>`;
      s += `<circle cx="${f(x + w * .72)}" cy="${f(y + h * .2)}" r="${f(w * .2)}" fill="#cfd6ff" opacity=".10"/>`;
    }
    s += `<path d="M${x} ${f(y + h * .78)} Q${f(x + w * .3)} ${f(y + h * .66)} ${f(x + w * .55)} ${f(y + h * .76)} T${x + w} ${f(y + h * .72)} V${y + h} H${x}Z" fill="${P.hill}"/>`;
    s += `<path d="M${x} ${f(y + h * .88)} Q${f(x + w * .4)} ${f(y + h * .8)} ${f(x + w * .7)} ${f(y + h * .88)} T${x + w} ${f(y + h * .84)} V${y + h} H${x}Z" fill="${P.hill2}"/>`;
    if(!day) for(let i = 0; i < 14; i++) s += `<rect x="${f(x + 20 + r() * (w - 40))}" y="${f(y + h * (.8 + r() * .16))}" width="5" height="6" fill="#ffd98a" opacity="${f(.5 + r() * .5)}"/>`;
    return s + `</g>`;
  }
  const defsSky = (id, P) => grad("sky-" + id, P.sky[0], P.sky[1]);

  function plant(x, baseY, scale, P, pot = true){
    let s = "";
    const leaf = (dx, dy, rx, ry, rot, c) => `<ellipse cx="${f(x + dx * scale)}" cy="${f(baseY + dy * scale)}" rx="${f(rx * scale)}" ry="${f(ry * scale)}" transform="rotate(${rot} ${f(x + dx * scale)} ${f(baseY + dy * scale)})" fill="${c}"/>`;
    s += leaf(-26, -74, 14, 46, -28, P.leaf[1]) + leaf(26, -78, 14, 48, 26, P.leaf[1]) + leaf(0, -92, 15, 54, 0, P.leaf[0]) + leaf(-12, -60, 11, 36, -14, P.leaf[0]) + leaf(14, -62, 11, 36, 14, P.leaf[0]);
    if(pot) s += `<path d="M${f(x - 34 * scale)} ${f(baseY - 44 * scale)} h${f(68 * scale)} l${f(-8 * scale)} ${f(44 * scale)} h${f(-52 * scale)}Z" fill="${P.pot}"/>` + rect(x - 38 * scale, baseY - 52 * scale, 76 * scale, 12 * scale, P.pot, 5 * scale, 'opacity=".9"');
    return s;
  }
  function lampShade(x, y, P, night){
    return `<path d="M${x - 46} ${y} L${x - 24} ${y - 70} H${x + 24} L${x + 46} ${y}Z" fill="${P.shade}" ${night ? "" : 'opacity=".95"'}/>` + rect(x - 5, y, 10, 60, P.woodD, 3) + rect(x - 30, y + 58, 60, 10, P.woodD, 5);
  }

  /* ========== 1. COSY BED ========== */
  function bed(day){
    const P = PAL[day ? "day" : "night"], b = G.bed;
    let s = `<defs>${grad("wall", P.wall[0], P.wall[1])}${grad("floor", P.floor[0], P.floor[1])}${grad("cloth", P.cloth[0], P.cloth[1])}${grad("pil", P.pillow[0], P.pillow[1])}${defsSky("bed", P)}</defs>`;
    s += rect(0, 0, W, 1232, "url(#wall)") + rect(0, 1232, W, H - 1232, "url(#floor)") + rect(0, 1226, W, 10, P.woodD, 0, 'opacity=".5"');
    // window + sill
    s += rect(112, 200, 496, 560, P.frame, 40) + outside(day, "bed", 138, 226, 444, 508, 11);
    s += rect(356, 226, 8, 508, P.frame, 3) + rect(138, 470, 444, 8, P.frame, 3);
    s += rect(b.sill.x - 20, b.sill.top - 6, b.sill.w + 40, 26, P.frame, 12) + rect(b.sill.x - 20, b.sill.top + 14, b.sill.w + 40, 10, P.frameD, 5, 'opacity=".6"');
    s += plant(200, b.sill.top - 4, .5, P) ;
    // fairy lights
    for(let i = 0; i < 16; i++){ const x = 30 + i * 43, y = 110 + Math.sin(i * .9) * 22; s += `<circle cx="${x}" cy="${f(y)}" r="7" fill="${day ? "#ffd27a" : "#ffe3a0"}" opacity="${day ? .8 : 1}"/>`; }
    s += `<path d="M0 100 Q180 150 360 110 T720 112" stroke="${P.woodD}" stroke-width="3" fill="none" opacity=".5"/>`;
    // rug
    s += `<ellipse cx="300" cy="1440" rx="300" ry="56" fill="${P.rug}" opacity=".85"/>`;
    // bed: headboard, mattress, pillow, blanket
    s += rect(30, 900, 530, 380, P.wood, 40) + rect(30, 1250, 530, 70, P.woodD, 16);
    s += rect(50, 1050, 490, 200, day ? "#fffaf2" : "#d8d2ee", 34);
    s += rect(b.pillow.x, b.pillow.y, b.pillow.w, b.pillow.h, "url(#pil)", 44) + rect(b.pillow.x + 22, b.pillow.y + 14, b.pillow.w - 44, 14, "#fff", 7, 'opacity=".22"');
    s += rect(b.blanket.x, b.blanket.y, b.blanket.w, 190, "url(#cloth)", 34);
    for(let i = 0; i < 4; i++) s += rect(b.blanket.x + 34 + i * 84, b.blanket.y + 8, 22, 174, P.cloth2, 11, 'opacity=".28"');
    s += rect(b.blanket.x, b.blanket.y + 150, b.blanket.w, 40, P.cloth2, 20, 'opacity=".18"');
    // nightstand + lamp
    s += rect(590, 1130, 120, 190, P.wood, 14) + rect(600, 1170, 100, 6, P.woodD, 3) + rect(600, 1240, 100, 6, P.woodD, 3);
    s += lampShade(650, 1050, P, !day);
    return s;
  }
  /* ========== 2. STUDY DESK ========== */
  function desk(day){
    const P = PAL[day ? "day" : "night"], d = G.desk;
    let s = `<defs>${grad("wall", P.wall[0], P.wall[1])}${grad("floor", P.floor[0], P.floor[1])}${defsSky("desk", P)}</defs>`;
    s += rect(0, 0, W, 1250, "url(#wall)") + rect(0, 1250, W, H - 1250, "url(#floor)");
    // window
    s += rect(60, 240, 340, 420, P.frame, 36) + outside(day, "desk", 82, 262, 296, 376, 23) + rect(226, 262, 8, 376, P.frame, 3);
    // posters / corkboard
    s += rect(96, 740, 230, 190, day ? "#e6c79c" : "#5a4a52", 14) + rect(116, 760, 70, 52, P.paper, 4, 'opacity=".95"') + rect(200, 770, 90, 60, day ? "#ffd1dc" : "#b78ecf", 4) + rect(130, 840, 60, 60, day ? "#cdeccf" : "#5d9a86", 4);
    // bookshelf
    s += rect(468, 300, 224, 700, P.wood, 16) + rect(484, 316, 192, 668, day ? "#f5e5cf" : "#2a2038", 8);
    [440, G.desk.shelf.top - 8, 800, 960].forEach((y, i) => { s += rect(484, y + 8, 192, 12, P.woodD, 4); });
    const books = (x0, y0, n, seed) => { const r = rng(seed); let o = "", x = x0; for(let i = 0; i < n; i++){ const w = 18 + r() * 12, h = 70 + r() * 36; o += rect(x, y0 - h, w, h, P.spine[i % 5], 3); x += w + 3; if(x > 650) break; } return o; };
    s += books(492, 440, 8, 3) + books(492, 800, 7, 5) + books(492, 960, 8, 9);
    s += plant(600, 440, .5, P);
    // desk
    s += rect(0, d.top, W, 40, P.wood, 10) + rect(0, d.top + 36, W, 18, P.woodD, 4, 'opacity=".7"') + rect(40, d.top + 52, 640, 320, P.wood, 12, 'opacity=".95"');
    s += rect(60, d.top + 76, 290, 120, P.woodD, 12, 'opacity=".55"') + rect(370, d.top + 76, 290, 120, P.woodD, 12, 'opacity=".55"') + rect(190, d.top + 124, 30, 12, P.frame, 6) + rect(500, d.top + 124, 30, 12, P.frame, 6);
    // book stack
    s += rect(d.books.x, 1074, d.books.w, 20, P.spine[0], 4) + rect(d.books.x + 12, 1054, d.books.w - 30, 20, P.spine[1], 4) + rect(d.books.x + 4, d.books.top, d.books.w - 16, 20, P.spine[2], 4);
    // mug + lamp
    s += rect(d.mug.x - 24, 1040, 48, 52, day ? "#fff" : "#c8c1e6", 8) + `<path d="M${d.mug.x + 24} 1054 q22 4 0 26" stroke="${day ? "#ddd" : "#9d97c9"}" stroke-width="6" fill="none"/>`;
    s += lampShade(d.lamp.x, 1010, P, !day);
    return s;
  }
  /* ========== 3. WINDOW SILL ========== */
  function sill(day){
    const P = PAL[day ? "day" : "night"], k = G.sill;
    let s = `<defs>${grad("wall", P.wall[0], P.wall[1])}${grad("floor", P.floor[0], P.floor[1])}${defsSky("sill", P)}${grad("cu", P.pillow[0], P.pillow[1])}</defs>`;
    s += rect(0, 0, W, 1260, "url(#wall)") + rect(0, 1260, W, H - 1260, "url(#floor)");
    s += rect(52, 110, 616, 920, P.frame, 70) + outside(day, "sill", 80, 138, 560, 862, 37);
    s += rect(356, 138, 8, 862, P.frame, 3) + rect(80, 520, 560, 8, P.frame, 3);
    s += rect(0, k.top, W, 50, P.wood, 16) + rect(0, k.top + 44, W, 20, P.woodD, 6, 'opacity=".7"');
    // plants
    s += plant(110, k.top + 2, .95, P) + plant(640, k.top + 2, .8, P) + plant(470, k.top + 2, .5, P);
    // cushion
    s += rect(k.cushion.x, k.cushion.top, k.cushion.w, 34, "url(#cu)", 17) + rect(k.cushion.x + 24, k.cushion.top + 6, k.cushion.w - 48, 8, "#fff", 4, 'opacity=".22"');
    // below the sill: radiator + rug
    s += rect(120, 1110, 480, 110, day ? "#f4efe6" : "#463d56", 12) ; for(let i = 0; i < 12; i++) s += rect(136 + i * 38, 1124, 22, 82, day ? "#e4ddd0" : "#3a3249", 10);
    s += `<ellipse cx="360" cy="1440" rx="330" ry="60" fill="${P.rug}" opacity=".8"/>`;
    return s;
  }
  const BUILD = { bed, desk, sill };
  const uri = svg => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${svg}</svg>`);
  const cache = {};
  /* lazily built: nothing is drawn until a wallpaper actually asks for it */
  window.DABSy = window.DABSy || {};
  window.DABSy.scenes = {
    W, H, G,
    src(id, variant){ const k = id + ":" + variant; return cache[k] || (cache[k] = uri(BUILD[id](variant === "day"))); },
    has: id => !!BUILD[id],
  };
})();
