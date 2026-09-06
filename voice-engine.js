/* ============================================================
   D.A.B.S.y — voice-engine.js
   Speech recognition (listening) + speech synthesis (speaking).
   speakWithTracking() additionally fires onWord(charIndex) as the
   browser reports word boundaries, used by Study Mode to move the
   little reading pointer along the text.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;

  function initRecognizer(){
    if(!SR) return null;
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = navigator.language || "en-US"; // en-IN isn't supported on every device/browser
    r.onstart = ()=>{ listening = true; bus.emit("voice:listening:start"); };
    r.onend = ()=>{ listening = false; bus.emit("voice:listening:end"); };
    r.onerror = (e)=>{
      listening = false;
      bus.emit("voice:listening:end");
      bus.emit("voice:error", { error: e.error || "unknown" });
      console.warn("SpeechRecognition error:", e.error);
    };
    r.onresult = (e)=>{
      const text = e.results[0][0].transcript;
      bus.emit("voice:heard", { text });
    };
    return r;
  }

  function startListening(){
    if(!SR){ bus.emit("voice:unsupported"); return; }
    if(listening) return;
    recognizer = recognizer || initRecognizer();
    try{ recognizer.start(); }catch(e){ /* already started */ }
  }
  function stopListening(){
    if(recognizer && listening) recognizer.stop();
  }

  /* ---------- speech synthesis ---------- */
  let voices = [];
  function loadVoices(){
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    bus.emit("voice:voices-ready", { voices });
  }
  if(window.speechSynthesis){
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function pickVoice(){
    const settings = memory.getSettings();
    if(settings.voiceURI){
      const v = voices.find(v=>v.voiceURI === settings.voiceURI);
      if(v) return v;
    }
    const order = ["en-IN","en-GB","en-US"];
    for(const lang of order){
      const v = voices.find(v=>v.lang === lang);
      if(v) return v;
    }
    return voices[0] || null;
  }

  function buildUtterance(text){
    const utt = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if(v) utt.voice = v;
    utt.pitch = 1.08;
    utt.rate = 1.0;
    return utt;
  }

  function speak(text){
    if(!window.speechSynthesis || !text) { bus.emit("voice:speaking:end"); return; }
    window.speechSynthesis.cancel();
    const utt = buildUtterance(text);
    utt.onstart = ()=>bus.emit("voice:speaking:start");
    utt.onend = ()=>bus.emit("voice:speaking:end");
    utt.onerror = ()=>bus.emit("voice:speaking:end");
    window.speechSynthesis.speak(utt);
  }

  // Speaks text and calls onWord(charIndex, charLength) as boundaries are
  // reported. Returns a promise that resolves when speech ends. Falls back
  // to resolving immediately if the browser doesn't support onboundary.
  function speakWithTracking(text, onWord){
    return new Promise((resolve)=>{
      if(!window.speechSynthesis || !text){ resolve(); return; }
      window.speechSynthesis.cancel();
      const utt = buildUtterance(text);
      utt.onstart = ()=>bus.emit("voice:speaking:start");
      utt.onboundary = (e)=>{
        if(e.name === "word" && onWord) onWord(e.charIndex, e.charLength || 0);
      };
      utt.onend = ()=>{ bus.emit("voice:speaking:end"); resolve(); };
      utt.onerror = ()=>{ bus.emit("voice:speaking:end"); resolve(); };
      window.speechSynthesis.speak(utt);
    });
  }

  function stopSpeaking(){ if(window.speechSynthesis) window.speechSynthesis.cancel(); }

  window.DABSy = window.DABSy || {};
  window.DABSy.voice = { startListening, stopListening, speak, speakWithTracking, stopSpeaking, getVoices: ()=>voices, isListening: ()=>listening };
})();
