/* ============================================================
   D.A.B.S.y — study-engine.js   (v10.2: flowing explanation, no step-card walls)
   Turns a question/topic into ONE readable explanation on the projection surface.

   Before: every blank-line-separated chunk of the answer became its own boxed "step" card, so any answer
   turned into a stack of cards. Now the answer is parsed into a natural document:
     heading · paragraph · definition (term — meaning) · formula line · bullet list · worked steps
   and drawn as plain typography on a single surface. Only genuine procedures (3+ numbered steps) are
   revealed progressively, one step at a time, as DABSy reads them; everything else is simply there to scroll.
   DABSy still reads along: a small pointer (▲) follows the word being spoken and the paragraph being read
   gets a thin accent bar in the margin (no box, no background).
   ============================================================ */
(function(){
  const D = window.DABSy, bus = D.bus, ai = D.ai, voice = D.voice;
  const content = document.getElementById("projection-content");
  const surface = document.getElementById("projection-surface");
  const pointer = document.getElementById("projection-pointer");
  let run = 0;                                   // bumped on every new study / stop; stale async work checks it

  const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* inline formatting: **bold**, *italic*, `code`, $math$ (just the symbols), x^2 / x^{2} */
  function inline(t){
    let h = esc(t);
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/\$([^$]+)\$/g, "<i class=\"m\">$1</i>").replace(/\^\{([^}]+)\}/g, "<sup>$1</sup>").replace(/\^(-?\d+|[a-z])\b/gi, "<sup>$1</sup>");
    return h;
  }
  const isFormula = l => { const w = l.trim().split(/\s+/).length; return w <= 11 && /[=≈→]/.test(l) && /[\d^×÷*\/+\-√²³π∆Δ]/.test(l) && !/[a-z]{5,}\s+[a-z]{4,}\s+[a-z]{4,}/i.test(l.replace(/\*/g, "")) && !/[.!?]$/.test(l.trim()); };

  /* text -> blocks */
  function parse(text){
    const lines = String(text || "").replace(/\r/g, "").split("\n"), out = [];
    let para = [], list = null;
    const flushPara = () => { if(para.length){ out.push({ t: "p", s: para.join(" ") }); para = []; } };
    const flushList = () => { if(list){ out.push(list); list = null; } };
    for(let raw of lines){
      const l = raw.trim();
      if(!l){ flushPara(); flushList(); continue; }
      let m;
      if((m = /^#{1,4}\s+(.+)$/.exec(l)) || (m = /^\*\*([^*]{2,70})\*\*:?$/.exec(l))){ flushPara(); flushList(); out.push({ t: "h", s: m[1].replace(/:$/, "") }); continue; }
      if((m = /^[-*•]\s+(.+)$/.exec(l))){ flushPara(); if(!list || list.t !== "ul"){ flushList(); list = { t: "ul", items: [] }; } list.items.push(m[1]); continue; }
      if((m = /^(\d+)[.)]\s+(.+)$/.exec(l))){ flushPara(); if(!list || list.t !== "ol"){ flushList(); list = { t: "ol", items: [] }; } list.items.push(m[2]); continue; }
      flushList();
      if(isFormula(l)){ flushPara(); out.push({ t: "f", s: l.replace(/^\$\$?|\$\$?$/g, "") }); continue; }
      if((m = /^\*\*([^*]+)\*\*\s*[:—–-]\s*(.+)$/.exec(l)) || (m = /^([A-Z][A-Za-z' ]{1,28}):\s+(.{12,})$/.exec(l))){ flushPara(); out.push({ t: "d", term: m[1], s: m[2] }); continue; }
      para.push(l);
    }
    flushPara(); flushList();
    // a short line that ends with ":" right before a list is that list's lead-in, not a heading: leave as paragraph
    return out;
  }

  /* blocks -> DOM. Returns the readable units in reading order. */
  function render(title, blocks){
    content.innerHTML = "";
    const doc = document.createElement("article"); doc.className = "study-doc";
    const h = document.createElement("h2"); h.className = "study-title"; h.textContent = title; doc.appendChild(h);
    const units = [];
    const unit = (el, spoken, opts) => { units.push(Object.assign({ el, spoken: spoken || el.textContent, track: true }, opts || {})); };
    blocks.forEach(b => {
      if(b.t === "h"){ const e = document.createElement("h3"); e.className = "study-h"; e.innerHTML = inline(b.s); doc.appendChild(e); unit(e); }
      else if(b.t === "p"){ const e = document.createElement("p"); e.innerHTML = inline(b.s); doc.appendChild(e); unit(e); }
      else if(b.t === "d"){ const e = document.createElement("p"); e.className = "study-def"; e.innerHTML = "<strong>" + inline(b.term) + "</strong> " + inline(b.s); doc.appendChild(e); unit(e); }
      else if(b.t === "f"){ const e = document.createElement("div"); e.className = "study-formula"; e.innerHTML = inline(b.s); doc.appendChild(e);
        unit(e, b.s.replace(/×/g, " times ").replace(/÷/g, " divided by ").replace(/=/g, " equals ").replace(/\^2|²/g, " squared").replace(/\^3|³/g, " cubed"), { track: false }); }
      else {
        const progressive = b.t === "ol" && b.items.length >= 3;
        const list = document.createElement(b.t); list.className = "study-list" + (b.t === "ol" ? " study-steps" : "");
        b.items.forEach(it => { const li = document.createElement("li"); li.innerHTML = inline(it); if(progressive) li.classList.add("pending"); list.appendChild(li); unit(li, null, { reveal: progressive }); });
        doc.appendChild(list);
      }
    });
    content.appendChild(doc);
    return { units, hasPending: !!doc.querySelector(".pending") };
  }

  /* wrap the words of a unit (text nodes only, so bold/italic survive) and remember each word's character offset */
  function wrapWords(root){
    const offsets = []; let pos = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      const frag = document.createDocumentFragment();
      n.nodeValue.split(/(\s+)/).forEach(tok => {
        if(!tok) return;
        if(/^\s+$/.test(tok)){ frag.appendChild(document.createTextNode(tok)); pos += tok.length; return; }
        const sp = document.createElement("span"); sp.className = "word"; sp.textContent = tok;
        offsets.push({ start: pos, end: pos + tok.length, el: sp }); pos += tok.length; frag.appendChild(sp);
      });
      n.parentNode.replaceChild(frag, n);
    });
    return offsets;
  }
  function movePointer(span){
    if(!span) return;
    const s = surface.getBoundingClientRect(), w = span.getBoundingClientRect();
    pointer.style.opacity = "1";
    pointer.style.transform = `translate(${Math.round(w.left - s.left)}px, ${Math.round(w.top - s.top - 24)}px)`;
  }
  const speaking = () => D.memory.getSettings().speakReplies !== false && !!window.speechSynthesis;
  const pause = ms => new Promise(r => setTimeout(r, ms));
  function revealIntoView(el){
    const c = content.getBoundingClientRect(), r = el.getBoundingClientRect();
    if(r.bottom > c.bottom - 24 || r.top < c.top + 8){ try{ el.scrollIntoView({ block: "center", behavior: D.ui.reducedMotion() ? "auto" : "smooth" }); }catch(e){} }
  }

  async function readAlong(units, my){
    for(const u of units){
      if(my !== run) return;
      if(u.reveal) u.el.classList.remove("pending");
      units.forEach(x => x.el.classList.toggle("reading", x === u));
      revealIntoView(u.el);
      if(speaking()){
        let offsets = [];
        if(u.track) offsets = wrapWords(u.el);
        await voice.speakWithTracking(u.spoken, ci => {
          if(my !== run || !offsets.length) return;
          const m = offsets.find(o => ci >= o.start && ci < o.end) || offsets[offsets.length - 1];
          content.querySelectorAll(".word.active").forEach(w => w.classList.remove("active"));
          m.el.classList.add("active"); movePointer(m.el);
        });
        if(my !== run) return;
        await pause(260);
      } else {
        // silent: reveal progressive steps at a comfortable reading pace; plain paragraphs don't wait at all
        if(u.reveal) await pause(Math.min(2600, 700 + u.spoken.split(/\s+/).length * 140)); else await pause(40);
      }
    }
    if(my !== run) return;
    units.forEach(x => x.el.classList.remove("reading")); content.querySelectorAll(".word.active").forEach(w => w.classList.remove("active"));
    pointer.style.opacity = "0";
    const more = content.querySelector(".study-more"); if(more) more.remove();
  }

  async function startStudy(topic){
    if(!topic || !topic.trim()) return;
    const my = ++run;
    bus.emit("projection:open");
    content.innerHTML = '<p class="study-wait">Thinking it through…</p>';
    pointer.style.opacity = "0";
    let result, lastPaint = 0;
    // while the answer is still arriving, draw what exists so far (throttled); the final render + read-along follow
    const paintPartial = text => {
      if(my !== run) return; const t = Date.now(); if(t - lastPaint < 140) return; lastPaint = t;
      render(topic.length > 70 ? topic.slice(0, 70) + "…" : topic, parse(text)); content.classList.add("streaming");
    };
    try{
      result = await ai.askDABSy(`Explain for a Class 11 science student: ${topic}`,
        { context: "Study Mode. Write a clear, readable explanation. Use a short heading or two only if the answer has distinct parts. Define key terms as 'Term: meaning'. Put each formula on its own line (e.g. F = m × a). Use a numbered list ONLY for a real worked procedure; otherwise write natural short paragraphs, or bullets for revision. Match the length to the question: a simple fact gets one or two sentences. Reply in the language the student wrote in (English, Hindi, Marathi or a mix); keep equations and technical terms readable.", onPartial: paintPartial });
    }catch(e){ result = null; }
    if(my !== run) return;
    if(!result || !result.text){ content.innerHTML = '<p class="study-wait">I couldn\'t reach my explanation service just now. Planning, tasks and reminders still work. Try again in a moment.</p>'; return; }
    const title = topic.length > 70 ? topic.slice(0, 70) + "…" : topic;
    content.classList.remove("streaming");
    const { units, hasPending } = render(title, parse(result.text));
    if(hasPending){
      const b = document.createElement("button"); b.type = "button"; b.className = "study-more"; b.textContent = "Show all steps";
      b.onclick = () => { content.querySelectorAll(".pending").forEach(n => n.classList.remove("pending")); b.remove(); };
      content.appendChild(b);
    }
    await readAlong(units, my);
  }

  function stopStudy(){
    run++; try{ ai.abort(); }catch(e){}
    voice.stopSpeaking();
    pointer.style.opacity = "0";
  }

  bus.on("study:launch", ({ topic }) => startStudy(topic));
  bus.on("projection:close", stopStudy);
  bus.on("study:end", stopStudy);

  window.DABSy = window.DABSy || {};
  window.DABSy.study = { startStudy, stopStudy, _parse: parse };
})();
