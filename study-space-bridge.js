/* ============================================================
   D.A.B.S.y — study-space-bridge.js : DABSy ⇄ Study Space protocol v2

   WHY A NEW PROTOCOL
   v1 wrote to localStorage and assumed both apps share an origin. That fails
   when they don't (custom domain, another account, another device), and
   Study Space never implemented the receiving side, so nothing ever opened.

   HOW IT WORKS NOW (no backend needed)
   1. SEND  — a single window.open(StudySpaceURL + "#dabsy=<payload>", "studyspace")
              made synchronously inside the tap. A URL hash works across ANY origins,
              survives a cold start, and is never sent to a server. Re-using the
              window name re-targets the tab we opened earlier (hash change, no reload).
              If Study Space is already open in a tab of the SAME origin, we deliver
              over BroadcastChannel instead (it announces itself with a presence ping).
   2. ACK   — Study Space replies with stages: received → opened | failed.
              Channels: window.opener.postMessage (works cross-origin),
              BroadcastChannel + storage event (same-origin only).
   3. STATE — every request is tracked: sending → sent → received → opened,
              or blocked / failed / unconfirmed. DABSy says "opened" ONLY after
              Study Space reports the viewer actually loaded.

   WHAT CAN'T BE KNOWN
   If the popup is blocked we say so and offer a tap-to-open link. If Study Space
   opens in a different browser/app context (no window.opener, different origin),
   it can still open the resource but can't report back; DABSy then shows
   "unconfirmed" rather than pretending. See docs/INTEGRATION.md.

   Payload (v2): { v:2, type:"studyspace.open", requestId, sessionId, createdAt, expiresAt,
                   replyTo:<DABSy origin>, resource:{id,title,url,type,source,durationMin,why},
                   plan:{topic,subject,totalMin,rationale,blocks:[…]} }
   Ack:         { v:2, type:"studyspace.ack", requestId, stage, code?, message?, caps? }
   ============================================================ */
(function(){
  const D = window.DABSy, bus = D.bus, memory = D.memory;
  const CH = "studyspace-handoff-v2", ACK_KEY = "studyspace_ack_v2", STORE = "handoff_v2";
  const TTL_MS = 30 * 60000, RECEIVE_WAIT = 9000, OPEN_WAIT = 30000;
  const RANK = { sending: 0, sent: 1, received: 2, opened: 3 };
  const TERMINAL = new Set(["failed", "blocked", "unconfirmed", "opened"]);

  let reqs = memory.read(STORE, {});
  Object.keys(reqs).forEach(k => { if(Date.now() - reqs[k].at > 24 * 3600000) delete reqs[k]; });
  const persist = () => { try{ memory.write(STORE, reqs); }catch(e){} };
  let chan = null, presenceAt = 0, timers = {}, ssWin = null;

  /* ---------- where is Study Space ---------- */
  function app(){ return ((D.config.ecosystem && D.config.ecosystem.apps) || []).find(a => a.id === "study") || {}; }
  function baseUrl(){ try{ return new URL(app().url || "../StudySpace/", document.baseURI); }catch(e){ return null; } }
  const ssOrigin = () => { const u = baseUrl(); return u ? u.origin : ""; };
  const sameOrigin = () => ssOrigin() === location.origin;
  const rid = () => "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- payload ---------- */
  const b64 = obj => { const j = JSON.stringify(obj); return btoa(unescape(encodeURIComponent(j))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").slice(0, n);

  function message(session, resource, requestId){
    const g = session.goal || {}, p = session.plan || { blocks: [] };
    const blk = (p.blocks || []).find(b => b.resourceId && resource && b.resourceId === resource.id);
    return {
      v: 2, type: "studyspace.open", requestId, sessionId: session.id, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, replyTo: location.origin,
      resource: { id: resource.id, title: clip(resource.title, 140), url: resource.url, type: resource.type, source: clip(resource.source, 60), durationMin: resource.durationMin || null, why: clip(resource.why, 160), videoId: resource.videoId || null },
      plan: { topic: clip(g.topic || g.subject || "Study session", 80), subject: clip(g.subject, 40), totalMin: p.totalMin || null, rationale: clip(p.rationale, 200), blockId: blk ? blk.id : null,
        blocks: (p.blocks || []).slice(0, 10).map(b => ({ id: b.id, kind: b.kind, title: clip(b.title, 80), minutes: b.minutes, resourceId: b.resourceId || null })) },
    };
  }

  /* ---------- state machine ---------- */
  function setState(id, state, detail, extra){
    const r = reqs[id]; if(!r) return;
    if(RANK[state] != null && RANK[r.state] != null && RANK[state] < RANK[r.state]) return;
    if(r.state === "opened" && state !== "opened") return;
    r.state = state; r.detail = detail || ""; r.updatedAt = Date.now(); Object.assign(r, extra || {});
    persist(); bus.emit("bridge:state", Object.assign({ requestId: id }, r)); bus.emit("bridge:ack", {});
    clearTimeout(timers[id]);
    if(state === "sent"){ timers[id] = setTimeout(() => unconfirmed(id, "Study Space didn't confirm. If it opened in another app or browser it can't report back."), RECEIVE_WAIT); }
    if(state === "received"){ timers[id] = setTimeout(() => unconfirmed(id, "Study Space received it but hasn't finished loading it yet."), OPEN_WAIT); }
  }
  function unconfirmed(id, detail){ const r = reqs[id]; if(r && (r.state === "sent" || r.state === "received")) setState(id, "unconfirmed", detail); }

  function handleAck(a){
    if(!a || a.v !== 2 || a.type !== "studyspace.ack" || !reqs[a.requestId]) return;
    const id = a.requestId;
    if(a.caps) reqs[id].caps = a.caps;
    if(a.stage === "received") setState(id, "received", "Study Space got it.");
    else if(a.stage === "opened" || a.stage === "duplicate") setState(id, "opened", a.stage === "duplicate" ? "Already open in Study Space." : "Open in Study Space.");
    else if(a.stage === "failed" || a.stage === "rejected") setState(id, "failed", clip(a.message, 200) || "Study Space couldn't open it.", { code: a.code || "failed", external: a.external || reqs[id].url });
  }

  /* ---------- channels ---------- */
  window.addEventListener("message", e => {
    const origin = ssOrigin();
    if(e.origin !== origin && !(ssWin && e.source === ssWin)) return;       // only Study Space may answer
    handleAck(e.data);
  });
  try{
    chan = new BroadcastChannel(CH);
    chan.onmessage = e => { const m = e.data; if(!m) return; if(m.type === "studyspace.presence") presenceAt = Date.now(); else handleAck(m); };
    chan.postMessage({ type: "studyspace.ping" });
  }catch(e){ chan = null; }
  window.addEventListener("storage", e => { if(e.key === ACK_KEY && e.newValue){ try{ handleAck(JSON.parse(e.newValue)); }catch(_){} } });
  const presentNow = () => !!chan && sameOrigin() && Date.now() - presenceAt < 12000;

  /* ---------- sending ---------- */
  function urlFor(msg){ const u = baseUrl(); if(!u) return null; u.hash = "dabsy=" + b64(msg); return u.toString(); }

  // MUST be called synchronously from a tap/click handler (popup blockers). Returns the request record immediately.
  function sendResource(session, resource, opts){
    opts = opts || {};
    if(!session || !resource) return { ok: false, error: "missing" };
    if(!resource.sendable && !(resource.type === "video" || resource.type === "pdf")) return { ok: false, error: "not-supported", detail: "Study Space opens videos and PDFs. This one opens in your browser instead." };
    const requestId = rid();
    reqs[requestId] = { id: requestId, sessionId: session.id, resourceId: resource.id, title: clip(resource.title, 140), type: resource.type, url: resource.url, at: Date.now(), state: "sending", detail: "", via: "" };
    const msg = message(session, resource, requestId);
    const url = urlFor(msg);
    if(!url){ setState(requestId, "failed", "Study Space's address isn't configured.", { code: "no-config" }); return { ok: false, error: "no-config", requestId }; }
    persist(); bus.emit("bridge:state", Object.assign({ requestId }, reqs[requestId]));

    if(presentNow() && !opts.forceWindow){
      try{ chan.postMessage(msg); reqs[requestId].via = "broadcast"; setState(requestId, "sent", "Sent to your open Study Space tab. Switch to it."); return { ok: true, requestId, via: "broadcast" }; }catch(e){}
    }
    let w = null;
    try{ w = window.open(url, "studyspace"); }catch(e){ w = null; }
    if(!w){
      reqs[requestId].manualUrl = url; reqs[requestId].via = "blocked";
      setState(requestId, "blocked", "Your browser blocked the Study Space window.");
      bus.emit("bridge:blocked", { requestId, url });
      return { ok: false, error: "blocked", requestId, url };
    }
    ssWin = w; reqs[requestId].via = "window";
    // already-open same-name tab: a hash-only change doesn't reload, so also post the message to it directly
    try{ setTimeout(() => { try{ if(ssWin && !ssWin.closed) ssWin.postMessage(msg, ssOrigin()); }catch(e){} }, 1200); }catch(e){}
    setState(requestId, "sent", "Study Space window opened. Waiting for it to confirm.");
    return { ok: true, requestId, via: "window" };
  }

  // Start Study / "Open material": picks the resource for a plan block
  function sendBlock(session, blockId, opts){
    const b = (session.plan.blocks || []).find(x => x.id === blockId); if(!b || !b.resourceId) return { ok: false, error: "no-resource" };
    const r = (session.resources || []).find(x => x.id === b.resourceId); if(!r) return { ok: false, error: "no-resource" };
    return sendResource(session, r, opts);
  }
  const firstSendable = session => {
    for(const b of (session.plan.blocks || [])){ const r = b.resourceId && (session.resources || []).find(x => x.id === b.resourceId); if(r && (r.type === "video" || r.type === "pdf")) return r; }
    return (session.resources || []).find(r => r.type === "video" || r.type === "pdf") || null;
  };
  function publish(session, opts){ const r = firstSendable(session); return r ? sendResource(session, r, opts) : { ok: false, error: "no-resource", detail: "This plan has no video or PDF that Study Space can open." }; }

  /* ---------- reading state ---------- */
  const request = id => reqs[id] || null;
  const forSession = sid => Object.values(reqs).filter(r => r.sessionId === sid).sort((a, b) => b.at - a.at);
  function latest(sid, resourceId){ return forSession(sid).find(r => !resourceId || r.resourceId === resourceId) || null; }
  // legacy API used by study-session / ecosystem hub
  function status(sid){ const l = forSession(sid); if(l.some(r => r.state === "opened")) return "opened"; if(l.some(r => r.state === "sent" || r.state === "received")) return "waiting"; return "none"; }
  const progress = () => null;
  function describe(sid){
    const r = latest(sid); if(!r) return "Not sent yet";
    const t = r.title ? "“" + clip(r.title, 40) + "”" : "the resource";
    return { sending: "Sending " + t + "…", sent: "Sent " + t + ". Waiting for Study Space to confirm.", received: "Study Space received " + t + " and is loading it.",
      opened: t + " is open in Study Space.", failed: "Couldn't open " + t + ": " + r.detail, blocked: "Browser blocked the window. Tap to open Study Space.", unconfirmed: r.detail }[r.state] || r.state;
  }
  function manualOpen(requestId){ const r = reqs[requestId]; if(r && r.manualUrl){ const w = window.open(r.manualUrl, "studyspace"); if(w){ ssWin = w; setState(requestId, "sent", "Study Space window opened. Waiting for it to confirm."); return true; } } return false; }

  window.DABSy.bridge = { sendResource, sendBlock, publish, firstSendable, request, forSession, latest, status, progress, describe, manualOpen, ssUrl: () => { const u = baseUrl(); return u ? u.toString() : ""; }, presentNow, payload: message, _reqs: () => reqs };
})();
