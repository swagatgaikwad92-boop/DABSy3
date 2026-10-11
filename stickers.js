/* stickers.js — small original inline-SVG illustrations (soda bottle, banana-milk carton,
   ice cube, star, cloud, popsicle). No network, no copyrighted artwork. Decorative: aria-hidden.
   DABSy.stickers.el(name, size) -> element; DABSy.stickers.names */
(function(){
  const S = {
    soda:`<svg viewBox="0 0 48 48"><rect x="19" y="3" width="10" height="7" rx="2" fill="#d9dee6"/><path d="M19 10h10v6c5 3 6 7 6 12v13a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V28c0-5 1-9 6-12z" fill="#8fd8f5" stroke="#1f6d9a" stroke-width="2"/><circle cx="21" cy="30" r="2" fill="#fff" opacity=".9"/><circle cx="28" cy="24" r="1.5" fill="#fff" opacity=".9"/><circle cx="26" cy="35" r="1.2" fill="#fff" opacity=".9"/></svg>`,
    milk:`<svg viewBox="0 0 48 48"><path d="M14 14l5-9h10l5 9z" fill="#fbf7ea" stroke="#8a6400" stroke-width="2" stroke-linejoin="round"/><rect x="14" y="14" width="20" height="29" rx="3" fill="#ffe48a" stroke="#8a6400" stroke-width="2"/><path d="M20 26c0-3 8-3 8 0s-8 6-8 9" fill="none" stroke="#8a6400" stroke-width="2" stroke-linecap="round"/></svg>`,
    ice:`<svg viewBox="0 0 48 48"><rect x="9" y="11" width="30" height="30" rx="7" fill="#e9f8ff" stroke="#8fd8f5" stroke-width="2.5" transform="rotate(-8 24 26)"/><path d="M16 20l6-4" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`,
    star:`<svg viewBox="0 0 48 48"><path d="M24 5l5.5 12 13 1.5-9.7 8.8 2.8 12.9L24 33.4 12.4 40.2l2.8-12.9L5.5 18.5l13-1.5z" fill="#ffe48a" stroke="#8a6400" stroke-width="2" stroke-linejoin="round"/></svg>`,
    cloud:`<svg viewBox="0 0 48 48"><path d="M15 36a8 8 0 0 1-1-16 10 10 0 0 1 19-2 8.5 8.5 0 0 1 1 18z" fill="#fbf7ea" stroke="#cfc6f5" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
    pop:`<svg viewBox="0 0 48 48"><rect x="21" y="30" width="6" height="14" rx="3" fill="#d9b98a"/><path d="M14 30V16a10 10 0 0 1 20 0v14z" fill="#ffcfb0" stroke="#c7765a" stroke-width="2"/><path d="M14 22h20" stroke="#fff" stroke-width="2" opacity=".7"/></svg>`
  };
  function el(name, size){
    const d = document.createElement("span");
    d.className = "sticker-art"; d.setAttribute("aria-hidden", "true");
    d.style.cssText = "display:inline-block;width:" + (size || 40) + "px;height:" + (size || 40) + "px";
    d.innerHTML = S[name] || S.star; return d;
  }
  window.DABSy = window.DABSy || {};
  window.DABSy.stickers = { el, names: Object.keys(S) };
})();
