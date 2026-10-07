/* Creature-first ecosystem hub.
   These are real app destinations. DABSy never pretends a missing app is connected. */
(function(){
  const bus=window.DABSy.bus;
  const routes={
    "study-space":"https://swagatgaikwad92-boop.github.io/study-space/",
    "ghibli-calendar":"https://swagatgaikwad92-boop.github.io/Ghibli-Calander/",
    "solve-count":"https://swagatgaikwad92-boop.github.io/SolveCount/"
  };
  const items=[
    {id:"study-space",icon:"◫",title:"Study Space",desc:"Sessions, material & focus",route:routes["study-space"]},
    {id:"ghibli-calendar",icon:"🌿",title:"Ghibli Calendar",desc:"Schedule & tasks",route:routes["ghibli-calendar"]},
    {id:"solve-count",icon:"◎",title:"SolveCount",desc:"Questions & progress",route:routes["solve-count"]},
    {id:"settings",icon:"⚙",title:"Settings",desc:"DABSy preferences",route:null}
  ];
  function open(){
    render();
    document.getElementById("ecosystem-hub")?.classList.add("open");
    bus.emit("ecosystem:opened");
  }
  function close(){document.getElementById("ecosystem-hub")?.classList.remove("open")}
  function render(){
    const root=document.getElementById("ecosystem-items"); if(!root)return;
    root.innerHTML="";
    items.forEach(item=>{
      const b=document.createElement("button"); b.className="eco-bubble";
      b.setAttribute("aria-label", `Open ${item.title}`);
      b.innerHTML=`<span class="eco-icon">${item.icon}</span><strong>${item.title}</strong><small>${item.desc}</small><span class="eco-launch">Open ↗</span>`;
      b.addEventListener("click",()=>{
        if(item.id==="settings"){close();bus.emit("world:open",{tab:"settings"});return}
        close();
        window.open(item.route,"_blank","noopener");
      });
      root.appendChild(b);
    });
  }
  document.getElementById("ecosystem-close")?.addEventListener("click",close);
  document.getElementById("ecosystem-backdrop")?.addEventListener("click",close);
  bus.on("face:doubletap",open);
  bus.on("ecosystem:close",close);
  window.DABSy=window.DABSy||{};
  window.DABSy.ecosystem={open,close,items,routes};
})();
