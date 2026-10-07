/* DABSy ecosystem: radial launch bubbles, no scroll sheet. */
(function(){
  const bus=window.DABSy.bus;
  const hub=document.getElementById('ecosystem-hub');
  const root=document.getElementById('ecosystem-items');
  const routes={
    'study-space':'https://swagatgaikwad92-boop.github.io/study-space/',
    'ghibli-calendar':'https://swagatgaikwad92-boop.github.io/Ghibli-Calander/',
    'solve-count':'https://swagatgaikwad92-boop.github.io/SolveCount/'
  };
  const items=[
    {id:'study-space',icon:'📚',title:'Study Space',desc:'Sessions & focus',route:routes['study-space']},
    {id:'ghibli-calendar',icon:'🌿',title:'Ghibli Calendar',desc:'Schedule & tasks',route:routes['ghibli-calendar']},
    {id:'solve-count',icon:'◎',title:'SolveCount',desc:'Questions & progress',route:routes['solve-count']},
    {id:'settings',icon:'⚙',title:'Settings',desc:'DABSy preferences',route:null}
  ];
  let built=false;
  function build(){
    if(built)return; built=true; root.innerHTML='';
    items.forEach((item,i)=>{
      const b=document.createElement('button');
      b.className='eco-bubble'; b.dataset.index=i;
      b.setAttribute('aria-label',`Open ${item.title}`);
      b.innerHTML=`<span class="eco-icon">${item.icon}</span><strong>${item.title}</strong><small>${item.desc}</small>`;
      b.addEventListener('click',()=>{
        close();
        if(item.id==='settings') bus.emit('world:open',{tab:'settings'});
        else window.location.href=item.route;
      });
      root.appendChild(b);
    });
  }
  function position(){
    const cx=window.innerWidth/2, cy=window.innerHeight/2;
    const r=Math.min(150,Math.max(108,window.innerWidth*.30));
    const angles=[-90,0,90,180];
    root.querySelectorAll('.eco-bubble').forEach((b,i)=>{
      const a=angles[i]*Math.PI/180;
      b.style.left=cx+'px'; b.style.top=cy+'px';
      b.style.setProperty('--x',(Math.cos(a)*r).toFixed(1)+'px');
      b.style.setProperty('--y',(Math.sin(a)*r).toFixed(1)+'px');
    });
  }
  function open(){build();position();hub.classList.add('open');hub.setAttribute('aria-hidden','false');bus.emit('ecosystem:opened');}
  function close(){hub.classList.remove('open');hub.setAttribute('aria-hidden','true');}
  document.getElementById('ecosystem-close')?.addEventListener('click',close);
  document.getElementById('ecosystem-backdrop')?.addEventListener('click',close);
  window.addEventListener('resize',()=>{if(hub.classList.contains('open'))position();});
  bus.on('face:doubletap',open);
  window.DABSy.ecosystem={open,close,items,routes};
})();
