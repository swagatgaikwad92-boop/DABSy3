/* ============================================================
   D.A.B.S.y — outfit-engine.js
   Reads the data in outfits-data.js and puts it on the creature.

     outfits.equipOutfit(id)          wear a base look
     outfits.equipAccessory(slot,id)  add / remove one extra piece
     outfits.unlock(id)               unlock (achievements / Easter eggs)
     outfits.list() / listAccessories()   for the Wardrobe UI
     outfits.preview(id,isAcc)        small SVG used in Wardrobe tiles
     outfits.previewCurrent()         SVG of what DABSy is wearing right now
     outfits.setForm("minimal"|"furry")   v8 FUR MODE (persisted with the wardrobe)
     outfits.setTie(paletteId)            bow-tie colour

   The creature itself has four empty SVG groups (#slot-neck, #slot-eyes,
   #slot-ears, #slot-head). This engine only fills them — it never knows
   what any specific outfit looks like.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const ui = window.DABSy.ui;
  const { OUTFITS, ACCESSORIES, SLOTS, PLACEMENT, TIE_PALETTES, BOWS } = window.DABSy.outfitData;
  const KEY = "wardrobe_v1";
  const face = document.getElementById("face");

  const DEFAULT_FUR = ["#7482d8", "#4552a6", "#222a66"];
  // form: "minimal" (default: floating eyes + bow tie) | "furry" (fur aura).  tie: bow-tie palette id.
  let state = Object.assign({ outfit: "classic", acc: { eyes: null, ears: null, head: null }, unlocked: [], form: "furry", tie: "outfit" }, memory.read(KEY, {}));
  // v8.2: the plush 3D character is the default look; saved devices move to it once (Settings → Wardrobe → Fur mode still switches it off)
  if(!state.v82){ state.form = "furry"; state.v82 = 1; try{ memory.write(KEY, state); }catch(_){} }
  if(state.form !== "furry") state.form = "minimal";
  if(!TIE_PALETTES.some(t => t.id === state.tie)) state.tie = "outfit";
  state.acc = Object.assign({ eyes: null, ears: null, head: null }, state.acc || {});

  function save(){ memory.write(KEY, state); }
  const byId = id => OUTFITS.find(o => o.id === id) || null;
  const accById = id => ACCESSORIES.find(a => a.id === id) || null;

  /* ---------------- progress metrics for achievement unlocks ---------------- */
  function metric(name){
    if(name === "sessions") return memory.read("sessions_v1", []).filter(s => s.status === "done").length;
    if(name === "tasksDone"){
      const t = window.DABSy.tasks ? window.DABSy.tasks.list() : [];
      return t.reduce((n, x) => n + (x.status === "done" ? 1 : 0) + Object.values(x.occurrences || {}).filter(o => o.status === "done").length, 0);
    }
    if(name === "visits") return (memory.getPetStats().streak || 0);
    return 0;
  }

  function isUnlocked(item){
    const u = item.unlock || { type: "default" };
    if(u.type === "default") return true;
    if(state.unlocked.includes(item.id)) return true;
    if(u.type === "achievement") return metric(u.metric) >= u.gte;
    return false;
  }
  function isAvailable(item, d){
    const a = item.availability; if(!a) return true;
    d = d || new Date();
    if(a.months) return a.months.includes(d.getMonth() + 1);
    if(a.from && a.to){
      const md = ui.pad(d.getMonth() + 1) + "-" + ui.pad(d.getDate());
      return a.from <= a.to ? (md >= a.from && md <= a.to) : (md >= a.from || md <= a.to);
    }
    return true;
  }
  // an item the user explicitly unlocked is always wearable, even out of season
  function canEquip(item){ return isUnlocked(item) && (isAvailable(item) || state.unlocked.includes(item.id)); }

  /* ---------------- bow tie colour + per-presentation placement ---------------- */
  const hexRe = c => new RegExp(c.replace("#", "#"), "gi");
  function tinted(neck, tieId){
    const pal = TIE_PALETTES.find(t => t.id === tieId);
    if(!neck || !pal || !pal.c) return neck || "";
    const m = /id="g-([a-z0-9-]+)"/.exec(neck); if(!m || !BOWS[m[1]]) return neck;
    const from = BOWS[m[1]], to = pal.c;
    // replace the three bow colours (stops + knot) — scarves, collars, garlands use other colours
    let out = neck;
    from.forEach((c, i) => { out = out.replace(hexRe(c), "§" + i + "§"); });
    to.forEach((c, i) => { out = out.split("§" + i + "§").join(c); });
    return out;
  }
  function placeStyle(slot, item, form){
    const base = (PLACEMENT[form] && PLACEMENT[form][slot]) || {};
    const own = (item && item.place && item.place[form]) || {};
    const p = Object.assign({}, base, own);
    const o = p.o || [150, 172];
    const parts = [];
    if(p.x || p.y) parts.push(`translate(${p.x || 0}px,${p.y || 0}px)`);
    if(p.r) parts.push(`rotate(${p.r}deg)`);
    if(p.s && p.s !== 1) parts.push(`scale(${p.s})`);
    return `transform:${parts.join(" ") || "none"};transform-origin:${o[0]}px ${o[1]}px`;
  }
  // one slot → its SVG markup, wrapped in a positioned group
  function slotMarkup(slot, outfit, accMap, form, tieId){
    const acc = accMap && accMap[slot] ? accById(accMap[slot]) : null;
    const raw = acc ? acc.part : ((outfit.parts && outfit.parts[slot]) || "");
    const inner = slot === "neck" && !acc ? tinted(raw, tieId) : raw;
    return `<g class="wear-item" style="${placeStyle(slot, acc, form)}">${inner}</g>`;
  }

  /* ---------------- rendering onto the creature ---------------- */
  function apply(){
    const outfit = byId(state.outfit) || byId("classic");
    SLOTS.forEach(slot => {
      const g = document.getElementById("slot-" + slot); if(!g) return;
      g.innerHTML = slotMarkup(slot, outfit, state.acc, state.form, state.tie);
    });
    const t = outfit.tint || {};
    const fur = t.fur || DEFAULT_FUR;
    face.style.setProperty("--fur-hi", fur[0]);
    face.style.setProperty("--fur-mid", fur[1]);
    face.style.setProperty("--fur-lo", fur[2]);
    if(t.eye){ face.style.setProperty("--eye-rgb", t.eye); face.style.setProperty("--glow-rgb", t.glow || t.eye); }
    else { face.style.removeProperty("--eye-rgb"); face.style.removeProperty("--glow-rgb"); }
    face.dataset.outfit = outfit.id;
    face.dataset.form = state.form;
    document.body.dataset.form = state.form;
    bus.emit("outfit:changed", { outfit: outfit.id, acc: { ...state.acc }, form: state.form, tie: state.tie });
  }

  /* ---------------- presentation: Minimal <-> Furry ----------------
     Only the look changes. Eyes, bow tie, accessories, memory, settings and
     every running animation are untouched. Fur layers are removed from the
     page (display:none) once the fade-out ends, so Minimal costs nothing.  */
  let formTimer = null;
  function paintForm(animate){
    const fur = state.form === "furry";
    clearTimeout(formTimer);
    face.dataset.form = state.form; document.body.dataset.form = state.form;
    if(fur){
      face.classList.remove("fur-off");                    // put the layers back, then fade them in
      if(animate){ void face.offsetWidth; face.classList.add("form-anim"); }
      face.classList.add("fur-on");
    } else {
      face.classList.remove("fur-on");
      if(animate) face.classList.add("form-anim");
      formTimer = setTimeout(() => face.classList.add("fur-off"), animate ? 720 : 0);
    }
    if(animate) setTimeout(() => face.classList.remove("form-anim"), 900);
  }
  function setForm(form){
    form = form === "furry" ? "furry" : "minimal";
    if(form === state.form) return false;
    state.form = form; save();
    paintForm(!window.DABSy.ui.reducedMotion());
    // re-place (not re-draw) every worn piece so it glides to its new spot
    SLOTS.forEach(slot => {
      const w = document.getElementById("slot-" + slot)?.firstElementChild; if(!w) return;
      const acc = state.acc[slot] ? accById(state.acc[slot]) : null;
      w.setAttribute("style", placeStyle(slot, acc, state.form));
    });
    document.body.dataset.form = form; face.dataset.form = form;
    bus.emit("outfit:form", { form });
    bus.emit("outfit:changed", { outfit: state.outfit, acc: { ...state.acc }, form, tie: state.tie });
    return true;
  }
  function setTie(id){
    if(!TIE_PALETTES.some(t => t.id === id)) return false;
    state.tie = id; save(); apply();
    bus.emit("outfit:equipped", { id: "tie:" + id });
    return true;
  }

  function equipOutfit(id){
    const o = byId(id); if(!o || !canEquip(o)) return false;
    state.outfit = id; save(); apply();
    bus.emit("outfit:equipped", { id });
    return true;
  }
  function equipAccessory(slot, id){
    if(id){
      const a = accById(id); if(!a || !canEquip(a)) return false;
      state.acc[a.slot] = id;
    } else state.acc[slot] = null;
    save(); apply();
    bus.emit("outfit:equipped", { id: id || null });
    return true;
  }

  /* ---------------- unlocking ---------------- */
  function unlock(id, quiet){
    const item = byId(id) || accById(id); if(!item) return false;
    if(state.unlocked.includes(id)) return false;
    state.unlocked.push(id);
    save();
    if(!quiet){
      ui.toast({ title: "New in the wardrobe", text: item.name + " is yours. Find it in Settings → Wardrobe.", timeout: 8000 });
      window.DABSy.director.dispatch("SUCCESS_MOMENT", { speakText: null });
    }
    bus.emit("outfit:unlocked", { id });
    return true;
  }
  // announce achievement-based unlocks exactly once
  let firstCheck = !memory.read("wardrobe_announced_v1", null);
  function checkAchievements(){
    const seen = memory.read("wardrobe_announced_v1", []);
    let changed = false;
    OUTFITS.concat(ACCESSORIES).forEach(item => {
      const u = item.unlock || {};
      if(u.type === "achievement" && metric(u.metric) >= u.gte && !seen.includes(item.id)){
        seen.push(item.id); changed = true;
        // the very first check on a fresh install should not shower the user with toasts
        if(!firstCheck) ui.toast({ title: "New in the wardrobe", text: item.name + " is yours. Find it in Settings → Wardrobe.", timeout: 8000 });
      }
    });
    firstCheck = false;
    if(changed || !memory.read("wardrobe_announced_v1", null)) memory.write("wardrobe_announced_v1", seen);
  }

  /* ---------------- lists + previews for the Wardrobe UI ---------------- */
  function describe(item){
    const unlocked = isUnlocked(item), available = isAvailable(item);
    const u = item.unlock || {};
    let note = "";
    if(!unlocked) note = u.type === "achievement" ? u.hint : "A hidden surprise";
    else if(!available && !state.unlocked.includes(item.id)) note = "Out of season";
    return { ...item, unlocked, available, equippable: canEquip(item), note };
  }
  const list = () => OUTFITS.map(describe);
  const listAccessories = () => ACCESSORIES.map(describe);

  let pv = 0;
  // form: "minimal" | "furry" (defaults to what DABSy wears now). Minimal previews draw only eyes + bow tie + gear.
  function render(outfit, accMap, form, tieId){
    const n = ++pv;
    form = form || state.form;
    const fur = (outfit.tint && outfit.tint.fur) || DEFAULT_FUR;
    let parts = "";
    SLOTS.forEach(slot => { parts += slotMarkup(slot, outfit, accMap, form, tieId == null ? state.tie : tieId); });
    const body = form === "furry" ? `
      <ellipse cx="88" cy="96" rx="26" ry="32" transform="rotate(-18 88 96)" fill="${fur[1]}"/><ellipse cx="212" cy="96" rx="26" ry="32" transform="rotate(18 212 96)" fill="${fur[1]}"/>
      <path d="M150 78 C222 78 262 124 262 196 C262 270 222 312 150 312 C78 312 38 270 38 196 C38 124 78 78 150 78Z" fill="url(#pb)"/>` : "";
    const eyeFill = form === "furry" ? "#bfe9ff" : "var(--pv-eye,#d9ecff)";
    const svg = `<svg viewBox="0 0 300 330" class="pv-${form}" aria-hidden="true">
      <defs><radialGradient id="pb" cx=".35" cy=".25" r="1"><stop offset="0" stop-color="${fur[0]}"/><stop offset=".5" stop-color="${fur[1]}"/><stop offset="1" stop-color="${fur[2]}"/></radialGradient></defs>
      ${body}
      <rect x="82" y="137" width="46" height="71" rx="22" style="fill:${eyeFill}" class="pv-eye"/><rect x="172" y="137" width="46" height="71" rx="22" style="fill:${eyeFill}" class="pv-eye"/>
      ${parts}</svg>`;
    // keep every gradient id unique per preview, so many previews can share one page
    return svg.replace(/(id="|url\(#)(g-[a-z0-9-]+|pb)/g, `$1pv${n}-$2`);
  }
  function preview(id, isAccessory){
    if(isAccessory){ const a = accById(id); return render(byId("classic"), { [a.slot]: a.id }, null, "outfit"); }
    return render(byId(id) || byId("classic"), null, null, "outfit");
  }
  function previewCurrent(){ return render(byId(state.outfit) || byId("classic"), state.acc); }
  // a tile for the Minimal/Furry chooser (never shows accessories, so the two looks compare cleanly)
  function previewForm(form){ return render(byId(state.outfit) || byId("classic"), null, form); }
  function previewTie(tieId){ return render(byId(state.outfit) || byId("classic"), null, "minimal", tieId); }

  window.DABSy.outfits = {
    equipOutfit, equipAccessory, unlock, isUnlocked, list, listAccessories, preview, previewCurrent, previewForm, previewTie, metric,
    setForm, form: () => state.form, setTie, tie: () => state.tie, tiePalettes: () => TIE_PALETTES,
    checkAchievements, current: () => ({ outfit: state.outfit, acc: { ...state.acc }, form: state.form, tie: state.tie }), apply,
  };

  // an outfit that is out of season quietly falls back to classic
  const cur = byId(state.outfit);
  if(!cur || !canEquip(cur)) state.outfit = "classic";
  paintForm(false);
  apply();
  checkAchievements();
  bus.on("tasks:completed", () => checkAchievements());
  bus.on("session:finished", () => checkAchievements());
  bus.on("memory:wiped", () => { state = { outfit: "classic", acc: { eyes: null, ears: null, head: null }, unlocked: [], form: "furry", v82: 1, tie: "outfit" }; paintForm(false); apply(); });
})();
