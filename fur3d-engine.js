/* ============================================================
   D.A.B.S.y — fur3d-engine.js  (v8.2)
   Real 3D plush fur. One small WebGL canvas behind the eyes draws:
     · the rounded body (ellipsoid)           — furry look only
     · two tapered, volumetric ears            — furry look only
     · the bow tie (two puffed lobes + a raised knot) — both looks
   Fur is "shell fur": each mesh is drawn as ~16 offset shells, each shell
   keeps only the pixels that lie inside a procedural strand, so strands are
   tapered, vary in length/direction, and follow the surface curvature.
   Lighting: key light (top-left), cool rim light, root occlusion, cyan spill
   from the eyes, eye-socket shading, a soft contact shadow under the tie,
   and a gentle parallax turn toward where DABSy is looking.

   Everything else (eyes, blink, expressions, gear) stays DOM. If WebGL is
   unavailable the CSS fur from creature.css stays in place (no class added).
   Lite devices: fewer shells, 1× pixel ratio, no MSAA. A frame-time monitor
   lowers quality further on slow GPUs. Paused while the tab is hidden.
   ============================================================ */
(function(){
  "use strict";
  const D = window.DABSy = window.DABSy || {};
  const face = document.getElementById("face");
  const tilt = face && face.querySelector(".cr-tilt");
  if(!face || !tilt) return;
  const bus = D.bus;

  // design space = the 300 × 330 box everything else is laid out in; the canvas extends past it so fur + ears aren't clipped
  const W = 300, H = 330, MX = 42, MY = 46;
  const VW = W + MX * 2, VH = H + MY * 2;
  const lite = () => document.body.classList.contains("lite-gfx");

  let canvas, gl, prog, ok = false, raf = 0, last = 0, mesh = null;
  const U = {};
  const state = {
    fur: { hi: [.455, .51, .847], mid: [.27, .322, .651], lo: [.133, .165, .4] },
    glow: [.43, .91, .94],
    bodyA: 0, bodyTarget: 1,
    tie: { on: false, x: 150, y: 236, s: 1, c1: [.8, .72, 1], c2: [.54, .4, .94], k: [.54, .4, .94] },
    yaw: 0, pitch: 0, pop: 0, quality: 1, ft: 16, frames: 0, acc: 0, wind: 0,
  };

  /* ---------------- tiny math ---------------- */
  const I3 = () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]); };
  const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]); };
  const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, c, s, 0, -s, c]); };
  function mul3(A, B){                                  // column-major A*B
    const o = new Float32Array(9);
    for(let c = 0; c < 3; c++) for(let r = 0; r < 3; r++) o[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2];
    return o;
  }
  function hexToRgb(h){
    h = (h || "").trim(); if(h[0] !== "#") return null;
    if(h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    const n = parseInt(h.slice(1), 16); if(isNaN(n)) return null;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function cssToRgb(v){
    if(!v) return null; v = String(v).trim();
    if(v[0] === "#") return hexToRgb(v);
    const m = v.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/); if(m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    return null;
  }

  /* ---------------- shaders ---------------- */
  const VS = `
  attribute vec3 aP;
  uniform vec3 uC, uR, uDroop, uPiv;
  uniform mat3 uRot, uG;
  uniform float uMir, uWarp, uT, uLen;
  uniform vec2 uView, uViewC;
  varying vec3 vBase, vN, vNg, vL;
  varying float vT;
  void main(){
    vec3 pl = aP, nl = aP / uR;
    if(uWarp > .5 && uWarp < 1.5){ float w = mix(1.0, .13, smoothstep(0.0, -1.0, pl.y)); pl.xz *= w; }          // ear: tapers to a soft tip
    else if(uWarp > 1.5){ float s = smoothstep(-1.0, 1.0, pl.x); pl.y *= mix(.40, 1.0, s); pl.z *= mix(.60, 1.0, s); } // bow lobe: flares outward
    pl.x *= uMir; nl.x *= uMir;
    vec3 base = uC + uRot * (pl * uR);
    vec3 n = normalize(uRot * nl);
    vec3 p = base + n * uLen * uT + uDroop * uT * uT;
    vBase = base; vN = n; vL = aP; vT = uT;
    vec3 q = uG * (p - uPiv) + uPiv;
    vNg = uG * n;
    float k = 1.0 / (1.0 - q.z / 1200.0);
    vec2 xy = uPiv.xy + (q.xy - uPiv.xy) * k;
    gl_Position = vec4((xy.x - uViewC.x) / uView.x, -(xy.y - uViewC.y) / uView.y, -q.z / 700.0, 1.0);
  }`;
  const FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec3 vBase, vN, vNg, vL;
  varying float vT;
  uniform vec3 uRoot, uMid, uTip, uInner, uC2, uGlow, uLight, uRim;
  uniform float uDens, uMode, uAlpha, uEyeOn, uTieOn, uK, uLen;
  uniform vec2 uEyeL, uEyeR, uTie, uTieHalf;
  vec3 h33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
  void main(){
    float t = vT;
    vec3 N = normalize(vN), Ng = normalize(vNg);
    // eye sockets (body only): short fibres + soft shadow ring close to the eyes, cyan spill a little further out
    float e = 9.0;
    if(uEyeOn > .5){
      vec2 a = (vBase.xy - uEyeL) / vec2(30.0, 42.0), b = (vBase.xy - uEyeR) / vec2(30.0, 42.0);
      e = mix(9.0, min(length(a), length(b)), smoothstep(.15, .5, N.z));
    }
    float inner = 0.0;
    if(uMode > .5 && uMode < 1.5) inner = smoothstep(.62, .3, length(vec2(vL.x * 1.3, vL.y + .2))) * step(0.0, vL.z);
    float shorten = mix(.14, 1.0, smoothstep(1.0, 1.75, e)) * (1.0 - .55 * inner);
    // strands: cells on the BASE surface, slanted with height so they lean and curl instead of standing straight up
    vec3 g = vec3(0.0, 1.0, 0.0); vec3 comb = g - N * dot(g, N); comb /= (length(comb) + .25);
    vec3 coarse = h33(floor(vBase * .09)) - .5;
    vec3 q = vBase * uDens + t * (comb * 1.5 + coarse * 2.2);
    vec3 cell = floor(q), f = q - cell, hh = h33(cell);
    vec3 dv = f - (.5 + (hh - .5) * .55);
    dv -= N * dot(dv, N);
    float d = length(dv);
    float sl = (.6 + .4 * hh.x) * shorten;
    float alpha = 1.0;
    if(t > .001){
      if(t > sl) discard;
      float r = mix(.78, .26, t / max(sl, .05));
      alpha = 1.0 - smoothstep(r * .35, r, d);
      if(alpha < .06) discard;
    }
    // colour
    vec3 mid = uMid;
    if(uMode > 1.5){
      float gr = clamp(((vBase.x - uTie.x) / uTieHalf.x + (vBase.y - uTie.y) / uTieHalf.y) * .3 + .62, 0.0, 1.0);
      mid = mix(uTip, uC2, gr); if(uK > .5) mid = uInner;
    }
    vec3 tip = mix(mid, uTip, (uMode > 1.5) ? 0.0 : 1.0);
    vec3 col = mix((uMode > 1.5) ? mid * .72 : uRoot, mix(mid, (uMode > 1.5) ? mid * 1.22 + .05 : tip, hh.y * .6 + .4), pow(t, .8));
    if(uMode > .5 && uMode < 1.5) col = mix(col, uInner * (.55 + .45 * t), inner * .85);
    float ndl = dot(Ng, uLight);
    float diff = .4 + .95 * clamp((ndl + .45) / 1.45, 0.0, 1.0);
    float ao = mix(.38, 1.0, pow(t, .6));
    if(uMode < .5){
      ao *= mix(.55, 1.0, smoothstep(.95, 1.5, e));                                        // dimple around the eyes
      vec2 tq = (vBase.xy - (uTie + vec2(0.0, 3.0))) / (uTieHalf * vec2(1.25, 1.5));
      ao *= 1.0 - .42 * uTieOn * smoothstep(1.15, .15, length(tq));                          // contact shadow under the tie
    }
    if(uMode > 1.5) ao *= mix(.5, 1.0, smoothstep(-1.0, -.15, vL.x) * (uK > .5 ? 0.0 : 1.0) + (uK > .5 ? 1.0 : 0.0));
    float rim = pow(1.0 - clamp(Ng.z, 0.0, 1.0), 2.6);
    vec3 lit = col * diff * ao + uRim * rim * (.3 + .7 * t) * .85;
    float sh = pow(max(dot(reflect(-uLight, Ng), vec3(0.0, 0.0, 1.0)), 0.0), 16.0) * t * .26;
    lit += vec3(.72, .78, 1.0) * sh * ao;
    if(uMode < .5){ float sp = pow(smoothstep(2.1, 1.0, e), 1.6) * .3; lit += uGlow * sp * (.25 + .75 * t); }
    lit = lit / (1.0 + lit * .12);                                                      // gentle roll-off, no harsh bloom
    float a = alpha * uAlpha;
    gl_FragColor = vec4(lit * a, a);
  }`;

  function sh(type, src){
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function buildMesh(){
    const LA = 26, LO = 38, v = [], ix = [];
    for(let i = 0; i <= LA; i++){
      const th = i / LA * Math.PI;
      for(let j = 0; j <= LO; j++){
        const ph = j / LO * Math.PI * 2;
        v.push(Math.sin(th) * Math.cos(ph), -Math.cos(th), Math.sin(th) * Math.sin(ph));
      }
    }
    // y = -cos(th) (tip at y = -1 for th = 0), z = sin·sin(ph): front of the sphere faces the viewer when z > 0
    for(let i = 0; i < LA; i++) for(let j = 0; j < LO; j++){
      const a = i * (LO + 1) + j, b = a + LO + 1;
      ix.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ix), gl.STATIC_DRAW);
    return { vb, ib, n: ix.length };
  }

  function init(){
    try{
      canvas = document.createElement("canvas");
      canvas.className = "cr-gl"; canvas.setAttribute("aria-hidden", "true");
      gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: !lite(), depth: true, powerPreference: "default" });
      if(!gl) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for(let i = 0; i < n; i++){ const nm = gl.getActiveUniform(prog, i).name; U[nm] = gl.getUniformLocation(prog, nm); }
      mesh = buildMesh();
      const aP = gl.getAttribLocation(prog, "aP");
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vb); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      tilt.insertBefore(canvas, tilt.firstChild);
      canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); stop(); document.body.classList.remove("gl-fur"); }, false);
      canvas.addEventListener("webglcontextrestored", () => { if(init2()) start(); }, false);
      return true;
    }catch(err){
      try{ console.warn("[DABSy] 3D fur unavailable, using CSS fur:", err && err.message); }catch(_){}
      if(canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return false;
    }
  }
  function init2(){ if(canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas); return init() && (document.body.classList.add("gl-fur"), true); }

  /* ---------------- reading the live look (colours, tie, placement) ---------------- */
  function readColours(){
    const cs = getComputedStyle(face);
    const hi = cssToRgb(cs.getPropertyValue("--fur-hi")), mid = cssToRgb(cs.getPropertyValue("--fur-mid")), lo = cssToRgb(cs.getPropertyValue("--fur-lo"));
    if(hi) state.fur.hi = hi; if(mid) state.fur.mid = mid; if(lo) state.fur.lo = lo;
    const g = (cs.getPropertyValue("--glow-rgb") || "").trim().split(",").map(Number);
    if(g.length === 3 && g.every(x => !isNaN(x))) state.glow = g.map(x => x / 255);
  }
  function syncTie(){
    const knot = document.querySelector("#slot-neck .bow-knot"), svg = face.querySelector(".cr-wear");
    const stops = document.querySelectorAll("#slot-neck linearGradient stop");
    if(!knot || !svg || !stops.length){ state.tie.on = false; document.body.classList.remove("gl-tie"); return; }
    try{
      const inv = svg.getScreenCTM().inverse(), m = inv.multiply(knot.getScreenCTM());   // knot local -> svg user space (independent of CSS tilt)
      const bb = knot.getBBox();
      const pt = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
      const c = pt(bb.x + bb.width / 2, bb.y + bb.height / 2);
      const wv = Math.hypot(m.a, m.b) * bb.width;            // knot width in design units (art knot = 20 × .55 = 11)
      state.tie.x = c.x; state.tie.y = c.y; state.tie.s = Math.max(.3, wv / 11);
      const c1 = cssToRgb(stops[0].getAttribute("stop-color")), c2 = cssToRgb(stops[stops.length - 1].getAttribute("stop-color")), k = cssToRgb(knot.getAttribute("fill"));
      if(c1) state.tie.c1 = c1; if(c2) state.tie.c2 = c2; state.tie.k = k || c2 || state.tie.k;
      state.tie.on = true; document.body.classList.add("gl-tie");
    }catch(_){ state.tie.on = false; }
  }
  function syncForm(){ state.bodyTarget = face.dataset.form === "furry" ? 1 : 0; }
  function sizeCanvas(){
    const w = tilt.offsetWidth, h = tilt.offsetHeight; if(!w || !h) return false;
    const cssW = w * VW / W, cssH = h * VH / H;
    const dpr = Math.min(window.devicePixelRatio || 1, lite() ? 1 : 2) * (face.dataset.form === "minimal" ? 1.14 : 1) * state.quality;
    const pw = Math.max(64, Math.round(cssW * dpr)), ph = Math.max(64, Math.round(cssH * dpr));
    if(canvas.width !== pw || canvas.height !== ph){ canvas.width = pw; canvas.height = ph; gl.viewport(0, 0, pw, ph); }
    return true;
  }

  /* ---------------- drawing ---------------- */
  const set3 = (n, a) => gl.uniform3f(U[n], a[0], a[1], a[2]);
  function drawPart(p, shells){
    gl.uniform3f(U.uC, p.c[0], p.c[1], p.c[2]);
    gl.uniform3f(U.uR, p.r[0], p.r[1], p.r[2]);
    gl.uniformMatrix3fv(U.uRot, false, p.rot || I3());
    gl.uniform1f(U.uMir, p.mir || 1); gl.uniform1f(U.uWarp, p.warp || 0);
    gl.uniform1f(U.uLen, p.len); gl.uniform1f(U.uDens, p.dens); gl.uniform1f(U.uMode, p.mode);
    gl.uniform1f(U.uK, p.knot ? 1 : 0);
    gl.uniform3f(U.uDroop, state.wind * p.len * .35, p.len * .55, 0);
    set3("uRoot", p.root); set3("uMid", p.mid); set3("uTip", p.tip); set3("uInner", p.inner || p.mid); set3("uC2", p.c2 || p.mid);
    gl.frontFace((p.mir || 1) < 0 ? gl.CW : gl.CCW);
    for(let i = 0; i <= shells; i++){
      gl.uniform1f(U.uT, i / shells);
      gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0);
    }
  }
  const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function frame(now){
    raf = requestAnimationFrame(frame);
    if(document.hidden) return;
    const reduced = D.ui && D.ui.reducedMotion && D.ui.reducedMotion();
    const target = reduced ? 66 : 33;                    // ≈30 fps is plenty for slow plush motion, and kind to batteries
    if(now - last < target - 2) return;
    const dt = Math.min(64, now - last || 16); last = now;

    // adaptive quality (lowers resolution if the device struggles)
    state.acc += dt; state.frames++;
    if(state.frames === 45){
      const avg = state.acc / state.frames;
      if(avg > 52 && state.quality > .6){ state.quality = Math.max(.6, state.quality - .15); canvas.width = 0; }
      state.frames = 0; state.acc = 0;
    }

    // gaze → parallax turn (smoothed), read from the same variables the DOM eyes use
    const tx = parseFloat(tilt.style.getPropertyValue("--tx")) || 0, ty = parseFloat(tilt.style.getPropertyValue("--ty")) || 0;
    const ty0 = reduced ? 0 : tx / 5 * .2, tp0 = reduced ? 0 : -ty / 3 * .13;
    state.yaw += (ty0 - state.yaw) * .14; state.pitch += (tp0 - state.pitch) * .14;
    state.wind = reduced ? 0 : Math.sin(now / 1900) * .5 + Math.sin(now / 770) * .2;
    state.bodyA += (state.bodyTarget - state.bodyA) * .12;
    if(Math.abs(state.bodyTarget - state.bodyA) < .01) state.bodyA = state.bodyTarget;
    if(state.pop > 0) state.pop = Math.max(0, state.pop - dt / 420);
    if(!sizeCanvas()) return;

    gl.useProgram(prog);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform2f(U.uView, VW / 2, VH / 2); gl.uniform2f(U.uViewC, W / 2, H / 2);
    gl.uniform3f(U.uPiv, 150, 200, 0);
    gl.uniformMatrix3fv(U.uG, false, mul3(rotY(state.yaw), rotX(state.pitch)));
    const L = [-.45, -.62, .64], ln = Math.hypot(L[0], L[1], L[2]);
    gl.uniform3f(U.uLight, L[0] / ln, L[1] / ln, L[2] / ln);
    set3("uRim", mixc(state.fur.hi, [.6, .55, 1], .5));
    set3("uGlow", state.glow);
    gl.uniform2f(U.uEyeL, 115, 172); gl.uniform2f(U.uEyeR, 185, 172);
    const tie = state.tie;
    gl.uniform2f(U.uTie, tie.x, tie.y); gl.uniform2f(U.uTieHalf, 30 * tie.s, 12 * tie.s);
    gl.uniform1f(U.uTieOn, tie.on ? 1 : 0);

    const q = state.quality, lt = lite();
    const SB = Math.max(8, Math.round((lt ? 10 : 16) * q)), SE = Math.max(6, Math.round((lt ? 7 : 11) * q)), ST = Math.max(5, Math.round((lt ? 5 : 8) * q));
    const f = state.fur;

    if(state.bodyA > .01){
      gl.uniform1f(U.uAlpha, state.bodyA);
      const root = mixc(f.lo, f.mid, .25), tip = mixc(f.hi, [.78, .82, 1], .12), bmid = mixc(f.mid, f.hi, .08);
      gl.uniform1f(U.uEyeOn, 1);
      const breathe = 1 + Math.sin(now / 2300) * .004;
      drawPart({ c: [150, 196, 0], r: [112 * breathe, 114 * breathe, 104], len: 8.5, dens: .78, mode: 0, root, mid: bmid, tip }, SB);
      gl.uniform1f(U.uEyeOn, 0);
      const earRoot = mixc(f.lo, f.mid, .5), earTip = mixc(f.hi, [.7, .75, 1], .2), inner = [.58, .42, .85];
      const sway = state.wind * .03;
      drawPart({ c: [86, 92, 34], r: [19, 30, 10], rot: rotZ(-.6 + sway), warp: 1, len: 5.2, dens: 1.0, mode: 1, root: earRoot, mid: mixc(f.mid, f.hi, .35), tip: earTip, inner }, SE);
      drawPart({ c: [214, 92, 34], r: [19, 30, 10], rot: rotZ(.6 - sway), warp: 1, len: 5.2, dens: 1.0, mode: 1, root: earRoot, mid: mixc(f.mid, f.hi, .35), tip: earTip, inner }, SE);
    }
    if(tie.on){
      gl.uniform1f(U.uAlpha, 1); gl.uniform1f(U.uEyeOn, 0);
      const s = tie.s * (1 + state.pop * .14 * Math.sin(state.pop * Math.PI)), z = 108;
      const c1 = tie.c1, c2 = tie.c2, kc = tie.k;
      const lobe = mir => ({ c: [tie.x + mir * 16 * s, tie.y, z], r: [17 * s, 13.5 * s, 7 * s], mir, warp: 2, len: 1.7 * s, dens: 1.35 / Math.max(.6, s), mode: 2, root: mulc(c2, .78), mid: c1, tip: c1, c2, inner: kc });
      drawPart(lobe(1), ST); drawPart(lobe(-1), ST);
      drawPart({ c: [tie.x, tie.y, z + 5], r: [5.8 * s, 7.6 * s, 8 * s], len: 1.5 * s, dens: 1.4 / Math.max(.6, s), mode: 2, knot: true, root: mulc(kc, .78), mid: kc, tip: mixc(kc, [1, 1, 1], .25), c2: kc, inner: kc }, ST);
    }
  }

  function start(){ if(!raf){ last = 0; raf = requestAnimationFrame(frame); } }
  function stop(){ if(raf){ cancelAnimationFrame(raf); raf = 0; } }

  function boot(){
    if(!init()) return;
    ok = true;
    document.body.classList.add("gl-fur");
    // the canvas covers the box + margins
    canvas.style.cssText = `position:absolute;left:${-MX / W * 100}%;top:${-MY / H * 100}%;width:${VW / W * 100}%;height:${VH / H * 100}%;pointer-events:none`;
    readColours(); syncForm(); syncTie();
    state.bodyA = state.bodyTarget;
    const resync = () => { readColours(); syncForm(); setTimeout(syncTie, 30); setTimeout(syncTie, 760); };
    if(bus){ bus.on("outfit:changed", resync); bus.on("outfit:form", resync); bus.on("tie:pop", () => { state.pop = 1; }); }
    new MutationObserver(() => { syncForm(); readColours(); }).observe(face, { attributes: true, attributeFilter: ["data-form", "data-outfit", "style"] });
    window.addEventListener("resize", () => { setTimeout(syncTie, 60); });
    window.addEventListener("orientationchange", () => { setTimeout(syncTie, 300); });
    setInterval(() => { if(!document.hidden) syncTie(); }, 1500);
    document.addEventListener("visibilitychange", () => { if(document.hidden) stop(); else start(); });
    start();
  }
  D.fur3d = { isActive: () => ok, resync: () => { readColours(); syncForm(); syncTie(); } };
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
