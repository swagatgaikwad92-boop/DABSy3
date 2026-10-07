/* DABSy theme engine: auto/day/night without reload. */
(function(){
  const KEY="dabsy_theme_v1";
  const media=window.matchMedia?.("(prefers-color-scheme: dark)");
  function apply(mode){
    const actual=mode==="auto" ? (media?.matches ? "night":"day") : mode;
    document.documentElement.dataset.theme=actual;
    document.documentElement.dataset.themeMode=mode;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta) meta.content=actual==="night" ? "#05060a" : "#edf2f6";
  }
  function set(mode){ localStorage.setItem(KEY,mode); apply(mode); }
  function get(){ return localStorage.getItem(KEY)||"auto"; }
  apply(get());
  media?.addEventListener?.("change",()=>{ if(get()==="auto") apply("auto"); });
  window.DABSy=window.DABSy||{};
  window.DABSy.theme={get,set,apply};
  document.addEventListener("DOMContentLoaded",()=>{
    const select=document.getElementById("theme-select");
    if(!select)return;
    select.value=get();
    select.addEventListener("change",()=>set(select.value));
  });
})();
