/* One-time tiny tutorial. Skip/complete is persisted and replayable from Help. */
(function(){
  const bus=window.DABSy.bus, memory=window.DABSy.memory;
  let index=0;
  const slides=[
    ["Meet DABSy","Tap me for a quick reaction. Long-press to talk to me."],
    ["Open the ecosystem","Double-tap me to reveal Study Space, Calendar, SolveCount and more."],
    ["Study together","Give me a goal and, when a real AI backend is connected, I can plan a session around it."],
    ["Tasks without nagging","DABSy keeps contextual reminders instead of endlessly repeating the same alarm."]
  ];
  function open(force=false){
    if(!force){const s=memory.getTutorialState();if(s.completed||s.skipped)return}
    index=0; render(); document.getElementById("tutorial")?.classList.add("open");
  }
  function render(){
    const root=document.getElementById("tutorial"); if(!root)return;
    root.querySelector("[data-title]").textContent=slides[index][0];
    root.querySelector("[data-copy]").textContent=slides[index][1];
    root.querySelector("[data-progress]").textContent=`${index+1} / ${slides.length}`;
    root.querySelector("[data-next]").textContent=index===slides.length-1?"Done":"Next";
  }
  function finish(kind){memory.setTutorialState({completed:kind==="complete",skipped:kind==="skip"});document.getElementById("tutorial")?.classList.remove("open")}
  document.addEventListener("click",e=>{
    if(e.target.closest("[data-tutorial-skip]"))finish("skip");
    if(e.target.closest("[data-tutorial-next]")){if(index===slides.length-1)finish("complete");else{index++;render()}}
  });
  bus.on("boot:ready",()=>setTimeout(()=>open(false),1200));
  window.DABSy=window.DABSy||{}; window.DABSy.onboarding={open};
})();