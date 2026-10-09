/* ============================================================
   D.A.B.S.y — research-service.js : finding real study material
   Honest by construction:
     - "web" mode  : your proxy runs a REAL search API (backend/worker.js)
                     and returns real URLs; the AI only ranks/describes them.
     - "links" mode: no search service available -> DABSy does NOT invent
                     results. It offers clearly labelled "Search link" cards
                     that open a real search for the topic, plus anything you
                     picked before ("You used this before").
   Every card keeps its real URL; nothing is fabricated or "typed up".
   ============================================================ */
(function(){
  const ai = window.DABSy.ai;
  const memory = window.DABSy.memory;
  const learning = window.DABSy.learning;
  const LKEY = "library_v1";

  function guessType(url, hint){
    const u = String(url).toLowerCase();
    if(hint && ["video","article","practice","quiz","notes","pdf","course"].includes(hint)) return hint;
    if(/youtube\.com|youtu\.be|vimeo\.com/.test(u)) return "video";
    if(/\.pdf(\?|$)/.test(u)) return "pdf";
    if(/quiz|mcq|practice|worksheet|questions|test/.test(u)) return "practice";
    if(/khanacademy|coursera|edx|nptel|byjus.*(course)/.test(u)) return "course";
    if(/notes|ncert|cheat/.test(u)) return "notes";
    return "article";
  }
  function host(url){ try{ return new URL(url).hostname.replace(/^www\./, ""); }catch(e){ return ""; } }
  const isHttp = u => { try{ const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; }catch(e){ return false; } };

  function queryFor(goal){
    return [goal.level, goal.subject, goal.topic || "", goal.mode === "practice" ? "practice questions" : "explained lesson"].filter(Boolean).join(" ").trim() || goal.raw || "study";
  }

  function normalize(list){
    const seen = new Set(), out = [];
    (list || []).forEach((r, i) => {
      if(!r || !r.url || !isHttp(r.url)) return;
      const key = r.url.replace(/[#?].*$/, "").replace(/\/$/, "");
      if(seen.has(key)) return; seen.add(key);
      const rel = typeof r.relevance === "number" ? Math.max(0, Math.min(1, r.relevance)) : Math.max(.3, .92 - i * .07);
      out.push({
        id: "r" + (out.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
        title: String(r.title || host(r.url)).slice(0, 140),
        url: r.url, source: r.source || host(r.url), type: guessType(r.url, r.type),
        durationMin: r.durationMin ? Math.round(Number(r.durationMin)) : null,
        description: String(r.description || r.snippet || "").slice(0, 220),
        relevance: rel, origin: "search",
      });
    });
    return out;
  }

  function library(goal){
    const lib = memory.read(LKEY, []);
    const s = (goal.subject || "").toLowerCase();
    return lib.filter(x => !s || x.subject === s).slice(-3).map(x => Object.assign({}, x.r, { id: "lib-" + x.r.id, origin: "library", relevance: null }));
  }
  function linkCards(goal){
    const q = encodeURIComponent(queryFor(goal));
    const base = [
      { title: `Search YouTube: ${queryFor(goal)}`, url: "https://www.youtube.com/results?search_query=" + q, source: "youtube.com", type: "video", description: "Opens a YouTube search. I didn't pick a specific video." },
      { title: `Search the web: ${queryFor(goal)} notes`, url: "https://www.google.com/search?q=" + q + "+notes", source: "google.com", type: "notes", description: "Opens a web search for notes." },
      { title: `Practice questions: ${queryFor(goal)}`, url: "https://www.google.com/search?q=" + q + "+practice+questions", source: "google.com", type: "practice", description: "Opens a search for practice questions." },
      { title: `Khan Academy: ${goal.subject || "search"}`, url: "https://www.khanacademy.org/search?page_search_query=" + q, source: "khanacademy.org", type: "course", description: "Opens Khan Academy's own search." },
    ];
    return base.map((r, i) => Object.assign({ id: "link" + i, durationMin: null, relevance: null, origin: "link" }, r));
  }

  // -> { resources, mode: "web" | "links", note }
  async function find(goal){
    const lib = library(goal);
    if(ai.canSearch){
      const r = await ai.research({ query: queryFor(goal), subject: goal.subject, level: goal.level, maxResults: 8 });
      if(r.ok && Array.isArray(r.results) && r.results.length){
        let list = normalize(r.results).map(x => Object.assign(x, { score: x.relevance * learning.typeWeight(x.type) * learning.sourceWeight(learning.hostOf(x)) }));
        list.sort((a, b) => b.score - a.score);
        return { resources: lib.concat(list).slice(0, 9), mode: "web", note: "" };
      }
      return { resources: lib.concat(linkCards(goal)), mode: "links", note: r.error === "rate-limited" ? "Search is busy right now, so here are search links instead." : "I couldn't run a web search just now, so these are search links." };
    }
    return { resources: lib.concat(linkCards(goal)), mode: "links", note: "Live search isn't connected yet, so I can't pick specific lessons for you. These open real searches instead." };
  }

  // remember chosen real results so they show up next time
  function remember(chosen, goal){
    const lib = memory.read(LKEY, []);
    chosen.filter(r => r.origin === "search").forEach(r => {
      if(lib.some(x => x.r.url === r.url)) return;
      lib.push({ subject: (goal.subject || "").toLowerCase(), at: Date.now(), r: { id: r.id.replace(/^lib-/, ""), title: r.title, url: r.url, source: r.source, type: r.type, durationMin: r.durationMin, description: r.description } });
    });
    memory.write(LKEY, lib.slice(-30));
  }

  window.DABSy.research = { find, remember, queryFor, normalize, linkCards };
})();
