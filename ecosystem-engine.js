/* Creature-first ecosystem hub.
   Routes are deliberately explicit. A missing app is shown as disconnected,
   never as a fake successful launch. Same-origin apps can later share state
   through BroadcastChannel/localStorage. */
(function(){
  const bus=window.DABSy.bus, memory=window.DABSy.memory;
  const routes={
    "study-space":"../Study-Space/index.html",
    "ghibli-calendar":"../Ghibli-Calander/index.html",
    "solve-count":"../SolveCount/index.html"
  };
  const items=[
    {id:"study-space",icon:"◫",title:"Study Space",desc:"Sessions, material & focus",route:routes["study-space"]},
    {id:"ghibli-calendar",icon:"🌿",title:"Ghibli Calendar",desc:"Schedule & tasks",route:routes["ghibli-calendar"]},
    {id:"solve-count",icon:"◎",title:"SolveCount",desc:"Questions & progress",route:routes["solve-count"]},
    {id:"notifications",icon:"◌",title:"DABSy Inbox",desc:"Contextual reminders",route:null},
    {id:"outfits",icon:"✦",title:"Wardrobe",desc:"Change DABSy's look",route:null},
    {id:"settings",icon:"⚙",title:"Settings",desc:"Preferences & connections",route:null}
  ];
  function isLikelyAvailable(route){
    return !!route; // actual navigation failure is still handled by the browser.
  }
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
      b.innerHTML=`<span class="eco-icon">${item.icon}</span><strong>${item.title}</strong><small>${item.desc}</small>`;
      b.addEventListener("click",()=>{
        if(item.id==="notifications"){close();bus.emit("world:open",{tab:"notifications"});return}
        if(item.id==="outfits"){close();bus.emit("world:open",{tab:"room"});return}
        if(item.id==="settings"){close();bus.emit("world:open",{tab:"settings"});return}
        if(item.route && isLikelyAvailable(item.route)){ location.href=item.route; return; }
        bus.emit("ecosystem:unavailable",{id:item.id});
      });
      root.appendChild(b);
    });
  }
  document.getElementById("ecosystem-close")?.addEventListener("click",close);
  document.getElementById("ecosystem-backdrop")?.addEventListener("click",close);
  bus.on("face:doubletap",open);
  bus.on("ecosystem:close",close);
  window.DABSy=window.DABSy||{};
  window.DABSy.ecosystem={open,close,items};
})();