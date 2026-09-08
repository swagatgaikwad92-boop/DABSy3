/* ============================================================
   D.A.B.S.y — director-engine.js
   The Behavior Director.

   Every reactive event in the app funnels through ONE function:
   director.dispatch(intent, payload). Nothing else is allowed to
   call emotion.setState()/flashExpression() or emit "dabsy:say"
   directly for a *reaction* (structural UI-mode changes — like
   "Study Mode opened, so switch to STUDY_FOCUS" — are still fine
   to set directly, since those aren't reactions, they're the mode
   itself).

   Why this matters: before this existed, two engines could call
   emotion.setState() within milliseconds of each other with no
   arbitration — whichever fired last silently won. This is the
   fix for that, plus the mechanism for "don't interrupt someone
   who's reading" (via context.isQuiet()) and for real transitions
   (via emotion.transition()) instead of instant state teleports.

   Pipeline per dispatch:
     EVENT -> CONTEXT (isQuiet?) -> busy-lock/priority ->
     TRANSITION (emotion.transition) -> RESPONSE (dabsy:say, maybe
     suppressed) -> RETURN TO BASELINE (finalState)
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const emotion = window.DABSy.emotion;
  const context = window.DABSy.context;

  // Default behaviour per intent. A dispatch() call can override any of
  // these per-call (e.g. AI_RESPONDED always brings its own speakText).
  const INTENTS = {
    USER_PETTED: {
      priority: "normal",
      transitionSteps: [{expr:"curious",holdMs:220},{expr:"happy",holdMs:1100}],
      speakPool: ["Mm, that's nice.", "Okay, that actually feels good.", "Keep doing that.", "I like this."],
      quietSuppressible: true,
    },
    USER_TAPPED: {
      priority: "low",
      transitionSteps: [{expr:"curious",holdMs:450}],
      quietSuppressible: true,
    },
    USER_DOUBLETAPPED: {
      priority: "low",
      transitionSteps: [{expr:"curious",holdMs:500}],
      quietSuppressible: false, // opening a menu is a deliberate action, always acknowledge it
    },
    USER_LONGPRESS: {
      priority: "low",
      transitionSteps: [{expr:"curious",holdMs:900}],
      quietSuppressible: true,
    },
    USER_OVERTAPPED: {
      priority: "normal",
      transitionSteps: [{expr:"playful",holdMs:1400}],
      speakPool: ["Okay okay, I'm awake!"],
      quietSuppressible: true,
    },
    AI_THINKING: {
      priority: "high",
      transitionSteps: [{expr:"thinking",holdMs:0}],
      setStateImmediate: "THINKING",
      quietSuppressible: false,
    },
    DABSY_REPLY: {
      // the general "just said something" path — chat replies, settings
      // confirmations, manual-add conflict warnings, etc.
      priority: "high",
      transitionSteps: [{expr:"curious",holdMs:180}],
      quietSuppressible: false, // the user asked something; always answer them directly
    },
    SCHEDULE_CONFLICT: {
      priority: "high",
      transitionSteps: [{expr:"concerned",holdMs:280},{expr:"curious",holdMs:0}],
      quietSuppressible: false,
    },
    TASK_COMPLETED: {
      priority: "high",
      transitionSteps: [{expr:"proud",holdMs:1400}],
      speakPool: ["Nice, that's done.", "Marked complete.", "One less thing.", "Good one."],
      quietSuppressible: true,
      finalState: "IDLE",
    },
    STUDY_SESSION_GOOD: {
      priority: "high",
      transitionSteps: [{expr:"proud",holdMs:1600}],
      speakPool: ["Solid session — proud of you for sticking with that."],
      quietSuppressible: false,
      finalState: "IDLE",
    },
    TIMER_FINISHED: {
      priority: "high",
      transitionSteps: [{expr:"surprised",holdMs:500},{expr:"neutral",holdMs:0}],
      speakPool: ["Time's up."],
      quietSuppressible: false,
    },
    RETURN_AFTER_ABSENCE: {
      priority: "high",
      transitionSteps: [{expr:"happy",holdMs:1400}],
      quietSuppressible: false,
    },
    IDLE_BEAT: {
      // ambient personality — the lowest-priority, most suppressible intent.
      priority: "low",
      transitionSteps: [{expr: pick(["curious","playful","happy"]), holdMs:1200}],
      speakPool: ["Just thinking.", "Still here.", "Anything on your mind?", "Hm.", "Watching the world go by."],
      speakChance: 0.4, // most idle beats are silent — just a glance, not a line
      quietSuppressible: true,
    },
  };

  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  let busy = false;
  let busyReleaseTimer = null;
  const queue = [];

  function dispatch(intent, payload={}){
    const def = INTENTS[intent] || {};
    const priority = payload.priority || def.priority || "normal";

    if(busy){
      if(priority === "low") return; // ambient stuff just gets dropped if something more important is happening
      queue.push({ intent, payload });
      return;
    }
    run(intent, def, payload);
  }

  async function run(intent, def, payload){
    busy = true;
    // safety valve: never let a stuck promise chain wedge the whole app quiet
    clearTimeout(busyReleaseTimer);
    busyReleaseTimer = setTimeout(()=>{ busy = false; }, 14000);

    const quiet = context.isQuiet();
    const suppressible = payload.quietSuppressible ?? def.quietSuppressible ?? false;
    const speakSuppressed = suppressible && quiet;

    const steps = payload.transitionSteps || def.transitionSteps || [];
    if(steps.length){
      try{ await emotion.transition(steps); }catch(e){ console.warn("transition failed", e); }
    }

    if(def.setStateImmediate) emotion.setState(def.setStateImmediate, { silent:true });

    const chance = payload.speakChance ?? def.speakChance ?? 1;
    const pool = payload.speakPool || def.speakPool;
    const text = payload.speakText !== undefined
      ? payload.speakText
      : (pool && Math.random() < chance ? pick(pool) : null);

    if(text && !speakSuppressed){
      bus.emit("dabsy:say", { text });
    }

    const finalState = payload.finalState ?? def.finalState;
    if(finalState) emotion.setState(finalState, { silent:true });

    clearTimeout(busyReleaseTimer);
    busy = false;

    if(queue.length){
      const next = queue.shift();
      run(next.intent, INTENTS[next.intent] || {}, next.payload);
    }
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.director = { dispatch };
})();
