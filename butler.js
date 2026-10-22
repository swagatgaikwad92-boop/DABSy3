/* ============================================================
   D.A.B.S.y — butler.js : natural-language task + calendar operations
   DABSy.butler = { handle(text), removeFlow(title), overview(), find(query) }

   The rules here are ordinary, deterministic code (date maths, matching, validation, writes). The language model is NOT
   asked to decide whether a task was deleted or moved: this module does it, reads the record back, and only then says "done".

     complete   "mark maths homework done" / "I finished my chemistry notes"
     priority   "make physics revision high priority"
     rename     "rename maths homework to algebra worksheet"
     move       "move physics revision to tomorrow 6 pm"
     delete     "delete the chemistry reminder"   -> ASKS FIRST (Delete / Keep)
     overview   "plan my day" / "how busy am I today"   (conflicts + overload warnings, nothing invented)

   Reversible changes (complete, priority, rename, move) show an Undo button. Deleting always asks first.
   Targets are tasks (DABSy's own) and, when Ghibli Calendar is connected, its events.
   ============================================================ */
(function(){
  const D = window.DABSy, tasks = D.tasks;
  const Core = () => window.DABSyCore;
  const pad = n => String(n).padStart(2, "0");
  const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const STOP = new Set(["the","a","an","my","task","tasks","reminder","reminders","event","events","please","to","for","of","on","in","at","it","that","this","as","is","are","and"]);
  const norm = s => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const toks = s => norm(s).split(" ").filter(w => w && !STOP.has(w));

  /* ---------- finding things (never invents: only what exists) ---------- */
  function connected(){ const c = Core() && Core().getConnections().calendar; return !!(c && c.enabled); }
  function candidates(){
    const out = [];
    tasks.list().forEach(t => { if(t.status === "cancelled" || t.status === "done" && !t.recurrence) return; out.push({ kind: "task", id: t.id, title: t.title, sub: t.recurrence ? "repeating task" : t.dueAt ? new Date(t.dueAt).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "task" }); });
    if(connected()){
      const today = dk(new Date());
      Core().getCalendarEvents().forEach(e => { if(e.date >= today) out.push({ kind: "event", id: e.id, title: e.title, sub: "calendar · " + e.date + (e.startTime ? " " + e.startTime : "") }); });
    }
    return out;
  }
  function score(q, title){
    const a = toks(q), b = toks(title);
    if(!a.length || !b.length) return 0;
    if(norm(title) === norm(q)) return 1;
    const hit = a.filter(w => b.some(x => x === w || (w.length > 3 && (x.startsWith(w) || w.startsWith(x))))).length;
    const base = hit / a.length;
    return base * (hit / Math.max(b.length, a.length) * .4 + .6);
  }
  function find(query){
    return candidates().map(c => Object.assign({ score: score(query, c.title) }, c)).filter(c => c.score >= .5).sort((x, y) => y.score - x.score);
  }
  const label = c => `"${String(c.title).replace(/^[^\p{L}\p{N}]+/u, "")}"`;

  /* ---------- pending choice (an ambiguous name, or a delete confirmation) ---------- */
  let pending = null;            // { kind:"pick"|"confirm", run(candidate), list, c }
  const isNo = t => /^(no|nope|nah|keep( it)?|cancel|never ?mind|stop|don'?t|leave it)\b/i.test(t.trim());
  const isYes = t => /^(yes|yeah|yep|sure|ok(ay)?|delete( it)?|do it|go ahead|please do|remove( it)?)\b/i.test(t.trim());

  function choose(list, verb, run){
    if(list.length === 1 || (list[0].score >= .8 && list[0].score - (list[1] ? list[1].score : 0) >= .25)) return run(list[0]);
    const top = list.slice(0, 4);
    pending = { kind: "pick", list: top, run };
    return { text: `Which one should I ${verb}?`, state: "CURIOUS", opts: { choices: { mode: "single", options: top.map(c => ({ label: c.title.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 38), value: c.title })) } } };
  }
  const notFound = what => ({ text: `I couldn't find anything called "${what}" on your tasks${connected() ? " or calendar" : ""}, so I haven't changed anything.`, state: "CONFUSED" });
  const undoOpts = fn => ({ actions: [{ label: "Undo", onClick: async () => { const r = await fn(); D.app.say(r.text, r.state, r.opts); } }] });
  const failed = (what, why) => ({ text: `I tried to ${what} but couldn't confirm it was saved${why ? " (" + why + ")" : ""}. Nothing was reported as done.`, state: "CONFUSED" });

  /* ---------- operations ---------- */
  function doComplete(c){
    if(c.kind === "event") return { text: `${label(c)} is a calendar event, and Ghibli Calendar has no "done" state for events. Want me to delete it instead?`, state: "CURIOUS", opts: { choices: { mode: "single", options: ["Delete it", "Keep it"] } }, _arm: () => { pending = { kind: "confirm", c, run: doDelete }; } };
    const before = tasks.get(c.id); if(!before) return notFound(c.title);
    const key = dk(new Date());
    tasks.complete(c.id, key);
    const after = tasks.get(c.id);
    const ok = after && (after.recurrence ? (after.occurrences[key] || {}).status === "done" : after.status === "done");
    if(!ok) return failed("mark " + label(c) + " done");
    return { text: `Done — ${label(c)} is marked complete.`, state: "HAPPY", opts: undoOpts(async () => { tasks.reopen(c.id, key); const t = tasks.get(c.id); const back = t && (t.recurrence ? (t.occurrences[key] || {}).status === "pending" : t.status === "pending"); return back ? { text: `Okay, ${label(c)} is back on your list.`, state: "IDLE" } : failed("undo that"); }) };
  }
  function doPriority(c, pr){
    if(c.kind === "event") return { text: `${label(c)} is a calendar event, and calendar events don't have a priority. I can change it for tasks.`, state: "CONFUSED" };
    const t = tasks.get(c.id); if(!t) return notFound(c.title);
    const prev = t.priority;
    tasks.update(c.id, { priority: pr });
    if((tasks.get(c.id) || {}).priority !== pr) return failed("change the priority");
    return { text: `${label(c)} is now ${pr} priority.`, state: "HAPPY", opts: undoOpts(async () => { tasks.update(c.id, { priority: prev }); return (tasks.get(c.id) || {}).priority === prev ? { text: `Priority put back to ${prev}.`, state: "IDLE" } : failed("undo that"); }) };
  }
  function doRename(c, name){
    name = name.trim().replace(/^["“']|["”']$/g, "").slice(0, 120); if(!name) return { text: "What should I rename it to?", state: "CURIOUS" };
    const prev = c.title;
    if(c.kind === "task"){ tasks.update(c.id, { title: name }); if((tasks.get(c.id) || {}).title !== name) return failed("rename it"); }
    else { const u = Core().updateCalendarEvent(c.id, { title: name }); if(!u || (Core().getEventById(c.id) || {}).title !== name) return failed("rename it"); }
    return { text: `Renamed to "${name}".`, state: "HAPPY", opts: undoOpts(async () => { if(c.kind === "task") tasks.update(c.id, { title: prev }); else Core().updateCalendarEvent(c.id, { title: prev }); const now = c.kind === "task" ? (tasks.get(c.id) || {}).title : (Core().getEventById(c.id) || {}).title; return now === prev ? { text: `Back to "${prev}".`, state: "IDLE" } : failed("undo that"); }) };
  }
  function doMove(c, when){
    const day = D.calIntel ? D.calIntel.resolveDate(when) : { date: null };
    const tm = D.ai.parseTimeOfDay(when);
    if(day.ask) return { text: day.ask, state: "CURIOUS" };
    if(!day.date && !tm) return { text: `To when? For example "tomorrow 6 pm" or "Friday".`, state: "CURIOUS" };
    if(c.kind === "event"){
      const ev = Core().getEventById(c.id); if(!ev) return notFound(c.title);
      const prev = { date: ev.date, startTime: ev.startTime, endTime: ev.endTime };
      const date = day.date || ev.date;
      let startTime = ev.startTime, endTime = ev.endTime;
      if(tm){ const dur = ev.startTime && ev.endTime ? Core().toMinutes(ev.endTime) - Core().toMinutes(ev.startTime) : 30; const s = tm.hour * 60 + tm.minute; startTime = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; const e = s + dur; endTime = `${pad(Math.floor(e / 60) % 24)}:${pad(e % 60)}`; }
      const clash = startTime ? Core().findConflicts(date, { startTime, endTime, excludeId: c.id }) : [];
      Core().updateCalendarEvent(c.id, { date, startTime, endTime });
      const now = Core().getEventById(c.id);
      if(!now || now.date !== date || now.startTime !== startTime) return failed("move it");
      return { text: `Moved ${label(c)} to ${date}${startTime ? " at " + startTime : ""}.${clash.length ? ` Heads up: that overlaps "${clash[0].title}".` : ""}`, state: "HAPPY", opts: undoOpts(async () => { Core().updateCalendarEvent(c.id, prev); const n = Core().getEventById(c.id); return n && n.date === prev.date && n.startTime === prev.startTime ? { text: `Moved ${label(c)} back.`, state: "IDLE" } : failed("undo that"); }) };
    }
    const t = tasks.get(c.id); if(!t) return notFound(c.title);
    const base = t.dueAt ? new Date(t.dueAt) : new Date();
    const start = day.date ? new Date(day.date + "T00:00:00") : new Date(base); if(!day.date) start.setHours(0, 0, 0, 0);
    if(tm) start.setHours(tm.hour, tm.minute, 0, 0); else if(t.dueAt) start.setHours(base.getHours(), base.getMinutes(), 0, 0); else start.setHours(9, 0, 0, 0);
    if(start.getTime() < Date.now() - 60000) return { text: "That time has already passed. Pick a later one?", state: "CURIOUS" };
    const prevDue = t.dueAt;
    const okey = dk(new Date());
    tasks.move(c.id, t.recurrence ? okey : dk(base), start);
    const n = tasks.get(c.id);
    const landed = n && (n.recurrence ? new Date(((n.occurrences[okey] || {}).movedTo) || 0).getTime() === start.getTime() : new Date(n.dueAt).getTime() === start.getTime());
    if(!landed) return failed("move it");
    return { text: `Moved ${label(c)} to ${start.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`, state: "HAPPY", opts: undoOpts(async () => { if(t.recurrence) tasks.move(c.id, okey, new Date(base)); else tasks.update(c.id, { dueAt: prevDue }); return t.recurrence || (tasks.get(c.id) || {}).dueAt === prevDue ? { text: `Moved ${label(c)} back.`, state: "IDLE" } : failed("undo that"); }) };
  }
  function doDelete(c){
    if(c.kind === "task"){ tasks.remove(c.id); if(tasks.get(c.id)) return failed("delete it"); }
    else { Core().deleteCalendarEvent(c.id); if(Core().getEventById(c.id)) return failed("delete it"); }
    return { text: `Deleted ${label(c)}.`, state: "IDLE" };
  }
  function askDelete(c){
    pending = { kind: "confirm", c, run: doDelete };
    return { text: `Delete ${label(c)}${c.sub ? " (" + c.sub + ")" : ""}? This can't be undone.`, state: "CURIOUS", opts: { choices: { mode: "single", options: ["Delete it", "Keep it"], allowCustom: false } } };
  }

  /* ---------- overview ---------- */
  function overview(){
    const now = new Date(), key = dk(now);
    const items = tasks.instancesForDate(key).filter(i => i.status === "pending" || i.status === "active").map(i => ({ title: i.title, s: i.start.getHours() * 60 + i.start.getMinutes(), e: i.end.getHours() * 60 + i.end.getMinutes(), dur: i.durationMin, src: "task" }));
    if(connected()) Core().getEventsForDate(key).forEach(e => { if(!e.startTime) items.push({ title: e.title, s: null, e: null, dur: 0, src: "event" }); else { const s = Core().toMinutes(e.startTime), en = e.endTime ? Core().toMinutes(e.endTime) : s + 30; items.push({ title: e.title, s, e: en, dur: en - s, src: "event" }); } });
    const timed = items.filter(i => i.s != null).sort((a, b) => a.s - b.s), untimed = items.filter(i => i.s == null);
    const unsched = tasks.unscheduled();
    if(!items.length && !unsched.length) return { text: "Nothing on your list for today. A clear day — want to plan some study?", state: "HAPPY" };
    const hm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
    const lines = timed.slice(0, 5).map(i => `${hm(i.s)} ${i.title}`).concat(untimed.slice(0, 3).map(i => `Today: ${i.title}`));
    const warn = [];
    for(let i = 1; i < timed.length; i++) if(timed[i].s < timed[i - 1].e) warn.push(`"${timed[i - 1].title}" and "${timed[i].title}" overlap`);
    const total = timed.reduce((a, b) => a + b.dur, 0);
    if(total > 480) warn.push(`about ${Math.round(total / 6) / 10} hours are booked, which is a lot for one day`);
    const left = timed.filter(i => i.s > now.getHours() * 60 + now.getMinutes()).length;
    const head = `${items.length} thing${items.length === 1 ? "" : "s"} today${timed.length ? `, ${left} still ahead` : ""}.`;
    const text = [head].concat(lines.map(l => "• " + l)).concat(items.length > lines.length ? [`…and ${items.length - lines.length} more`] : []).concat(warn.length ? ["Heads up: " + warn.join("; ") + "."] : []).concat(unsched.length ? [`${unsched.length} task${unsched.length === 1 ? " has" : "s have"} no time yet.`] : []).join("\n");
    const actions = unsched.length ? [{ label: "Find a time for " + unsched[0].title.slice(0, 22), primary: true, onClick: () => D.notify.rescheduleFlow(unsched[0].id) }] : null;
    return { text, state: warn.length ? "CONCERNED" : "HAPPY", opts: actions ? { actions } : undefined };
  }

  /* ---------- the router ---------- */
  const PRI = { high: "high", top: "high", urgent: "high", low: "low", normal: "normal", medium: "normal" };
  function strip(s){ return String(s || "").replace(/^(?:my|the|a|an)\s+/i, "").replace(/\s+(?:task|reminder|event)$/i, "").replace(/[.!?]+$/, "").trim(); }

  async function handle(text){
    const t = String(text || "").trim();
    if(!t) return null;

    if(pending){                                                  // an answer to my own question
      const p = pending;
      if(p.kind === "confirm"){
        if(isYes(t)){ pending = null; return p.run(p.c); }
        if(isNo(t)){ pending = null; return { text: "Okay, I've left it alone.", state: "IDLE" }; }
        pending = null;                                           // something else: not an answer, carry on normally
      } else if(p.kind === "pick"){
        if(isNo(t)){ pending = null; return { text: "Okay, never mind.", state: "IDLE" }; }
        const hit = p.list.find(c => norm(c.title) === norm(t)) || p.list.map(c => Object.assign({}, c, { sc: score(t, c.title) })).sort((a, b) => b.sc - a.sc).find(c => c.sc >= .6);
        if(hit){ pending = null; const r = p.run(hit); if(r && r._arm){ r._arm(); } return r; }
        pending = null;
      }
    }

    let m;
    if(/\b(plan (my|the) (day|evening|afternoon|morning)|how (busy|packed|full|loaded)|am i (free|overbooked|overloaded|busy)|daily overview|overview of (my|the) day)\b/i.test(t)) return overview();

    if((m = t.match(/^(?:please\s+)?(?:mark|set)\s+(.+?)\s+(?:as\s+)?(?:done|complete[d]?|finished)\b/i)) ||
       (m = t.match(/^(?:i(?:'ve| have)?\s+)?(?:just\s+)?(?:finished|completed|done with)\s+(.+)/i)) ||
       (m = t.match(/^(.+?)\s+(?:is|are)\s+(?:now\s+)?(?:done|complete[d]?|finished)\b/i))){
      const q = strip(m[1]); const hits = find(q);
      if(!hits.length) return notFound(q);
      const r = choose(hits, "mark done", doComplete); if(r && r._arm) r._arm(); return r;
    }
    if((m = t.match(/\b(?:make|set|mark)\s+(.+?)\s+(?:as\s+)?(?:a\s+)?(high|low|normal|medium|top|urgent)(?:[\s-]*priority)?\b/i)) || (m = t.match(/\bprioriti[sz]e\s+(.+)/i))){
      const pr = m[2] ? PRI[m[2].toLowerCase()] : "high", q = strip(m[1]); const hits = find(q);
      if(!hits.length) return notFound(q);
      return choose(hits, "re-prioritise", c => doPriority(c, pr));
    }
    if((m = t.match(/\b(?:rename|retitle)\s+(.+?)\s+to\s+(.+)/i)) || (m = t.match(/\b(?:change|edit)\s+(?:the\s+)?(?:title|name)\s+of\s+(.+?)\s+to\s+(.+)/i))){
      const q = strip(m[1]); const hits = find(q);
      if(!hits.length) return notFound(q);
      return choose(hits, "rename", c => doRename(c, m[2]));
    }
    if((m = t.match(/\b(?:move|reschedule|push|postpone|shift)\s+(.+?)\s+(?:to|till|until|for)\s+(.+)/i))){
      const q = strip(m[1]); const hits = find(q);
      if(!hits.length) return notFound(q);
      return choose(hits, "move", c => doMove(c, m[2]));
    }
    if((m = t.match(/^(?:please\s+)?(?:delete|remove|scrap|drop)\s+(.+)/i)) && !/\b(everything|all|history|memory|my data|chat)\b/i.test(m[1])){
      return removeFlow(strip(m[1]));
    }
    return null;
  }

  // also used when the language model (or a local rule) decided the student wants something removed: never delete on a guess
  async function removeFlow(title){
    const q = strip(title); if(!q) return null;
    const hits = find(q);
    if(!hits.length) return notFound(q);
    if(hits.length === 1 || (hits[0].score >= .8 && hits[0].score - (hits[1] ? hits[1].score : 0) >= .25)) return askDelete(hits[0]);
    const top = hits.slice(0, 4);
    pending = { kind: "pick", list: top, run: askDelete };
    return { text: "Which one should I delete?", state: "CURIOUS", opts: { choices: { mode: "single", options: top.map(c => ({ label: c.title.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 38), value: c.title })) } } };
  }

  window.DABSy.butler = { handle, removeFlow, overview, find, _score: score };
})();
