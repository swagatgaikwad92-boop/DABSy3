// Overlay layers (chat, sheets) mapped onto browser history so the Android back button closes the top layer.
const stack = [];
let ignore = 0;

/** Register an overlay. `close({fromHistory})` must dismiss it. Returns a handle for release(). */
export function pushLayer(close) {
  const layer = { close };
  stack.push(layer);
  try { history.pushState({ dabsyLayer: stack.length }, ''); } catch { /* history unavailable */ }
  return layer;
}

/** Call when the owner closes the overlay itself (button, backdrop, programmatic). */
export function releaseLayer(layer) {
  const i = stack.indexOf(layer);
  if (i < 0) return;
  stack.splice(i, 1);
  if (i === stack.length) {
    ignore++;
    try { history.back(); } catch { ignore--; }
  }
}

export function topLayer() { return stack[stack.length - 1] || null; }
export function layerCount() { return stack.length; }

if (typeof addEventListener === 'function') {
  addEventListener('popstate', () => {
    if (ignore > 0) { ignore--; return; }
    const top = stack.pop();
    if (top) top.close({ fromHistory: true });
  });
}
