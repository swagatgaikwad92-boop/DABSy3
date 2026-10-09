# Floating DABSy (future Android-native bubble)

**A PWA cannot float over other apps.** Browsers have no API for drawing outside their own window. A floating DABSy needs a native Android app.

## What the native app needs
1. A Kotlin/Java app that hosts DABSy (WebView with `addJavascriptInterface`) or renders the creature natively.
2. **Display over other apps**: permission `SYSTEM_ALERT_WINDOW`; the user grants it in Android settings (`Settings.ACTION_MANAGE_OVERLAY_PERMISSION`).
3. A **foreground service** with a persistent notification so Android keeps the bubble alive.
4. A small bubble view (head only, ~72dp) that can be dragged and snapped to an edge.

## The seam already in this repo (`floating-engine.js`)
Native → JS: `window.DABSyFloating.receive('{"type":"bubble.tap"}')`, also `bubble.doubletap`, `bubble.longpress`.
JS → native: `window.DABSyNative.postMessage(json)` with `{type:"state", data:{expression, outfit, acc, unread, quiet}}`, `{type:"show"}`, `{type:"hide"}`.

In the browser, `DABSy.floating.enable()` returns `{ok:false, reason}` and Settings says "Needs the Android app". Nothing is faked.

## Practical path
Wrap this exact site in a Trusted Web Activity or a WebView shell, add the overlay service, and the bubble can mirror the creature's expression and open the full app on tap.
