/* ============================================================
   D.A.B.S.y — emotion-engine.js
   The state machine + internal mood variables + a tiny event bus
   that every other engine talks through. No engine reaches into
   another engine's internals directly — everything goes through
   DABSy.bus.
   ============================================================ */

(function(){
  const STATES = [
    "IDLE","LISTENING","THINKING","SPEAKING",
    "CURIOUS","HAPPY","FOCUSED","SLEEPY","SURPRISED","PLAYFUL","STUDY_FOCUS"
  ];

  // state -> expression class shown on the face
  const STATE_EXPRESSION = {
    IDLE: "neutral",
    LISTENING: "listening",
    THINKING: "thinking",
    SPEAKING: "speaking",
    CURIOUS: "curious",
    HAPPY: "happy",
    FOCUSED: "focused",
    SLEEPY: "sleepy",
    SURPRISED: "surprised",
    PLAYFUL: "playful",
    STUDY_FOCUS: "focused"
  };

  /* ---------- tiny event bus ---------- */
  const listeners = {};
  function on(evt, fn){ (listeners[evt] ||= []).push(fn); return () => off(evt, fn); }
  function off(evt, fn){ if(listeners[evt]) listeners[evt] = listeners[evt].filter(f=>f!==fn); }
  function emit(evt, payload){ (listeners[evt]||[]).slice().forEach(fn=>{ try{ fn(payload); }catch(e){ console.error(e); } }); }

  /* ---------- mood variables (0..1) ---------- */
  const mood = {
    happiness: 0.6,
    curiosity: 0.5,
    energy: 0.7,
    attention: 0.5,
    confidence: 0.6,
    boredom: 0.1,
    focus: 0.3,
    affection: 0.4,
    sleepiness: 0.1,
  };

  function nudge(key, delta){
    if(!(key in mood)) return;
    mood[key] = Math.max(0, Math.min(1, mood[key] + delta));
    emit("mood:change", { key, value: mood[key] });
  }

  /* ---------- state machine ---------- */
  let current = "IDLE";
  let previous = null;
  let pendingExpression = null; // one-shot expression override (e.g. surprised burst)
  let expressionTimer = null;

  function setState(next, opts={}){
    if(!STATES.includes(next)) { console.warn("Unknown state", next); return; }
    previous = current;
    current = next;
    emit("state:change", { from: previous, to: current });
    if(!opts.silent) applyExpression(STATE_EXPRESSION[next] || "neutral", opts.holdMs);
  }

  function getState(){ return current; }
  function getPrevious(){ return previous; }

  // Show a specific expression regardless of the underlying state, for a
  // fixed duration, then fall back to the state's default expression.
  function applyExpression(name, holdMs){
    if(expressionTimer) clearTimeout(expressionTimer);
    emit("expression:set", { name });
    if(holdMs){
      expressionTimer = setTimeout(()=>{
        emit("expression:set", { name: STATE_EXPRESSION[current] || "neutral" });
      }, holdMs);
    }
  }

  function flashExpression(name, holdMs=900){
    applyExpression(name, holdMs);
  }

  /* ---------- idle drift: mood slowly relaxes toward baseline ---------- */
  const BASELINE = { happiness:0.55, curiosity:0.4, energy:0.55, attention:0.3, confidence:0.55, boredom:0.15, focus:0.2, affection:0.4, sleepiness:0.15 };
  setInterval(()=>{
    Object.keys(BASELINE).forEach(k=>{
      const diff = BASELINE[k] - mood[k];
      mood[k] += diff * 0.02;
    });
    // boredom & sleepiness creep up with real inactivity — pet-engine drives this via nudge()
  }, 4000);

  window.DABSy = window.DABSy || {};
  window.DABSy.bus = { on, off, emit };
  window.DABSy.emotion = { setState, getState, getPrevious, mood, nudge, flashExpression, STATES };
})();
