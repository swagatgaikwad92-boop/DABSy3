/* ============================================================
   D.A.B.S.y — fur-engine.js  (v8.1 fur upgrade)
   Paints short plush fur STRANDS once into small canvases and hands them
   to CSS as data-URL variables. Nothing runs per frame: no filters on
   animated layers, no particles. Textures are static, tileable, tiny.
     --fur-tex       strand layer for body + ears (top-down comb, slight splay)
     --fur-tex-tie   finer strand layer for the bow tie
   Lite devices get a smaller texture. Failure is silent: CSS falls back
   to the gradient look.
   ============================================================ */
(function(){
  "use strict";
  function rng(seed){ let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  function paint(size, count, len, width, seed, tint){
    const c = document.createElement("canvas"); c.width = c.height = size;
    const g = c.getContext("2d"); if(!g) return null;
    const r = rng(seed);
    g.lineCap = "round";
    // draw each strand wrapped on both axes so the tile has no seams
    for(let i = 0; i < count; i++){
      const x = r() * size, y = r() * size;
      const ang = Math.PI / 2 + (r() - .5) * 1.1;          // mostly downward comb, natural splay
      const L = len * (.6 + r() * .8), bend = (r() - .5) * L * .35;
      const light = r() > .42;
      const a = .10 + r() * .22;
      g.strokeStyle = light ? `rgba(${tint.hi},${a})` : `rgba(${tint.lo},${a * 1.15})`;
      g.lineWidth = width * (.7 + r() * .7);
      for(const ox of [-size, 0, size]) for(const oy of [-size, 0, size]){
        const x0 = x + ox, y0 = y + oy;
        if(x0 < -len || x0 > size + len || y0 < -len || y0 > size + len) continue;
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 + Math.cos(ang) * L * .5 + bend, y0 + Math.sin(ang) * L * .5, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L);
        g.stroke();
      }
    }
    return c.toDataURL("image/png");
  }

  function init(){
    try{
      const root = document.documentElement;
      const lite = document.body.classList.contains("lite-gfx");
      const S = lite ? 128 : 192;
      const body = paint(S, lite ? 520 : 1100, 15, 1.1, 11, { hi: "205,215,255", lo: "18,22,70" });
      const tie  = paint(S, lite ? 380 : 800,  9,  .9, 23, { hi: "255,240,255", lo: "40,20,90" });
      if(body) root.style.setProperty("--fur-tex", `url("${body}")`);
      if(tie)  root.style.setProperty("--fur-tex-tie", `url("${tie}")`);
      document.body.classList.add("fur-textured");
    }catch(e){ /* CSS fallback stays */ }
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
