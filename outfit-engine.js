/* Data-driven wardrobe. Visual pieces are CSS layers so new outfits do not
   require rewriting the creature engine. */
(function(){
  const memory=window.DABSy.memory,bus=window.DABSy.bus;
  const outfits=[
    {id:"scholar",name:"Scholar",emoji:"🎓",desc:"Quiet study companion"},
    {id:"formal",name:"Formal",emoji:"🖤",desc:"Classic bow-tie mode"},
    {id:"winter",name:"Winter",emoji:"🧣",desc:"Cozy seasonal layer"},
    {id:"tech",name:"Tech",emoji:"⌁",desc:"Systems mode"},
    {id:"festival",name:"Festival",emoji:"✦",desc:"Special occasion"}
  ];
  function apply(id){const o=outfits.find(x=>x.id===id)||outfits[0];memory.setOutfit(o.id);document.documentElement.dataset.outfit=o.id;bus.emit("outfit:changed",{outfit:o});return o}
  function init(){apply(memory.getOutfit().id)}
  function getAll(){return outfits.slice()}
  window.DABSy=window.DABSy||{};window.DABSy.outfits={apply,init,getAll};
  init();
})();