/* D.A.B.S.y AI facade.
   IMPORTANT: no provider secret is accepted from the UI. All LLM calls go
   through ai-provider.js. A GitHub Pages build therefore needs a secure
   backend/proxy for real model calls. Local rule-based fallbacks keep basic
   companion/scheduling behaviour usable without one. */
(function(){
  const memory=window.DABSy.memory, provider=window.DABSy.aiProvider;
  const VALID=["IDLE","CURIOUS","HAPPY","FOCUSED","THINKING","SURPRISED","PLAYFUL","STUDY_FOCUS","CONFUSED"];
  const jsonClean=s=>String(s||"").trim().replace(/^```json/i,"").replace(/^```|```$/g,"").trim();
  function localSchedule(text){
    const m=text.match(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if(!m)return null;
    let h=Number(m[1]), min=Number(m[2]||0), ap=(m[3]||"").toLowerCase();
    if(ap==="pm"&&h<12)h+=12;if(ap==="am"&&h===12)h=0;
    if(h>23||min>59)return null;
    const recurring=/\b(every day|daily|every weekday|every monday|every tuesday|every wednesday|every thursday|every friday|every saturday|every sunday)\b/i.test(text);
    let days=[0,1,2,3,4,5,6];
    const dayMap={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
    const dm=text.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if(dm)days=[dayMap[dm[1].toLowerCase()]];
    let title=text.replace(/\b(i have|i need to|remind me to|remind me|schedule|add|put)\b/gi,"")
      .replace(/\b(?:at|@)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi,"")
      .replace(/\b(every day|daily|every weekday|every monday|every tuesday|every wednesday|every thursday|every friday|every saturday|every sunday)\b/gi,"")
      .trim().replace(/\s+/g," ");
    if(!title)title="Task";
    return {title,hour:h,minute:min,duration_minutes:30,recurring,days,date_offset_days:0,category:/chem|physics|math|biology|study|revision|homework/i.test(title)?"study":"personal",emoji:null};
  }
  function fallback(text){
    const t=text.toLowerCase();
    if(/^(hi|hello|hey|yo)\b/.test(t))return{type:"chat",reply:"I'm here. What are we building or studying?",state:"HAPPY"};
    if(/\bwhat('?s| is) next\b/.test(t))return{type:"chat",reply:"Open my ecosystem and I'll show your next scheduled item.",state:"CURIOUS"};
    const sc=localSchedule(text);
    if(sc)return{type:"schedule_add",reply:`Got it. I'll put "${sc.title}" on the schedule.`,state:"HAPPY",schedule:sc};
    if(/\b(api key|apikey)\b/.test(t))return{type:"chat",reply:"DABSy no longer asks for an API key. A secure AI connection belongs behind the app.",state:"HAPPY"};
    return{type:"chat",reply:"I can handle that locally, but my secure AI service isn't connected yet.",state:"IDLE"};
  }
  async function call(system,user,imageBase64){
    return provider.generate({system,user,imageBase64,json:true});
  }
  async function parseIntent(text){
    const prefs=memory.getPreferences().map(p=>p.text).join("; ")||"none";
    const recent=memory.getSession(6).map(m=>`${m.role}: ${m.text}`).join("\n");
    const prompt=`Classify this DABSy message. Return ONLY JSON:
{"type":"chat|schedule_add|schedule_remove","reply":"","state":"IDLE|CURIOUS|HAPPY|FOCUSED|THINKING|SURPRISED|PLAYFUL|STUDY_FOCUS|CONFUSED","schedule":{"title":"","hour":0,"minute":0,"duration_minutes":30,"recurring":false,"days":[0,1,2,3,4,5,6],"date_offset_days":0,"category":null,"emoji":null}}
Only schedule_add when an actual time is supplied. Current date: ${new Date().toDateString()}.
Preferences: ${prefs}. Recent: ${recent||"none"}.
User: ${text}`;
    const r=await call("You are DABSy, a warm concise creature-first study companion.",prompt);
    if(!r.ok)return fallback(text);
    try{
      const o=JSON.parse(jsonClean(r.text));
      return {type:["schedule_add","schedule_remove"].includes(o.type)?o.type:"chat",reply:o.reply||"Got it.",state:VALID.includes(o.state)?o.state:"IDLE",schedule:o.schedule||null};
    }catch(e){return fallback(text)}
  }
  async function askConflictQuestion(candidate,conflict){
    const r=await call("You are DABSy. Ask a short scheduling conflict question.","New: "+candidate.title+" at "+candidate.start.toLocaleTimeString()+". Existing: "+conflict.title+" at "+conflict.start.toLocaleTimeString()+". Return JSON {\"reply\":\"\",\"state\":\"CURIOUS\"}.");
    if(!r.ok)return{reply:`You've already got "${conflict.title}" around then. Move it, cancel it, or keep both?`,state:"CURIOUS"};
    try{const o=JSON.parse(jsonClean(r.text));return{reply:o.reply||r.text,state:VALID.includes(o.state)?o.state:"CURIOUS"}}catch(e){return{reply:r.text,state:"CURIOUS"}}
  }
  async function resolveConflictIntent(text,candidate,conflict){
    const r=await call("Classify a scheduling conflict answer. Return JSON {action,reply,state}. action must be move_existing,cancel_existing,keep_both,cancel_new,unclear.",`New "${candidate.title}", existing "${conflict.title}". User: ${text}`);
    if(!r.ok)return{action:"unclear",reply:"Move it, cancel it, or keep both?",state:"CONFUSED"};
    try{const o=JSON.parse(jsonClean(r.text));return{action:["move_existing","cancel_existing","keep_both","cancel_new"].includes(o.action)?o.action:"unclear",reply:o.reply||"Done.",state:VALID.includes(o.state)?o.state:"IDLE"}}catch(e){return{action:"unclear",reply:"Move it, cancel it, or keep both?",state:"CONFUSED"}}
  }
  async function askDABSy(prompt,opts={}){
    const r=await provider.generate({system:"You are DABSy, tutoring a Class 11 science student. Be clear, concise and accurate.",user:opts.context+"\n"+prompt,imageBase64:opts.imageBase64,json:false});
    if(!r.ok)return{text:"My secure AI service isn't connected yet. The study interface is ready, but this deployment needs its backend.",state:"IDLE"};
    return{text:r.text,state:"FOCUSED"};
  }
  async function agentGoal(goal,minutes){
    return window.DABSy.agent.planGoal(goal,{minutes});
  }
  window.DABSy=window.DABSy||{};
  window.DABSy.ai={parseIntent,askConflictQuestion,resolveConflictIntent,askDABSy,agentGoal};
})();