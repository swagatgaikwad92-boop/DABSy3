/* ============================================================
   SolveCount → DABSy adapter  (drop into the SolveCount repo)
   SolveCount keeps its data in IndexedDB, which DABSy can't read. This
   tiny adapter lets SolveCount publish a SUMMARY that DABSy's SolveCount
   bubble displays. Same-origin only.

     SolveCountDABSy.publish({ solvedToday: 12, streak: 4, total: 380 });

   Call it after any change to the numbers. Keep it small: counts only.
   ============================================================ */
(function(){
  function publish(data){
    const msg = { at: Date.now(), data: data || {} };
    try{ localStorage.setItem("dabsy_eco_solvecount", JSON.stringify(msg)); }catch(e){}
    try{ const c = new BroadcastChannel("dabsy-ecosystem"); c.postMessage({ type: "solvecount.summary", data: msg.data, from: "solvecount", at: msg.at }); c.close(); }catch(e){}
  }
  window.SolveCountDABSy = { publish };
})();
