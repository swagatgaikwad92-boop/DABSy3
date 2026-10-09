/* ============================================================
   Study Space ⇄ DABSy adapter  (drop into the Study Space repo)
   Works when Study Space and DABSy share an origin
   (e.g. both under https://you.github.io/…).

   Usage in Study Space:
     <script src="./studyspace-adapter.js"></script>
     StudySpaceDABSy.init({
       onSession(payload){ // create a Study Space session from payload return true; },
     });
   - Calls onSession for every NEW session in DABSy's inbox (and when one arrives live).
   - Acknowledges it, so DABSy shows "Opened in Study Space".
   - StudySpaceDABSy.progress(id, {status, blockIndex, minutesDone}) reports back.

   Payload: { version, id, goal, plan:{totalMin,rationale,blocks:[{id,kind,title,minutes,note,resourceId}]},
              resources:[{id,title,type,source,url,durationMin}], tasks:[…] }
   ============================================================ */
(function(){
  const INBOX = "studyspace_inbox_v1", ACK = "studyspace_ack_v1", PROG = "studyspace_progress_v1";
  const rd = (k, f) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; }catch(e){ return f; } };
  const wr = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  let handler = null, chan = null;

  function ack(id){ const a = rd(ACK, {}); a[id] = { at: Date.now() }; wr(ACK, a); }
  function scan(){
    if(!handler) return;
    const acked = rd(ACK, {});
    rd(INBOX, []).forEach(p => {
      if(acked[p.id]) return;
      let ok = false; try{ ok = handler(p) !== false; }catch(e){ console.error(e); }
      if(ok) ack(p.id);
    });
  }
  function init(o){
    handler = o.onSession;
    scan();
    window.addEventListener("storage", e => { if(e.key === INBOX) scan(); });
    try{ chan = new BroadcastChannel("dabsy-ecosystem"); chan.onmessage = e => { if(e.data && e.data.type === "session.ready") scan(); }; }catch(e){}
  }
  function progress(id, p){ const all = rd(PROG, {}); all[id] = Object.assign({}, all[id], p, { updatedAt: Date.now() }); wr(PROG, all); }
  window.StudySpaceDABSy = { init, progress, scan };
})();
