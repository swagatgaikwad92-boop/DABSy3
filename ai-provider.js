/* DABSy AI provider abstraction.
   No secret belongs in this file. Configure a same-origin /api/ai backend
   (or window.DABSY_AI_ENDPOINT) that accepts {messages, imageBase64?}.
   The GitHub Pages frontend remains safe when the backend is absent. */
(function(){
  const DEFAULT_ENDPOINT = "/api/ai";
  function endpoint(){ return window.DABSY_AI_ENDPOINT || window.DABSy?.memory?.getSettings?.().aiEndpoint || DEFAULT_ENDPOINT; }
  async function generate({system="", user="", imageBase64=null, json=false}={}){
    const ep = endpoint();
    if(!ep) return {ok:false,error:"no-endpoint"};
    try{
      const res = await fetch(ep,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({messages:[
          ...(system?[{role:"system",content:system}]:[]),
          {role:"user",content:user}
        ], imageBase64, responseFormat: json ? "json" : "text"})
      });
      if(!res.ok) return {ok:false,error:"http",status:res.status};
      const data=await res.json();
      return {ok:true,text:data.text ?? data.output ?? data.reply ?? "", raw:data};
    }catch(e){ return {ok:false,error:"network",detail:e}; }
  }
  window.DABSy=window.DABSy||{};
  window.DABSy.aiProvider={generate,endpoint};
})();