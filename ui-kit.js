/* ============================================================
   D.A.B.S.y — ui-kit.js
   Small shared UI primitives so every surface (permission popups,
   notification centre, settings, ecosystem sheets, toasts) looks and
   behaves the same:

     ui.popup()   — a DABSy-voiced dialog that resolves with the chosen value
     ui.sheet()   — a glass sheet (bottom or top) with focus handling
     ui.toast()   — a swipe-away in-app nudge
     ui.icon()    — the inline icon set (no icon font, no network)

   Everything here is plain DOM; no framework, no build step.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;

  /* ---------------- icons ---------------- */
  const P = {
    bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    book: '<path d="M12 6.5C10.5 5 8 4.5 4.5 4.5v13c3.5 0 6 .5 7.5 2 1.5-1.5 4-2 7.5-2v-13C16 4.5 13.5 5 12 6.5Z"/><path d="M12 6.5v13"/>',
    leaf: '<path d="M5 19c0-8 4-13 14-14 0 9-4.5 14-12 14"/><path d="M5 19c3-4 6-6.5 9-8"/>',
    count: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
    sliders: '<path d="M5 8h8M17 8h2M5 16h2M11 16h8"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21"/>',
    sparkle: '<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8L12 4Z"/>',
    left: '<path d="M14.5 6l-6 6 6 6"/>',
    right: '<path d="M9.5 6l6 6-6 6"/>',
    undo: '<path d="M9 7L5 11l4 4"/><path d="M5 11h9a4.5 4.5 0 0 1 0 9h-3"/>',
    external: '<path d="M13 5h6v6M19 5l-8 8"/><path d="M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V9a1.5 1.5 0 0 1 1.5-1.5H10"/>',
    video: '<rect x="4" y="6" width="12" height="12" rx="2.5"/><path d="M16 10.5l4.5-2.5v8L16 13.5"/>',
    doc: '<path d="M7 4h7l4 4v12H7V4Z"/><path d="M14 4v4h4M9.5 12h5M9.5 15.5h5"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/>',
    pencil: '<path d="M5 19l1-4L16.5 4.5a2 2 0 0 1 3 3L9 18l-4 1Z"/>',
    play: '<path d="M8 5v14l11-7L8 5Z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    skip: '<path d="M6 5v14l9-7-9-7Z"/><path d="M18 5v14"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
    shirt: '<path d="M8 4L3.5 7l2 3.5L8 9.5V20h8V9.5l2.5 1 2-3.5L16 4a4 4 0 0 1-8 0Z"/>',
    shield: '<path d="M12 3.5l7 2.5v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-2.5Z"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.7M12 16.8v.1"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
    flag: '<path d="M6 20V5M6 5h11l-2 3.5 2 3.5H6"/>',
    repeat: '<path d="M17 4l3 3-3 3M20 7H8a4 4 0 0 0-4 4M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1A3.5 3.5 0 0 1 17 18H7Z"/>',
    device: '<rect x="7" y="3.5" width="10" height="17" rx="2.5"/><path d="M11 17.5h2"/>',
    star: '<path d="M12 4l2.4 5 5.4.7-4 3.7 1 5.4L12 16.2 7.2 18.8l1-5.4-4-3.7 5.4-.7L12 4Z"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    tap: '<path d="M10 11V6a1.7 1.7 0 0 1 3.4 0v5"/><path d="M13.4 10.5a1.7 1.7 0 0 1 3.3.3v1a1.7 1.7 0 0 1 3.2.6v3.2c0 3.2-2.4 5.4-5.5 5.4-2 0-3.6-.9-4.6-2.4L6.5 14a1.6 1.6 0 0 1 2.6-1.8L10 13"/>',
  };
  function icon(name, size){
    const s = size || 20;
    return `<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
  }

  /* ---------------- tiny helpers ---------------- */
  function escapeHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }
  function el(tag, attrs, ...kids){
    const n = document.createElement(tag);
    if(attrs) Object.keys(attrs).forEach(k=>{
      const v = attrs[k];
      if(v == null || v === false) return;
      if(k === "class") n.className = v;
      else if(k === "html") n.innerHTML = v;
      else if(k === "text") n.textContent = v;
      else if(k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach(k=>{ if(k == null || k === false) return; n.append(k.nodeType ? k : document.createTextNode(String(k))); });
    return n;
  }
  function uid(p){ return (p||"id") + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function pad(n){ return String(n).padStart(2,"0"); }
  function fmtTime(d){
    d = d instanceof Date ? d : new Date(d);
    return d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  }
  function dateKey(d){
    d = d || new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function relTime(ts){
    const diff = Date.now() - ts;
    const m = Math.round(diff / 60000);
    if(m < 1) return "just now";
    if(m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if(h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  }
  function dayLabel(d){
    const key = dateKey(d), today = dateKey(), tmr = dateKey(new Date(Date.now()+864e5));
    if(key === today) return "Today";
    if(key === tmr) return "Tomorrow";
    return d.toLocaleDateString([], { weekday:"short", day:"numeric", month:"short" });
  }
  function reducedMotion(){
    const pref = window.DABSy.memory?.getSettings().reduceMotion || "auto";
    if(pref === "on") return true;
    if(pref === "off") return false;
    return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function vibrate(ms){ try{ if(!reducedMotion()) navigator.vibrate?.(ms); }catch(e){} }
  function applyMotionPref(){ document.body && document.body.classList.toggle("reduce-motion", reducedMotion()); }
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  /* The little DABSy face used inside popups / toasts / notification rows. */
  function miniFace(){
    return el("span", { class: "mini-face", "aria-hidden": "true" }, el("i"), el("i"));
  }

  /* ---------------- focus handling ---------------- */
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function trapFocus(container, onEscape){
    const prev = document.activeElement;
    function key(e){
      if(e.key === "Escape"){ e.stopPropagation(); onEscape && onEscape(); return; }
      if(e.key !== "Tab") return;
      const items = [...container.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
      if(!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
    container.addEventListener("keydown", key);
    return () => { container.removeEventListener("keydown", key); try{ prev && prev.focus && prev.focus({ preventScroll:true }); }catch(e){} };
  }

  /* ---------------- popup (DABSy asks, user answers) ---------------- */
  let popupLayer = null;
  const popupQueue = [];
  let popupBusy = false;

  function ensurePopupLayer(){
    if(popupLayer) return popupLayer;
    popupLayer = el("div", { id: "popup-layer" });
    document.body.append(popupLayer);
    return popupLayer;
  }

  // popup({ title, text, content?, actions:[{label,value,kind}], dismissValue })
  // resolves with the chosen action's value (or dismissValue on Esc/backdrop).
  function popup(opts){
    return new Promise(resolve => {
      popupQueue.push({ opts, resolve });
      pumpPopups();
    });
  }
  function pumpPopups(){
    if(popupBusy || !popupQueue.length) return;
    popupBusy = true;
    const { opts, resolve } = popupQueue.shift();
    const layer = ensurePopupLayer();
    const id = uid("pop");
    const actions = opts.actions && opts.actions.length ? opts.actions : [{ label:"OK", value:true, kind:"primary" }];
    const dismissValue = ("dismissValue" in opts) ? opts.dismissValue : null;

    const card = el("div", { class: "popup-card", role: "dialog", "aria-modal": "true", "aria-labelledby": id + "t", "aria-describedby": id + "d" },
      miniFace(),
      el("h2", { id: id + "t", text: opts.title || "" }),
      opts.text ? el("p", { id: id + "d", text: opts.text }) : null,
      opts.content || null,
      el("div", { class: "popup-actions" }, actions.map(a =>
        el("button", { class: "btn " + (a.kind || "ghost"), type: "button", "data-value": String(a.value), onclick: () => finish(a.value) }, a.label)
      ))
    );
    const backdrop = el("div", { class: "popup-backdrop", onclick: () => { if(opts.dismissible !== false) finish(dismissValue); } });
    const wrap = el("div", { class: "popup" }, backdrop, card);
    layer.append(wrap);
    layer.classList.add("on");

    const release = trapFocus(card, () => { if(opts.dismissible !== false) finish(dismissValue); });
    let done = false;
    function finish(value){
      if(done) return; done = true;
      release();
      wrap.classList.remove("open");
      setTimeout(() => {
        wrap.remove();
        if(!layer.children.length) layer.classList.remove("on");
        popupBusy = false;
        resolve(value);
        pumpPopups();
      }, 200);
    }
    nextFrame().then(() => {
      wrap.classList.add("open");
      (card.querySelector("input") || card.querySelector(".btn.primary") || card.querySelector(".btn"))?.focus({ preventScroll:true });
    });
    bus.emit("ui:popup", { title: opts.title });
  }

  /* ---------------- sheets ---------------- */
  let sheetCount = 0;
  function sheet(opts){
    opts = opts || {};
    const side = opts.side || "bottom";
    const layer = el("div", { class: "sheet-layer side-" + side });
    layer.style.zIndex = String(60 + sheetCount * 2);
    sheetCount++;
    const titleId = uid("sh");
    const closeBtn = el("button", { class: "icon-btn", type: "button", "aria-label": "Close", html: icon("close", 18), onclick: () => close() });
    const actionsWrap = el("div", { class: "sheet-head-actions" }, (opts.headerActions || []), closeBtn);
    const titleEl = el("h2", { id: titleId, text: opts.title || "" });
    const body = el("div", { class: "sheet-body" });
    const panel = el("div", { class: "sheet " + (opts.className || ""), role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      el("div", { class: "sheet-grip", "aria-hidden": "true" }),
      el("header", { class: "sheet-head" }, titleEl, actionsWrap),
      body
    );
    const backdrop = el("div", { class: "sheet-backdrop", onclick: () => close() });
    layer.append(backdrop, panel);
    document.body.append(layer);
    document.body.classList.add("sheet-open");

    let closed = false, resolveClosed;
    const closedPromise = new Promise(r => { resolveClosed = r; });
    const release = trapFocus(panel, () => close());

    function close(result){
      if(closed) return; closed = true;
      release();
      layer.classList.remove("open");
      sheetCount = Math.max(0, sheetCount - 1);
      setTimeout(() => {
        layer.remove();
        if(!document.querySelector(".sheet-layer")) document.body.classList.remove("sheet-open");
        opts.onClose && opts.onClose(result);
        resolveClosed(result);
      }, 240);
    }
    nextFrame().then(() => { layer.classList.add("open"); closeBtn.focus({ preventScroll:true }); });
    return { el: layer, panel, body, close, closed: closedPromise, setTitle: t => { titleEl.textContent = t; } };
  }

  /* ---------------- toasts (in-app nudges) ---------------- */
  let toastLayer = null;
  function ensureToastLayer(){
    if(toastLayer) return toastLayer;
    toastLayer = el("div", { id: "toast-layer", "aria-live": "polite", "aria-atomic": "false" });
    document.body.append(toastLayer);
    return toastLayer;
  }

  // toast({ title, text, actions:[{label,primary,onClick}], timeout, onDismiss })
  function toast(opts){
    const layer = ensureToastLayer();
    const live = () => [...layer.children].filter(c => !c.classList.contains("out"));
    while(live().length >= 2){ const f = live()[0]; if(f.__close) f.__close("replaced"); else break; }
    const node = el("div", { class: "toast", role: "status" },
      miniFace(),
      el("div", { class: "toast-text" },
        opts.title ? el("strong", { text: opts.title }) : null,
        opts.text ? el("span", { text: opts.text }) : null,
        (opts.actions && opts.actions.length) ? el("div", { class: "toast-actions" }, opts.actions.map(a =>
          el("button", { type: "button", class: "btn sm " + (a.primary ? "primary" : "ghost"), onclick: () => { try{ a.onClick && a.onClick(); }finally{ close("action"); } } }, a.label)
        )) : null
      ),
      el("button", { class: "icon-btn sm", type: "button", "aria-label": "Dismiss", html: icon("close", 16), onclick: () => close("dismissed") })
    );
    layer.append(node);
    let timer = null, gone = false;
    function close(reason){
      if(gone) return; gone = true;
      clearTimeout(timer);
      node.classList.remove("in");
      node.classList.add("out");
      setTimeout(() => node.remove(), 260);
      opts.onDismiss && opts.onDismiss(reason);
    }
    node.__close = close;
    const timeout = opts.timeout == null ? 9000 : opts.timeout;
    if(timeout > 0) timer = setTimeout(() => close("timeout"), timeout);

    // swipe sideways to dismiss — a gesture that genuinely fits "put this away"
    let sx = 0, dx = 0, dragging = false;
    node.addEventListener("pointerdown", e => {
      if(e.target.closest("button")) return;
      dragging = true; sx = e.clientX; dx = 0; clearTimeout(timer);
      try{ node.setPointerCapture(e.pointerId); }catch(_){}
    });
    node.addEventListener("pointermove", e => {
      if(!dragging) return;
      dx = e.clientX - sx;
      node.style.transform = `translateX(${dx}px)`;
      node.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 240));
    });
    const end = () => {
      if(!dragging) return; dragging = false;
      if(Math.abs(dx) > 90) close("swiped");
      else { node.style.transform = ""; node.style.opacity = ""; if(timeout > 0) timer = setTimeout(() => close("timeout"), 4000); }
    };
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);

    nextFrame().then(() => node.classList.add("in"));
    return { close, el: node };
  }

  /* ---------------- shared a11y: live region ---------------- */
  let live = null;
  function announce(text){
    if(!live){ live = el("div", { class: "sr-only", "aria-live": "polite", role: "status" }); document.body.append(live); }
    live.textContent = "";
    setTimeout(() => { live.textContent = text; }, 40);
  }

  window.DABSy.ui = {
    icon, el, escapeHtml, uid, pad, fmtTime, dateKey, relTime, dayLabel,
    vibrate, reducedMotion, applyMotionPref, nextFrame, miniFace,
    popup, sheet, toast, announce, trapFocus,
  };
  document.addEventListener("DOMContentLoaded", applyMotionPref);
  bus.on("settings:changed", applyMotionPref);
  if(window.matchMedia) try{ matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", applyMotionPref); }catch(e){}
})();
