/* ============================================================
   D.A.B.S.y — outfit-engine.js
   Reads the data in outfits-data.js and puts it on the creature.

     outfits.equipOutfit(id)          wear a base look
     outfits.equipAccessory(slot,id)  add / remove one extra piece
     outfits.unlock(id)               unlock (achievements / Easter eggs)
     outfits.list() / listAccessories()   for the Wardrobe UI
     outfits.preview(id,isAcc)        small SVG used in Wardrobe tiles
     outfits.previewCurrent()         SVG of what DABSy is wearing right now

   The creature itself has four empty SVG groups (#slot-neck, #slot-eyes,
   #slot-ears, #slot-head). This engine only fills them — it never knows
   what any specific outfit looks like.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const ui = window.DABSy.ui;
  const { OUTFITS, ACCESSORIES, SLOTS } = window.DABSy.outfitData;
  const KEY = "wardrobe_v1";
  const face = document.getElementById("face");

  const DEFAULT_FUR = ["#7482d8", "#4552a6", "#222a66"];
  let state = Object.assign({ outfit: "classic", acc: { eyes: null, ears: null, head: null }, unlocked: [] }, memory.read(KEY, {}));
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

  /* ---------------- rendering onto the creature ---------------- */
  function apply(){
    const outfit = byId(state.outfit) || byId("classic");
    SLOTS.forEach(slot => {
      const g = document.getElementById("slot-" + slot); if(!g) return;
      const acc = state.acc[slot] ? accById(state.acc[slot]) : null;
      g.innerHTML = acc ? acc.part : ((outfit.parts && outfit.parts[slot]) || "");
    });
    const t = outfit.tint || {};
    const fur = t.fur || DEFAULT_FUR;
    face.style.setProperty("--fur-hi", fur[0]);
    face.style.setProperty("--fur-mid", fur[1]);
    face.style.setProperty("--fur-lo", fur[2]);
    if(t.eye){ face.style.setProperty("--eye-rgb", t.eye); face.style.setProperty("--glow-rgb", t.glow || t.eye); }
    else { face.style.removeProperty("--eye-rgb"); face.style.removeProperty("--glow-rgb"); }
    face.dataset.outfit = outfit.id;
    bus.emit("outfit:changed", { outfit: outfit.id, acc: { ...state.acc } });
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
  function render(outfit, accMap){
    const n = ++pv;
    const fur = (outfit.tint && outfit.tint.fur) || DEFAULT_FUR;
    let parts = "";
    SLOTS.forEach(slot => {
      const a = accMap && accMap[slot] ? accById(accMap[slot]) : null;
      parts += a ? a.part : ((outfit.parts && outfit.parts[slot]) || "");
    });
    const svg = `<svg viewBox="0 0 300 330" aria-hidden="true">
      <defs><radialGradient id="pb" cx=".35" cy=".25" r="1"><stop offset="0" stop-color="${fur[0]}"/><stop offset=".5" stop-color="${fur[1]}"/><stop offset="1" stop-color="${fur[2]}"/></radialGradient></defs>
      <ellipse cx="88" cy="96" rx="26" ry="32" transform="rotate(-18 88 96)" fill="${fur[1]}"/><ellipse cx="212" cy="96" rx="26" ry="32" transform="rotate(18 212 96)" fill="${fur[1]}"/>
      <path d="M150 78 C222 78 262 124 262 196 C262 270 222 312 150 312 C78 312 38 270 38 196 C38 124 78 78 150 78Z" fill="url(#pb)"/>
      <rect x="85" y="139" width="42" height="66" rx="20" fill="#bfe9ff"/><rect x="173" y="139" width="42" height="66" rx="20" fill="#bfe9ff"/>
      ${parts}</svg>`;
    // keep every gradient id unique per preview, so many previews can share one page
    return svg.replace(/(id="|url\(#)(g-[a-z0-9-]+|pb)/g, `$1pv${n}-$2`);
  }
  function preview(id, isAccessory){
    if(isAccessory){ const a = accById(id); return render(byId("classic"), { [a.slot]: a.id }); }
    return render(byId(id) || byId("classic"), null);
  }
  function previewCurrent(){ return render(byId(state.outfit) || byId("classic"), state.acc); }

  window.DABSy.outfits = {
    equipOutfit, equipAccessory, unlock, isUnlocked, list, listAccessories, preview, previewCurrent, metric,
    checkAchievements, current: () => ({ outfit: state.outfit, acc: { ...state.acc } }), apply,
  };

  // an outfit that is out of season quietly falls back to classic
  const cur = byId(state.outfit);
  if(!cur || !canEquip(cur)) state.outfit = "classic";
  apply();
  checkAchievements();
  bus.on("tasks:completed", () => checkAchievements());
  bus.on("session:finished", () => checkAchievements());
  bus.on("memory:wiped", () => { state = { outfit: "classic", acc: { eyes: null, ears: null, head: null }, unlocked: [] }; apply(); });
})();
