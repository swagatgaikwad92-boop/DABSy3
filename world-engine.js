/* ============================================================
   D.A.B.S.y — world-engine.js   (MAGIC WORLD)
   Puts DABSy INSIDE the supplied room artwork and lets her live there.

   What it owns
     · the scene   (#world): the real room picture, soft lamp glows, a light
                   shade for legibility. Day/night = the supplied day/night
                   artwork when it exists; no CSS colour filter is ever used
                   to fake a missing variant.
     · the layers  of the supplied character (body, eyes, bow, halo, lint),
                   built from assets/magic/ only while Magic World is on.
     · the layout  picture -> screen mapping ("cover" with a focus point),
                   DABSy's size, and every habitat spot's screen position,
                   recomputed on resize / rotation / keyboard.
     · the motion  an explicit state machine (below). The whole creature
                   moves with the individual CSS properties `translate` and
                   `scale` (GPU-composited, no per-frame JS, no rAF loop).

   States
     IDLE_AT_HOME            resting on her home spot; a timer may start a stroll
     CHOOSING_DESTINATION    (instant) picks a visible spot, looks toward it
     MOVING_TO_DESTINATION   gliding there with a gentle waddle
     IDLE_AT_DESTINATION     dwelling; then another spot or home
     RETURNING_HOME          gliding back (user tap, or her own choice)
     INTERACTING             a chat / keyboard / sheet / session is in use:
                             no strolling; with chat or keyboard she steps up
                             above them ("attend") so she stays visible
     RESTING                 sleepy: goes home and stays put

   Only ONE timer is ever pending (idle/dwell), one arrival timer while
   moving, one auto-light timer. Nothing runs while the app is hidden.

   v10.2
     · wallpapers: setHabitat(id) switches the room (and DABSy's resting spots with it); the choice is persisted.
     · Day / Night is ONE control owned by theme-engine (DABSy.theme). The room follows the interface theme;
       the device clock is never consulted unless the user explicitly chose "Auto".
     · roaming defaults to OFF: DABSy rests on her home object (pillow / desk / sill). Strolling to other real
       objects in the room is an opt-in setting.

   Public API  DABSy.world
     active() state() isAway() returnHome() snapshot()
     setHabitat(id)  habitatId()  habitats()  setRoam("off"|"calm"|"lively")
     setLight(v) (kept for compatibility: forwards to DABSy.theme)  lightInfo()  roam()  habitat()
   ============================================================ */
(function(){
  "use strict";
  const D = window.DABSy, bus = D.bus, ui = D.ui, memory = D.memory, DATA = D.worldData;
  const el = ui.el;
  const PREF_KEY = "world_v1";
  const DEFAULTS = { roam: "off", habitat: "window-nook", v: 2 };
  let prefs = Object.assign({}, DEFAULTS, memory.read(PREF_KEY, {}));
  // v10.2 migration: earlier versions defaulted to "calm" roaming (she sat on random spots) and kept their own light pref
  if(prefs.v !== 2){ prefs.roam = "off"; prefs.v = 2; }
  delete prefs.light;
  if(!["off", "calm", "lively"].includes(prefs.roam)) prefs.roam = "off";
  if(!DATA.habitats.some(h => h.id === prefs.habitat)) prefs.habitat = DEFAULTS.habitat;

  const stage = document.getElementById("stage");
  const wrap = document.getElementById("creature-wrap");
  const face = document.getElementById("face");
  const baseLabel = face.getAttribute("aria-label") || "";

  /* ---- fixed geometry of the creature box (300 x 330 units, shared with the wardrobe SVG) ---- */
  const BOX_W = 300, BOX_H = 330, BODY_U_W = 270, FEET = .97, FEET_OFF = FEET - .5;
  const CH = DATA.character;
  const U = BODY_U_W / CH.bodyW;
  const OX = (BOX_W - BODY_U_W) / 2, OY = BOX_H * FEET - CH.bodyH * U;
  const BODY_H_FRAC = (CH.bodyH * U) / BOX_H;                   // body height as a fraction of the box
  const OVERSCAN = 1.03;                                         // picture drawn 3 % larger than "cover" (room for the camera drift)
  const TOP_SAFE = 92;                                           // keep clear of the bell button / status bar
  const PACE = {
    calm:   { home: [16000, 32000], dwell: [12000, 26000], speed: 85 },
    lively: { home: [ 7000, 14000], dwell: [ 6000, 13000], speed: 130 },
  };
  const OVERLAY_CLASSES = ["sheet-open", "eco-open", "session-active", "study-active", "live-talk", "booting", "touring"];

  const ST = { HOME: "IDLE_AT_HOME", CHOOSE: "CHOOSING_DESTINATION", MOVE: "MOVING_TO_DESTINATION", DEST: "IDLE_AT_DESTINATION", BACK: "RETURNING_HOME", BUSY: "INTERACTING", REST: "RESTING" };

  let active = false, state = ST.HOME, habitat = DATA.habitats.find(h => h.id === prefs.habitat) || DATA.habitats[0];
  let curSpot = null, target = null, attend = false, attendFrom = null, resting = false;
  let timer = 0, moveTimer = 0, lastInteract = 0, hops = 0, touching = false, raf = 0;
  let L = { W: 0, H: 0, sceneW: 0, sceneH: 0, ox: 0, oy: 0, box: 160 };
  let worldEl = null, sceneEl = null, shownVariant = null;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduced = () => ui.reducedMotion();
  const homeSpot = () => habitat.spots.find(s => s.home) || habitat.spots[0];
  const spotById = id => habitat.spots.find(s => s.id === id) || null;

  /* ============================================================
     light (day / night)
     ============================================================ */
  function hasVariant(n){ return !!habitat.variants[n]; }
  // the room follows the interface Day/Night control (DABSy.theme). It never reads the clock itself.
  function wantedLight(){ return D.theme && D.theme.resolved && D.theme.resolved() === "light" ? "day" : "night"; }
  function effectiveLight(){
    const want = wantedLight();
    if(hasVariant(want)) return want;
    return hasVariant("night") ? "night" : (hasVariant("day") ? "day" : null);
  }
  function lightInfo(){ return { pref: D.theme ? D.theme.mode() : "night", effective: effectiveLight(), hasDay: hasVariant("day"), hasNight: hasVariant("night"), dayIsGrade: !!(habitat.variants.day && habitat.variants.day.grade) }; }
  function variantSrc(v){
    const base = v.from ? habitat.variants[v.from] : v, src = base.src;
    return /^data:/.test(src) ? src : assetUrl(src.split("/").pop());
  }
  function paintVariant(animate){
    if(!worldEl) return;
    const name = effectiveLight(); if(!name || name === shownVariant) { paintLights(); return; }
    const v = habitat.variants[name];
    const img = new Image(); img.className = "w-bg"; img.alt = ""; img.decoding = "async"; img.draggable = false; img.dataset.variant = name;
    if(v.grade) img.dataset.grade = v.grade;
    img.setAttribute("aria-hidden", "true");
    const show = () => {
      const old = [...sceneEl.querySelectorAll(".w-bg")].filter(n => n !== img);
      requestAnimationFrame(() => { img.classList.add("on"); old.forEach(o => o.classList.remove("on")); setTimeout(() => old.forEach(o => o.remove()), animate && !reduced() ? 1000 : 0); });
      shownVariant = name; worldEl.classList.add("ready"); worldEl.dataset.light = name; worldEl.dataset.habitat = habitat.id; document.body.dataset.light = name; document.body.dataset.habitat = habitat.id;
      paintLights(); bus.emit("world:light", { light: name });
    };
    img.onload = show; img.onerror = () => { worldEl.classList.add("ready"); bus.emit("world:error", { habitat: habitat.id }); };
    img.src = variantSrc(v);
    sceneEl.insertBefore(img, sceneEl.firstChild);
    if(img.complete && img.naturalWidth) show();
  }
  function paintLights(){
    if(!sceneEl) return;
    sceneEl.querySelectorAll(".w-light").forEach(n => n.remove());
    const v = shownVariant && habitat.variants[shownVariant]; if(!v || !v.lights) return;
    v.lights.forEach(l => {
      const d = el("i", { class: "w-light", "aria-hidden": "true" });
      d.style.cssText = `left:${l.x * 100}%;top:${l.y * 100}%;width:${l.r * 100}%;padding-bottom:${l.r * 100}%;--c:${l.c};--a:${l.a};animation-delay:${l.d || 0}s`;
      sceneEl.append(d);
    });
  }

  /* ============================================================
     layout: picture -> screen, creature size, spot positions
     ============================================================ */
  function computeLayout(){
    const W = stage.clientWidth || innerWidth, H = stage.clientHeight || innerHeight;
    const k = Math.max(W / habitat.w, H / habitat.h) * OVERSCAN;
    const sceneW = habitat.w * k, sceneH = habitat.h * k;
    const ox = (W - sceneW) * habitat.focus.x, oy = (H - sceneH) * habitat.focus.y;
    const bodyPx = clamp(sceneW * habitat.baseBodyFrac, 100, 205);
    L = { W, H, sceneW, sceneH, ox, oy, box: bodyPx * BOX_W / BODY_U_W };
    if(sceneEl){ sceneEl.style.width = sceneW + "px"; sceneEl.style.height = sceneH + "px"; sceneEl.style.left = ox + "px"; sceneEl.style.top = oy + "px"; }
    wrap.style.setProperty("--mw-box", L.box.toFixed(1) + "px");
  }
  function screenOf(sp){
    const s = sp.s, bw = L.box * s;
    let fx = L.ox + sp.x * L.sceneW, fy = L.oy + sp.y * L.sceneH;
    const off = fx < -bw * .2 || fx > L.W + bw * .2 || fy < TOP_SAFE || fy > L.H + bw * .2;   // genuinely outside this screen shape
    fx = clamp(fx, bw * .46, L.W - bw * .46);
    fy = clamp(fy, TOP_SAFE + L.box * 1.1 * BODY_H_FRAC * s, L.H - 6);
    return { fx, fy, s, off, id: sp.id };
  }
  function applyPos(p, dur, ease){
    const w = L.box, h = L.box * 1.1;
    wrap.style.setProperty("--mw-dur", dur + "s");
    if(ease) wrap.style.setProperty("--mw-ease", ease);
    wrap.style.translate = (p.fx - w / 2).toFixed(1) + "px " + (p.fy - FEET_OFF * h * p.s - h / 2).toFixed(1) + "px";
    wrap.style.scale = String(+p.s.toFixed(3));
  }
  function currentFeet(){
    const r = wrap.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + FEET * r.height };
  }

  /* ---- keyboard / chat: she steps up so she stays visible above them ---- */
  function attendTarget(){
    const base = screenOf(attendFrom || homeSpot());
    const chat = document.getElementById("chat-area"), sub = document.getElementById("subtitle");
    let limit = L.H - 8;
    if(chat){ const r = chat.getBoundingClientRect(); if(r.height) limit = Math.min(limit, r.top - 10); }
    if(sub && sub.classList.contains("visible") && !document.body.classList.contains("kb-open")){ const r = sub.getBoundingClientRect(); if(r.height) limit = Math.min(limit, r.top - 8); }
    const bodyH = L.box * 1.1 * BODY_H_FRAC, avail = limit - TOP_SAFE;
    let s = Math.min(base.s, .92);
    if(bodyH * s > avail) s = Math.max(.42, avail / bodyH);
    return { fx: base.fx, fy: Math.max(TOP_SAFE + bodyH * s, Math.min(base.fy, limit)), s, id: "attend" };
  }

  /* top edge (screen px) of the highest place DABSy rests / may visit: widgets stay above this line */
  function restTop(){
    if(!active) return null;
    const bodyPx = .81 * L.box, spots = prefs.roam === "off" ? [homeSpot()] : habitat.spots.filter(sp => !screenOf(sp).off);
    return Math.min(...spots.map(sp => { const p = screenOf(sp); return p.fy - (bodyPx + L.box * .09) * p.s; }));
  }
  /* ---- Study Mode / Study Block: she shrinks to a compact companion at the top, above the explanation ---- */
  let companion = false;
  function companionTarget(){
    const surf = document.getElementById("projection-surface"), sr = surf && surf.getBoundingClientRect();
    const feetY = sr && sr.height ? sr.top - 4 : 150, bodyH = L.box * 1.1 * BODY_H_FRAC;
    const s = clamp((feetY - 54) / bodyH, .3, .5);
    return { fx: L.W / 2, fy: feetY, s, id: "companion" };
  }

  /* ============================================================
     motion
     ============================================================ */
  function setState(s){
    if(state === s) return; state = s;
    document.body.classList.toggle("mw-away", isAway());
    document.body.dataset.worldState = s;
    face.setAttribute("aria-label", isAway() ? "D.A.B.S.y is exploring the room. Tap, or press Enter, to call her home. Double-tap the bow tie for apps, press and hold for tasks." : baseLabel);
    bus.emit("world:state", { state: s });
  }
  const isAway = () => active && !attend && !resting && (state === ST.MOVE || state === ST.DEST || state === ST.BACK);
  const atHome = () => !!curSpot && curSpot.id === homeSpot().id && state !== ST.MOVE && state !== ST.BACK;

  function travel(p, { speed, minS = 1.1, maxS = 4.6, camera = true } = {}){
    clearTimeout(moveTimer);
    const from = currentFeet();
    const dist = Math.hypot(p.fx - from.x, p.fy - from.y);
    let dur = reduced() ? .35 : clamp(dist / (speed || 85), minS, maxS);
    if(dist < 4 && Math.abs((+wrap.style.scale || 1) - p.s) < .01) dur = .01;
    const ease = "cubic-bezier(.42,.02,.24,1)";
    // look where she is going (restrained: only the eyes), start the gait, nudge the camera
    const dx = p.fx - from.x; try{ D.face.look(clamp(dx / (L.W * .25), -1, 1) * .8, p.fy < from.y ? -.25 : .15); }catch(e){}
    if(!reduced() && dur > .5) face.classList.add("walking");
    if(camera && !reduced() && sceneEl) sceneEl.style.setProperty("--w-cam", clamp(-dx / L.W * 16, -6, 6).toFixed(1) + "px");
    applyPos(p, dur, ease);
    moveTimer = setTimeout(() => arrived(p), dur * 1000 + 80);
    return dur;
  }
  function arrived(p){
    clearTimeout(moveTimer);
    face.classList.remove("walking");
    if(sceneEl) sceneEl.style.setProperty("--w-cam", "0px");
    try{ D.face.settle(); }catch(e){}
    if(p.id === "attend" || p.id === "companion") return;
    curSpot = spotById(p.id) || curSpot;
    const home = curSpot && curSpot.id === homeSpot().id;
    if(!reduced() && !attend) bus.emit("face:react", { name: "nod" });
    if(attend) return;
    if(resting && home){ setState(ST.REST); return; }
    setState(home ? ST.HOME : ST.DEST);
    if(home) hops = 0;
    schedule();
  }

  /* pick where to go next (CHOOSING_DESTINATION) */
  function chooseDestination(){
    setState(ST.CHOOSE);
    const home = homeSpot();
    const pool = habitat.spots.filter(s => (!curSpot || s.id !== curSpot.id) && !screenOf(s).off);
    const away = pool.filter(s => s.id !== home.id);
    // away from home for two hops already, or nowhere else to go: head home
    if(curSpot && curSpot.id !== home.id && (hops >= 2 || !away.length || Math.random() < .5)) return goHome(false);
    if(!away.length) { setState(atHome() ? ST.HOME : ST.DEST); schedule(); return; }
    const dest = away[Math.floor(Math.random() * away.length)];
    hops++;
    setState(ST.MOVE); target = dest;
    travel(screenOf(dest), { speed: PACE[prefs.roam].speed });
  }
  function goHome(user){
    const home = homeSpot();
    if(attend) return false;
    if(state === ST.BACK) return true;
    if(atHome()) return false;
    clearTimeout(timer); target = home; setState(ST.BACK);
    travel(screenOf(home), user ? { speed: 210, minS: .7, maxS: 2.2 } : { speed: PACE[prefs.roam].speed * 1.2 });
    return true;
  }
  /* the user's tap while she is away: acknowledge instantly, then walk her home */
  function returnHome(){
    if(!active || !isAway()) return false;
    lastInteract = Date.now();
    bus.emit("face:ripple", { index: 0 }); try{ D.face.blinkOnce(false); }catch(e){}
    ui.vibrate(10);
    const moving = goHome(true);
    ui.announce("Coming back to " + homeSpot().label + ".");
    return moving || state === ST.BACK;
  }

  /* ---- scheduling: at most one pending timer ---- */
  function blocked(){
    const c = document.body.classList;
    if(OVERLAY_CLASSES.some(k => c.contains(k)) || c.contains("cmd-open") || c.contains("kb-open")) return true;
    const pop = document.getElementById("popup-layer"); if(pop && pop.classList.contains("on")) return true;
    if(document.querySelector(".tour-layer, #tour, .tour-card")) return true;
    return false;
  }
  function schedule(){
    clearTimeout(timer); timer = 0;
    if(!active || state === ST.MOVE || state === ST.BACK) return;
    if(prefs.roam === "off" || reduced() || document.hidden || attend || resting) return;        // nothing to wait for; resume() restarts it
    const P = PACE[prefs.roam], atH = atHome();
    const wait = atH ? rnd(P.home[0], P.home[1]) : rnd(P.dwell[0], P.dwell[1]);
    timer = setTimeout(tick, wait);
  }
  function tick(){
    timer = 0;
    if(!active || attend || resting || prefs.roam === "off" || reduced() || document.hidden || blocked() || touching) return;   // resume() restarts the wait when that changes
    const quietFor = Date.now() - lastInteract;
    if(quietFor <= 10000){ timer = setTimeout(tick, 10200 - quietFor); return; }                                               // just touched: wait out the rest, once
    if(atHome() || state === ST.DEST) chooseDestination();
  }
  function resume(){ if(active && !blocked()) schedule(); }

  /* ---- overlays: chat/keyboard -> attend; sheets etc. -> pause ---- */
  let syncT = 0;
  function syncOverlays(){
    if(!active) return;
    const c = document.body.classList;
    const wantCompanion = c.contains("study-active") || c.contains("session-active");
    if(wantCompanion && !companion){
      companion = true; if(!attend) attendFrom = attendFrom || curSpot || homeSpot();
      attend = true; clearTimeout(timer); clearTimeout(moveTimer); face.classList.remove("walking"); setState(ST.BUSY);
      requestAnimationFrame(() => travel(companionTarget(), { speed: 260, minS: .5, maxS: 1.2, camera: false }));
      return;
    }
    if(companion && !wantCompanion){ companion = false; attend = false; /* fall through to restore */ if(attendFrom){ const back = attendFrom; attendFrom = null; curSpot = back; target = back; setState(back.id === homeSpot().id ? ST.HOME : ST.DEST); travel(screenOf(back), { speed: 260, minS: .5, maxS: 1.2, camera: false }); } return; }
    if(companion){ applyPos(companionTarget(), reduced() ? .2 : .3); return; }
    const wantAttend = c.contains("cmd-open") || c.contains("kb-open");
    if(wantAttend && !attend){
      attend = true; attendFrom = curSpot || homeSpot();
      clearTimeout(timer); clearTimeout(moveTimer); face.classList.remove("walking");
      setState(ST.BUSY);
      travel(attendTarget(), { speed: 240, minS: .6, maxS: 1.4, camera: false });
    } else if(wantAttend && attend){
      applyPos(attendTarget(), reduced() ? .2 : .5);
    } else if(!wantAttend && attend){
      attend = false; const back = attendFrom || homeSpot(); attendFrom = null;
      curSpot = back; target = back;
      setState(back.id === homeSpot().id ? ST.HOME : ST.DEST);
      travel(screenOf(back), { speed: 240, minS: .6, maxS: 1.4, camera: false });
    } else if(blocked()){
      clearTimeout(timer); timer = 0;
      if(state === ST.HOME || state === ST.DEST) { /* stay put until resume() */ }
    } else { resume(); }
  }
  const obs = new MutationObserver(() => { clearTimeout(syncT); syncT = setTimeout(syncOverlays, 30); });

  /* ---- layout changes: rotation, resize, keyboard ---- */
  function relayout(){
    raf = 0; if(!active) return;
    computeLayout();
    const p = companion ? companionTarget() : attend ? attendTarget() : screenOf((state === ST.MOVE || state === ST.BACK) && target ? target : (curSpot || homeSpot()));
    clearTimeout(moveTimer); face.classList.remove("walking");
    applyPos(p, 0);                                                      // snap: no glide across a changed screen shape
    void wrap.offsetWidth;
    if(state === ST.MOVE || state === ST.BACK){ curSpot = target; setState(curSpot.id === homeSpot().id ? ST.HOME : ST.DEST); schedule(); }
    if(!hasVariant(shownVariant)) paintVariant(false);
  }
  const onResize = () => { if(!raf) raf = requestAnimationFrame(relayout); };

  /* ============================================================
     DOM: scene + character layers (built only while Magic World is on)
     ============================================================ */
  /* ---- artwork: embedded bundle first (always deploys with the root files), the assets/ folder as a second route ---- */
  const assetUrl = f => (D.worldAssets && D.worldAssets[f]) || (DATA.assets + f);
  let assetsState = "idle", assetsErr = "";                        // idle | loading | ready | failed
  function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("could not load " + src)); document.head.appendChild(s); }); }
  function preload(file){
    return new Promise((res, rej) => {
      const i = new Image(); const t = setTimeout(() => rej(new Error("timed out: " + file)), 9000);
      i.onload = () => { clearTimeout(t); (i.decode ? i.decode().catch(() => {}) : Promise.resolve()).then(res); };
      i.onerror = () => { clearTimeout(t); rej(new Error("failed: " + file)); };
      i.src = assetUrl(file);
    });
  }
  /* a habitat's own picture: the built-in illustrated rooms are data: pictures (instant); the supplied photo is a file */
  async function ensureHabitat(h){
    const files = Object.values(h.variants).filter(v => v && v.src && !/^data:/.test(v.src)).map(v => v.src.split("/").pop());
    await Promise.all(files.map(preload)); return true;
  }
  async function ensureAssets(){
    if(assetsState === "ready") return true;
    assetsState = "loading"; assetsErr = "";
    try{
      if(!D.worldAssets){ try{ await loadScript("./magic-assets.js"); }catch(e){ /* fall through: the folder route may still work */ } }
      await Promise.all(Object.values(CH.files).map(preload));
      await ensureHabitat(habitat);
      assetsState = "ready"; return true;
    }catch(e){ assetsState = "failed"; assetsErr = String(e && e.message || e); return false; }
  }
  function pct(v, of){ return (v / of * 100).toFixed(3) + "%"; }
  function setVars(){
    const r = document.documentElement.style;
    const put = (n, o) => { r.setProperty(`--mw-${n}-x`, pct(OX + o.x * U, BOX_W)); r.setProperty(`--mw-${n}-y`, pct(OY + o.y * U, BOX_H)); r.setProperty(`--mw-${n}-w`, pct(o.w * U, BOX_W)); r.setProperty(`--mw-${n}-h`, pct(o.h * U, BOX_H)); };
    put("body", { x: 0, y: 0, w: CH.bodyW, h: CH.bodyH });
    put("eyeL", CH.eyeL); put("eyeR", CH.eyeR); put("bow", CH.bow); put("fleck", CH.flecks);
    put("halo", { x: -CH.halo.pad, y: -CH.halo.pad, w: CH.bodyW + CH.halo.pad * 2, h: CH.bodyH + CH.halo.pad * 2 });
    r.setProperty("--mw-eye-l", `url("${assetUrl(CH.files.eyeL)}")`); r.setProperty("--mw-eye-r", `url("${assetUrl(CH.files.eyeR)}")`);
  }
  function buildCharacter(){
    if(face.querySelector(".mw-body")) return;
    const tilt = face.querySelector(".cr-tilt"), firstEye = document.getElementById("eye-left");
    const mk = (cls, file) => { const i = new Image(); i.className = "mw-layer " + cls; i.alt = ""; i.decoding = "async"; i.draggable = false; i.setAttribute("aria-hidden", "true"); i.src = assetUrl(file); return i; };
    [mk("mw-halo", CH.files.halo), mk("mw-flecks", CH.files.flecks), mk("mw-body", CH.files.body)].forEach(n => tilt.insertBefore(n, firstEye));
    const bow = mk("mw-bow", CH.files.bow); bow.id = "mw-bow"; tilt.insertBefore(bow, tilt.querySelector(".cr-wear"));
  }
  function destroyCharacter(){ face.querySelectorAll(".mw-layer").forEach(n => n.remove()); }
  function buildScene(){
    if(worldEl) return;
    worldEl = el("div", { id: "world", "aria-hidden": "true" });
    sceneEl = el("div", { class: "w-scene" });
    worldEl.append(sceneEl, el("div", { class: "w-shade" }), el("div", { class: "w-dim" }));
    stage.insertBefore(worldEl, stage.firstChild);
  }
  function destroyScene(){ if(worldEl){ worldEl.remove(); worldEl = sceneEl = null; shownVariant = null; delete document.body.dataset.light; } }

  /* ============================================================
     on / off
     ============================================================ */
  function enter(){
    if(active) return;
    active = true; setVars(); buildScene(); buildCharacter(); computeLayout();
    curSpot = homeSpot(); target = curSpot; attend = false; resting = false; hops = 0; lastInteract = Date.now() - 4000;
    applyPos(screenOf(curSpot), 0); void wrap.offsetWidth;
    state = ST.HOME; document.body.dataset.worldState = state; document.body.classList.remove("mw-away");
    paintVariant(false);
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    syncOverlays();
    schedule();
  }
  function exit(){
    if(!active) return;
    active = false; clearTimeout(timer); clearTimeout(moveTimer); obs.disconnect();
    face.classList.remove("walking"); document.body.classList.remove("mw-away"); delete document.body.dataset.worldState;
    wrap.style.translate = ""; wrap.style.scale = ""; wrap.style.removeProperty("--mw-dur"); wrap.style.removeProperty("--mw-box");
    face.setAttribute("aria-label", baseLabel);
    destroyCharacter(); destroyScene();
  }
  let syncToken = 0;
  function syncForm(){
    const form = D.outfits && D.outfits.form ? D.outfits.form() : document.body.dataset.form;
    const my = ++syncToken;
    if(form !== "magic"){ exit(); document.body.classList.remove("mw-loading"); return; }
    if(active) return;
    document.body.classList.add("mw-loading");                      // creature stays hidden for the moment it takes to load; never longer than the preload timeout
    ensureAssets().then(ok => {
      if(my !== syncToken) return;                                  // the user changed presentation meanwhile
      document.body.classList.remove("mw-loading");
      if(ok){ enter(); return; }
      // the artwork really could not load: show Classic DABSy (the real classic assets) instead of broken pictures
      console.warn("[Magic World] artwork unavailable, showing Classic:", assetsErr);
      if(D.outfits && D.outfits.setForm) D.outfits.setForm("minimal", { auto: true });
      ui.toast({ text: "Magic World's pictures didn't load, so I'm showing Classic DABSy. Check your connection and try again from Settings.", timeout: 7000 });
    });
  }

  /* ---- user preferences ---- */
  function save(){ memory.write(PREF_KEY, prefs); }
  function setLight(v){                           // compatibility: Day / Night is owned by the theme engine
    if(!["auto", "day", "night"].includes(v) || !D.theme) return false;
    D.theme.setMode(v); return true;
  }
  /* wallpaper: switch the room. DABSy's resting spots are the new room's, so she is re-seated (no glide across rooms). */
  async function setHabitat(id){
    const h = DATA.habitats.find(x => x.id === id); if(!h) return false;
    if(h.id === prefs.habitat && active && shownVariant) return true;
    try{ await ensureHabitat(h); }catch(e){ return false; }      // a broken picture is reported, never silently selected
    prefs.habitat = h.id; save(); habitat = h;
    if(active){
      clearTimeout(timer); clearTimeout(moveTimer); face.classList.remove("walking");
      shownVariant = null; sceneEl.querySelectorAll(".w-bg,.w-light").forEach(n => n.remove());
      curSpot = homeSpot(); target = curSpot; hops = 0; attend = false; attendFrom = null;
      computeLayout(); applyPos(screenOf(curSpot), 0); void wrap.offsetWidth;
      state = ST.HOME; document.body.dataset.worldState = state; document.body.classList.remove("mw-away");
      paintVariant(false); syncOverlays(); schedule();
    }
    bus.emit("world:habitat", { id: h.id }); bus.emit("world:prefs", { ...prefs });
    return true;
  }
  function setRoam(v){
    if(!["off", "calm", "lively"].includes(v)) return false;
    prefs.roam = v; save(); clearTimeout(timer); timer = 0;
    if(v === "off"){ if(isAway()) goHome(false); } else resume();
    bus.emit("world:prefs", { ...prefs }); return true;
  }

  /* ---- events ---- */
  bus.on("outfit:form", syncForm);
  bus.on("outfit:changed", syncForm);
  bus.on("face:tap-away", () => returnHome());
  bus.on("face:pressdown", () => { touching = true; lastInteract = Date.now(); clearTimeout(timer); timer = 0; });
  bus.on("face:pressup", () => { touching = false; lastInteract = Date.now(); if(active) resume(); });
  ["face:tap", "face:doubletap", "face:longpress", "user:said", "voice:heard", "face:petted"].forEach(e => bus.on(e, () => { lastInteract = Date.now(); }));
  bus.on("dabsy:say", () => { if(attend) setTimeout(() => { if(attend) applyPos(attendTarget(), .4); }, 90); });
  bus.on("settings:changed", () => { if(!active) return; if(reduced()){ clearTimeout(timer); timer = 0; face.classList.remove("walking"); if(isAway()) goHome(false); } else resume(); });
  bus.on("state:change", ({ to }) => {
    if(!active) return;
    if(to === "SLEEPY" && !resting){ resting = true; clearTimeout(timer); timer = 0; if(!attend){ if(atHome()) setState(ST.REST); else goHome(false); } }
    else if(to !== "SLEEPY" && resting){ resting = false; if(state === ST.REST) setState(ST.HOME); resume(); }
  });
  bus.on("memory:wiped", () => { prefs = Object.assign({}, DEFAULTS); save(); if(active){ shownVariant = null; paintVariant(false); } });
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 260));
  // the viewport engine announces ONCE when the keyboard has finished moving (no per-frame listener here)
  document.addEventListener("dabsy:kbsettled", () => { if(active && attend) applyPos(attendTarget(), reduced() ? .2 : .35); });
  bus.on("theme:changed", () => { if(active) paintVariant(true); });
  document.addEventListener("visibilitychange", () => {
    if(!active) return;
    if(document.hidden){ clearTimeout(timer); timer = 0; face.classList.remove("walking"); }
    else {
      if(state === ST.MOVE || state === ST.BACK){ arrived(target || homeSpot()); }          // a transition may not have run in the background: land her where she was going
      else resume();
      paintVariant(false);
    }
  });

  /* ---- public ---- */
  function snapshot(){
    return { active, state, away: isAway(), attend, resting, spot: curSpot && curSpot.id, home: homeSpot().id, light: effectiveLight(), prefs: { ...prefs },
      layout: { ...L }, spots: habitat.spots.map(s => ({ id: s.id, ...screenOf(s) })), feet: active ? currentFeet() : null, timers: { idle: !!timer, move: !!moveTimer } , habitat: habitat.id };
  }
  D.world = {
    active: () => active, state: () => state, isAway, returnHome, snapshot, setLight, setRoam, lightInfo,
    roam: () => prefs.roam, restTop, habitat: () => habitat, habitatId: () => prefs.habitat, habitats: () => DATA.habitats, setHabitat, relayout: onResize,
    assets: () => ({ state: assetsState, error: assetsErr, embedded: !!D.worldAssets }), assetUrl,
    /* for tests and the settings preview only */
    _goto(id){ const sp = spotById(id); if(!active || !sp) return false; clearTimeout(timer); target = sp; hops = 1; setState(sp.id === homeSpot().id ? ST.BACK : ST.MOVE); travel(screenOf(sp), { speed: 240, minS: .5, maxS: 1.2 }); return true; },
  };
  syncForm();
})();
