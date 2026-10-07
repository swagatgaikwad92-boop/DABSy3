/* DABSy notification architecture.
   Browser notifications are requested just-in-time and can only fire while
   the PWA/browser grants the platform permission. The in-app centre is always
   available. */
(function(){
  const KEY="dabsy_notifications_v1";
  const bus=window.DABSy.bus;
  function read(){try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch(e){return[]}}
  function write(x){try{localStorage.setItem(KEY,JSON.stringify(x.slice(-100)))}catch(e){}}
  function add(item){
    const n={id:"n"+Date.now()+Math.random().toString(36).slice(2,6),ts:Date.now(),read:false,...item};
    const list=read(); list.push(n); write(list); bus.emit("notifications:changed",{notification:n}); return n;
  }
  function markRead(id){write(read().map(n=>n.id===id?{...n,read:true}:n));bus.emit("notifications:changed")}
  function clear(){write([]);bus.emit("notifications:changed")}
  async function requestPermission(){
    if(!("Notification" in window)) return "unsupported";
    if(Notification.permission==="granted") return "granted";
    if(Notification.permission==="denied") return "denied";
    return Notification.requestPermission();
  }
  async function push(item,{ask=false}={}){
    const n=add(item);
    if(!("Notification" in window)) return n;
    let p=Notification.permission;
    if(ask && p==="default") p=await requestPermission();
    if(p==="granted"){
      try{new Notification(item.title||"DABSy",{body:item.body||"",tag:item.tag||n.id,data:{id:n.id}})}catch(e){}
    }
    return n;
  }
  function scheduleAt(when,item){
    const ms=new Date(when).getTime()-Date.now();
    if(ms<=0){push(item);return null}
    return setTimeout(()=>push(item),Math.min(ms,2147483647));
  }
  function getAll(){return read()}
  window.DABSy=window.DABSy||{};
  window.DABSy.notifications={push,scheduleAt,requestPermission,getAll,markRead,clear};
})();