/* DABSy Agent layer.
   Turns a broad goal into a real workflow. Web research is intentionally
   abstracted: a backend may implement search; the frontend never pretends
   that it searched when it did not. */
(function(){
  const bus=window.DABSy.bus, memory=window.DABSy.memory;
  const provider=window.DABSy.aiProvider;
  const selectedKey="dabsy_agent_resources_v1";

  function parseJSON(raw){
    try{ return JSON.parse(String(raw).replace(/^```json/i,"").replace(/^```|```$/g,"").trim()); }
    catch(e){ return null; }
  }
  async function planGoal(goal, constraints={}){
    const prompt=`Plan a study goal without pretending to browse.
Goal: ${goal}
Available minutes: ${constraints.minutes||60}
Subject: ${constraints.subject||"infer"}
Return JSON: {"subject":"","sessionTitle":"","steps":[{"title":"","minutes":0,"kind":"study|break|recall"}],"needsResearch":true|false,"searchQuery":"","message":""}.
Use realistic durations that sum approximately to available time.`;
    const r=await provider.generate({system:"You are DABSy, a concise study-planning agent.",user:prompt,json:true});
    const parsed=r.ok?parseJSON(r.text):null;
    if(parsed) return {ok:true,...parsed};
    return {ok:false,error:r.error||"invalid"};
  }
  async function research(query){
    const r=await provider.generate({system:"You are DABSy's research adapter. Only return results actually available to you. If you cannot browse, return an empty array and browsable:false.",user:`Find useful study resources for: ${query}. Return JSON {"browsable":true|false,"resources":[{"title":"","type":"","source":"","duration":"","description":"","relevance":0,"url":""}]}.`,json:true});
    const parsed=r.ok?parseJSON(r.text):null;
    if(parsed?.browsable && Array.isArray(parsed.resources)) return parsed;
    return {browsable:false,resources:[]};
  }
  function saveSelection(resources){
    localStorage.setItem(selectedKey,JSON.stringify(resources||[]));
    bus.emit("agent:resources:selected",{resources});
    return resources;
  }
  function getSelection(){try{return JSON.parse(localStorage.getItem(selectedKey)||"[]")}catch(e){return[]}}
  function buildSession(plan,resources=[]){
    const session={id:"s"+Date.now(),createdAt:new Date().toISOString(),title:plan.sessionTitle||"Study session",subject:plan.subject||"",steps:plan.steps||[],resources};
    localStorage.setItem("dabsy_active_study_session_v1",JSON.stringify(session));
    bus.emit("agent:session:ready",{session});
    return session;
  }
  window.DABSy=window.DABSy||{};
  window.DABSy.agent={planGoal,research,saveSelection,getSelection,buildSession};
})();