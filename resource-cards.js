/* ============================================================
   D.A.B.S.y — resource-cards.js
   Pick study material one card at a time.
     drag right / "Choose"  → keep it       drag left / "Skip" → reject it
   Every gesture has a button and an arrow key. Choices are fed to the
   learning engine (types/sources you pick or skip) and to the planner.
   ============================================================ */
(function(){
  const ui = window.DABSy.ui;
  const learning = window.DABSy.learning;
  const ICON = { video: "video", article: "doc", practice: "pencil", quiz: "pencil", notes: "doc", pdf: "doc", course: "book", link: "external" };
  const LABEL = { video: "Video", article: "Article", practice: "Practice", quiz: "Quiz", notes: "Notes", pdf: "PDF", course: "Course", link: "Link" };

  function relevanceEl(r){
    if(r.relevance == null){
      return ui.el("span", { class: "tag" }, r.origin === "library" ? "You used this before" : "Search link");
    }
    const lvl = r.relevance >= 0.75 ? 3 : r.relevance >= 0.5 ? 2 : 1;
    const word = lvl === 3 ? "Strong match" : lvl === 2 ? "Good match" : "Possible match";
    const bars = ui.el("span", { class: "rel", role: "img", "aria-label": word });
    [1, 2, 3].forEach(i => bars.append(ui.el("i", { class: i <= lvl ? "on" : "" })));
    return ui.el("span", { class: "rel-wrap" }, bars, ui.el("span", { class: "rel-text" }, word));
  }

  function cardEl(r){
    const dur = r.durationMin ? `${r.durationMin} min` : "";
    return ui.el("article", { class: "rcard", tabindex: "0", "aria-label": `${LABEL[r.type] || "Resource"}: ${r.title}, from ${r.source}${dur ? ", " + dur : ""}` },
      ui.el("div", { class: "rc-stamp rc-yes", "aria-hidden": "true" }, "Choose"),
      ui.el("div", { class: "rc-stamp rc-no", "aria-hidden": "true" }, "Skip"),
      ui.el("div", { class: "rc-meta" },
        ui.el("span", { class: "rc-type", html: ui.icon(ICON[r.type] || "doc", 16) + `<span>${LABEL[r.type] || "Resource"}</span>` }),
        dur ? ui.el("span", { class: "rc-dur" }, dur) : null),
      ui.el("h3", {}, r.title),
      ui.el("div", { class: "rc-source" }, r.source),
      r.description ? ui.el("p", {}, r.description) : null,
      ui.el("div", { class: "rc-foot" }, relevanceEl(r),
        ui.el("a", { class: "rc-open", href: r.url, target: "_blank", rel: "noopener noreferrer", "aria-label": "Preview " + r.title + " in a new tab" }, "Preview ", ui.el("span", { html: ui.icon("external", 14) })))
    );
  }

  function attachDrag(card, decide){
    let sx = 0, dx = 0, on = false;
    card.addEventListener("pointerdown", e => {
      if(e.target.closest("a,button")) return;
      on = true; sx = e.clientX; dx = 0; card.classList.add("dragging");
      try{ card.setPointerCapture(e.pointerId); }catch(_){}
    });
    card.addEventListener("pointermove", e => {
      if(!on) return;
      dx = e.clientX - sx;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      card.style.setProperty("--p", Math.max(-1, Math.min(1, dx / 110)).toFixed(2));
    });
    const end = () => {
      if(!on) return; on = false; card.classList.remove("dragging");
      if(Math.abs(dx) > 95) decide(dx > 0 ? "choose" : "reject");
      else { card.style.transform = ""; card.style.setProperty("--p", 0); }
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
  }

  // pick(resources, {title, intro}) → { chosen:[], rejected:[] } | null (closed without finishing)
  function pick(resources, opts){
    opts = opts || {};
    return new Promise(resolve => {
      const chosen = [], rejected = [], log = [];
      let i = 0, finished = false;
      const sh = ui.sheet({ title: opts.title || "Pick your material", onClose: () => { if(!finished){ finished = true; resolve(null); } } });
      const body = sh.body; body.classList.add("rc-body");

      function done(){
        if(finished) return; finished = true;
        resolve({ chosen, rejected });
        sh.close();
      }
      function decide(dir){
        const r = resources[i]; if(!r) return;
        const card = body.querySelector(".rcard.top");
        (dir === "choose" ? chosen : rejected).push(r);
        log.push({ r, dir });
        if(learning) learning.recordChoice(r, dir === "choose");
        ui.announce(dir === "choose" ? "Chosen: " + r.title : "Skipped: " + r.title);
        ui.vibrate(10);
        if(card){
          card.classList.add("leaving");
          card.style.transform = `translateX(${dir === "choose" ? 130 : -130}vw) rotate(${dir === "choose" ? 18 : -18}deg)`;
          setTimeout(() => { i++; render(); }, ui.reducedMotion() ? 0 : 230);
        } else { i++; render(); }
      }
      function undo(){
        const last = log.pop(); if(!last) return;
        (last.dir === "choose" ? chosen : rejected).pop();
        i--; render();
      }

      function render(){
        body.innerHTML = "";
        if(i >= resources.length) return renderSummary();
        const left = resources.length - i;
        body.append(
          opts.intro ? ui.el("p", { class: "hint rc-intro" }, opts.intro) : null,
          ui.el("div", { class: "rc-count", "aria-live": "polite" }, `${i + 1} of ${resources.length}`, chosen.length ? ui.el("span", {}, ` · ${chosen.length} chosen`) : null)
        );
        const stack = ui.el("div", { class: "rc-stack" });
        resources.slice(i, i + 3).reverse().forEach((r, k, arr) => {
          const depth = arr.length - 1 - k;
          const c = cardEl(r);
          if(depth === 0){ c.classList.add("top"); attachDrag(c, decide); c.addEventListener("keydown", e => { if(e.key === "ArrowRight"){ e.preventDefault(); decide("choose"); } else if(e.key === "ArrowLeft"){ e.preventDefault(); decide("reject"); } }); }
          else { c.classList.add("behind"); c.style.setProperty("--d", depth); c.setAttribute("aria-hidden", "true"); c.querySelectorAll("a").forEach(a => a.tabIndex = -1); }
          stack.append(c);
        });
        body.append(stack);
        body.append(ui.el("div", { class: "rc-actions" },
          ui.el("button", { class: "icon-btn glass", type: "button", "aria-label": "Undo last choice", disabled: !log.length, html: ui.icon("undo", 20), onclick: undo }),
          ui.el("button", { class: "btn rc-skip", type: "button", onclick: () => decide("reject") }, ui.el("span", { html: ui.icon("close", 18) }), "Skip"),
          ui.el("button", { class: "btn primary rc-pick", type: "button", onclick: () => decide("choose") }, ui.el("span", { html: ui.icon("check", 18) }), "Choose")
        ));
        body.append(ui.el("p", { class: "hint rc-tip" }, "Swipe right to choose, left to skip — or use the buttons or arrow keys."));
        if(chosen.length) body.append(ui.el("button", { class: "btn ghost", type: "button", onclick: done }, `Build my plan with ${chosen.length} chosen`));
        if(left) setTimeout(() => body.querySelector(".rcard.top") && body.querySelector(".rcard.top").focus({ preventScroll: true }), 30);
      }

      function renderSummary(){
        if(!chosen.length){
          body.append(ui.el("div", { class: "empty" }, "You skipped everything. I can plan around your own notes, or you can look again."),
            ui.el("div", { class: "popup-actions" },
              ui.el("button", { class: "btn", type: "button", onclick: () => { i = 0; chosen.length = 0; rejected.length = 0; log.length = 0; render(); } }, "Look again"),
              ui.el("button", { class: "btn primary", type: "button", onclick: done }, "Plan with my own notes")));
          return;
        }
        const g = ui.el("div", { class: "group" }, ui.el("h3", {}, `You chose ${chosen.length}`));
        chosen.forEach((r, k) => g.append(ui.el("div", { class: "row" },
          ui.el("span", { html: ui.icon(ICON[r.type] || "doc", 20) }),
          ui.el("div", { class: "grow" }, ui.el("div", { class: "t" }, r.title), ui.el("div", { class: "s" }, `${LABEL[r.type] || ""} · ${r.source}${r.durationMin ? " · " + r.durationMin + " min" : ""}`)),
          ui.el("button", { class: "icon-btn sm", type: "button", "aria-label": "Remove " + r.title, html: ui.icon("close", 16), onclick: () => { rejected.push(chosen.splice(k, 1)[0]); renderSummaryAgain(); } }))));
        body.append(g, ui.el("button", { class: "btn primary", type: "button", onclick: done }, "Build my plan"),
          ui.el("button", { class: "btn ghost", type: "button", onclick: () => { i = 0; chosen.length = 0; rejected.length = 0; log.length = 0; render(); } }, "Start over"));
      }
      function renderSummaryAgain(){ body.innerHTML = ""; renderSummary(); }
      render();
    });
  }

  window.DABSy.cards = { pick };
})();
