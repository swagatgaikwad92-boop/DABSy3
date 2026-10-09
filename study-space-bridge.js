/* ============================================================
   D.A.B.S.y — study-space-bridge.js : the DABSy ⇄ Study Space contract

   WHAT IS REAL
   Same-origin apps (both under username.github.io) share localStorage and
   BroadcastChannel. DABSy writes a session to a shared INBOX; Study Space
   (with integrations/studyspace-adapter.js dropped in) reads it, writes an
   ACK when it opens it, and PROGRESS as the user studies. DABSy reflects
   both — "delivered" is only claimed when the write really succeeded,
   "opened" only when Study Space acknowledged.

   WHAT IS NOT
   Different origins (custom domain, other GitHub account) or different
   devices cannot share this storage. That needs a backend; see BACKEND.md.

   Storage contract (raw keys, NOT namespaced — they are shared on purpose):
     studyspace_inbox_v1    [ Payload ]            written by DABSy
     studyspace_ack_v1      { [id]: {at} }         written by Study Space
     studyspace_progress_v1 { [id]: {status, blockIndex, minutesDone, updatedAt} }
   ============================================================ */
(function(){
  const bus = window.DABSy.bus;
  const INBOX = "studyspace_inbox_v1", ACK = "studyspace_ack_v1", PROG = "studyspace_progress_v1";
  const rd = (k, f) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; }catch(e){ return f; } };

  function payload(s){
    const tasks = (window.DABSy.tasks ? window.DABSy.tasks.list() : []).filter(t => t.status !== "cancelled" && t.status !== "done" && s.goal && s.goal.subject && ((t.subject || "").toLowerCase() === s.goal.subject.toLowerCase() || t.title.toLowerCase().includes(s.goal.subject.toLowerCase())))
      .slice(0, 8).map(t => ({ id: t.id, title: t.title, dueAt: t.dueAt, priority: t.priority }));
    return {
      version: 1, id: s.id, from: "dabsy", createdAt: s.createdAt, goal: s.goal,
      plan: { totalMin: s.plan.totalMin, rationale: s.plan.rationale, blocks: s.plan.blocks.map(b => ({ id: b.id, kind: b.kind, title: b.title, minutes: b.minutes, note: b.note || "", resourceId: b.resourceId || null })) },
      resources: (s.resources || []).map(r => ({ id: r.id, title: r.title, type: r.type, source: r.source, url: r.url, durationMin: r.durationMin })),
      tasks,
    };
  }

  function publish(session){
    try{
      const list = rd(INBOX, []).filter(x => x.id !== session.id);
      list.push(payload(session));
      localStorage.setItem(INBOX, JSON.stringify(list.slice(-10)));
      if(window.DABSy.ecosystem) window.DABSy.ecosystem.post("session.ready", { id: session.id });
      return { ok: true };
    }catch(e){ return { ok: false, error: "storage" }; }
  }

  // none → waiting (in inbox) → opened (Study Space acknowledged)
  function status(id){
    if((rd(ACK, {}) || {})[id]) return "opened";
    return rd(INBOX, []).some(x => x.id === id) ? "waiting" : "none";
  }
  const progress = id => (rd(PROG, {}) || {})[id] || null;

  window.addEventListener("storage", e => {
    if(e.key === ACK) bus.emit("bridge:ack", {});
    if(e.key === PROG && e.newValue){ try{ const all = JSON.parse(e.newValue); Object.keys(all).forEach(id => bus.emit("bridge:progress", { id, progress: all[id] })); }catch(_){} }
  });

  window.DABSy.bridge = { publish, status, progress, payload };
})();
