/* ============================================================
   D.A.B.S.y — study-engine.js
   Turns a question/topic into step-by-step explanation shown in
   the projection surface. Steps are spoken one at a time using
   voice.speakWithTracking(), and a small pointer (▲) follows the
   word currently being read — DABSy "reading along" with you.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const ai = window.DABSy.ai;
  const voice = window.DABSy.voice;
  const projectionContent = document.getElementById("projection-content");
  const projectionSurface = document.getElementById("projection-surface");
  const pointer = document.getElementById("projection-pointer");
  const studyQuestion = document.getElementById("study-question");
  const studyStart = document.getElementById("study-start");

  let cancelled = false;

  function splitSteps(stepsText){
    return stepsText.split(/\n{2,}|(?=^\d+[\.\)])/m).map(s=>s.trim()).filter(Boolean);
  }

  // Wraps each word of a step in a span so the pointer can target it, and
  // returns the plain-text version (what gets spoken) alongside a lookup
  // from character offset -> word index.
  function wrapWords(text){
    const words = text.split(/(\s+)/); // keep whitespace tokens so offsets line up
    let offset = 0;
    let html = "";
    const offsets = [];
    words.forEach((tok)=>{
      if(tok.trim().length === 0){ html += tok; offset += tok.length; return; }
      const idx = offsets.length;
      offsets.push({ start: offset, end: offset + tok.length, idx });
      html += `<span class="word" data-idx="${idx}">${escapeHtml(tok)}</span>`;
      offset += tok.length;
    });
    return { html, offsets };
  }

  function escapeHtml(s){
    return s.replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function renderScaffold(title, chunks){
    projectionContent.innerHTML = "";
    const h = document.createElement("h3");
    h.textContent = title;
    projectionContent.appendChild(h);
    const stepEls = chunks.map((chunk, i)=>{
      const div = document.createElement("div");
      div.className = "step" + (i===0 ? " highlight" : "");
      div.dataset.stepIndex = i;
      projectionContent.appendChild(div);
      return div;
    });
    return stepEls;
  }

  function movePointerTo(span){
    if(!span) return;
    // pointer's positioning context is #projection-surface (its parent),
    // not #projection-content — content's innerHTML gets wiped between
    // steps, so the pointer lives outside it as a sibling.
    const surfaceRect = projectionSurface.getBoundingClientRect();
    const wordRect = span.getBoundingClientRect();
    pointer.style.opacity = "1";
    pointer.style.transform = `translate(${wordRect.left - surfaceRect.left}px, ${wordRect.top - surfaceRect.top - 26}px)`;
  }

  async function speakStepsSequentially(stepEls, texts){
    for(let i=0; i<stepEls.length; i++){
      if(cancelled) return;
      stepEls.forEach((el,j)=>el.classList.toggle("highlight", j===i));
      stepEls[i].scrollIntoView({ block:"center", behavior:"smooth" });

      const { html, offsets } = wrapWords(texts[i]);
      stepEls[i].innerHTML = html;

      await voice.speakWithTracking(texts[i], (charIndex)=>{
        const match = offsets.find(o => charIndex >= o.start && charIndex < o.end) || offsets[offsets.length-1];
        if(!match) return;
        const span = stepEls[i].querySelector(`.word[data-idx="${match.idx}"]`);
        stepEls[i].querySelectorAll(".word.active").forEach(w=>w.classList.remove("active"));
        span?.classList.add("active");
        movePointerTo(span);
      });
      if(cancelled) return;
      await new Promise(r=>setTimeout(r, 350)); // brief pause between steps
    }
    pointer.style.opacity = "0";
  }

  async function startStudy(topic){
    if(!topic || !topic.trim()) return;
    cancelled = false;
    bus.emit("world:close");
    bus.emit("projection:open");
    projectionContent.innerHTML = "<h3>Thinking it through…</h3>";
    pointer.style.opacity = "0";

    const result = await ai.askDABSy(
      `Teach this step by step, in short numbered steps, for a Class 11 science student: ${topic}`,
      { context: "Study Mode: produce a clear step-by-step explanation, one idea per step, each step a short sentence or two." }
    );

    const chunks = splitSteps(result.text);
    const title = topic.length > 60 ? topic.slice(0,60)+"…" : topic;
    const stepEls = renderScaffold(title, chunks);
    await speakStepsSequentially(stepEls, chunks);
  }

  function stopStudy(){
    cancelled = true;
    voice.stopSpeaking();
    pointer.style.opacity = "0";
  }

  studyStart.addEventListener("click", ()=>{
    startStudy(studyQuestion.value);
    studyQuestion.value = "";
  });

  bus.on("study:launch", ({topic})=>startStudy(topic));
  bus.on("projection:close", stopStudy);

  window.DABSy = window.DABSy || {};
  window.DABSy.study = { startStudy, stopStudy };
})();
