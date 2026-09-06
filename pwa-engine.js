/* ============================================================
   D.A.B.S.y — pwa-engine.js
   Registers the service worker using a relative path so this
   works whether hosted at the domain root or under a GitHub
   Pages project path (username.github.io/repo/).
   ============================================================ */

(function(){
  if("serviceWorker" in navigator){
    window.addEventListener("load", ()=>{
      const swUrl = new URL("./sw.js", document.baseURI).toString();
      navigator.serviceWorker.register(swUrl, { scope: "./" })
        .catch(err => console.warn("SW registration failed", err));
    });
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    window.DABSy?.bus?.emit("pwa:installable");
  });

  async function promptInstall(){
    if(!deferredPrompt) return false;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return choice.outcome === "accepted";
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.pwa = { promptInstall };
})();
