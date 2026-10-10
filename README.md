# D.A.B.S.y v8 — AI study companion + ecosystem hub

A flat-file, no-build PWA. Drop the folder on GitHub Pages and it runs.

## New in v8
- **Minimal is now DABSy's default look**: two glowing eyes, a small bow tie, and any gear she wears — floating, no body, no fur.
- **Fur mode** (Settings → Wardrobe → *Fur mode*, or the Minimal / Furry tiles): adds the v7 blue-purple fur aura. It is only a look: memory, settings, chats, animations and accessories are untouched, and eyes / bow tie / gear sit in the same place in both looks. Fur layers are removed from the page entirely in Minimal.
- **Light theme** (Settings → Appearance → Theme: Dark / Light / Auto). Warm ivory, graphite text, lavender-blue accents. Theme and character look are independent, so all four combinations work.
- Wardrobe: new **Cap** and **Hood**, **bow-tie colours**, per-look placement for every worn piece (`PLACEMENT` and `place:{minimal,furry}` in `outfits-data.js`).
- Eyes are slightly larger and closer together and the bow tie is smaller, matching the v8 character sheet.
- Persisted with the existing storage: look + bow tie in `dabsy_wardrobe_v1`, theme in `dabsy_settings`. No backend, no API key.

## What it is
A soft, expressive creature you tap, double-tap and long-press. It plans study sessions, keeps tasks, nudges you contextually, hands work to Study Space and opens your other apps.

| Gesture | Alternative | Result |
|---|---|---|
| Tap | Enter / Space | Contextual reaction (eyes, head, bow tie, body each react differently) |
| Double-tap | "Apps" button, ↓ key | Ecosystem bubbles: Study Space, Ghibli Calendar, SolveCount, Settings (extensible via `DABSy.ecosystem.register`) |
| Long-press | "Talk" button, ↑ key | Command mode: type or speak |

Turn on the visible buttons under Settings → Accessibility → Show shortcut buttons.

## Run locally
```
cd dabsy && python3 -m http.server 8080
```
Open http://localhost:8080 (service workers need localhost or https).

## Deploy to GitHub Pages
1. Create a repo and push the contents of this folder to its root (so `index.html` is at the top level).
2. Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://<you>.github.io/<repo>/`. All paths are relative, so project sub-paths work.
4. When you add files, add them to `SHELL_FILES` in `sw.js` and bump `CACHE_VERSION` (v8 ships `theme.css` and `theme-engine.js`, already listed).
5. (Optional) deploy the AI proxy in `backend/` (see `backend/BACKEND.md`) and set `ai.proxyUrl` in `dabsy-config.js`.

## Structure
- `index.html`, `*.css`, `*.js` — the app; engines are lazy-loaded through `DABSy.require()`.
- `dabsy-config.js` — feature flags, lazy registry, proxy URL (never a secret).
- `backend/` — Cloudflare Worker proxy (holds the secrets).
- `integrations/` — adapters to drop into Study Space / SolveCount.
- `docs/INTEGRATION.md`, `docs/FLOATING.md` — cross-app contract and native-Android bubble boundary.

## Honest capability map

**Works now (no backend):** the creature and all gestures; command mode; tasks as objects (due, priority, status, recurrence, subject, duration, reschedule info); free-slot search including Ghibli Calendar; the notification engine and in-app glass notification centre (with Start/Move/Skip style actions, quiet hours, daily budget, back-off when ignored); just-in-time permission prompts; adaptive study planner, wall-clock session timer, wake lock, recall check and follow-up; Study Space hand-off over same-origin storage and BroadcastChannel (status shows "Opened" only after Study Space acknowledges); first-launch tutorial with replay; settings; wardrobe/outfit system; Easter eggs; PWA install and offline shell.

**Needs the backend proxy:** free chat and explanations; real web research (resource cards are "Search links" labelled as such until then); intent parsing for text the offline rules don't match.

**Needs native Android (not faked):** floating bubble over other apps; notifications while the app is fully closed (a push server or native scheduler is required); exact alarms; usage-access detection. `docs/FLOATING.md` defines the `DABSyNative` / `DABSyFloating` bridge.

## Known limitations
- Study Space / SolveCount integration needs the apps on the same origin (e.g. all under `you.github.io`) and the adapters installed; otherwise the hand-off stays "waiting".
- A PWA can't fire timers when the OS has killed it; due nudges appear when it is next opened or via system notification only while a service worker is alive.
- Creature is CSS-layered (soft plush shading and fur grain), not a WebGL mesh; this keeps it smooth on low/mid phones. Furry mode is the v7 fur (CSS gradients + one static displacement filter); Minimal draws none of it.
- The Hood accessory is a hood shape; in Minimal it floats around the eyes rather than wrapping a head.
- Light theme: the manifest / install splash colour stays dark (a PWA manifest can't change at runtime); the browser bar colour does follow the theme.
- Outfits ship a small starter set; the data format in `outfits-data.js` is built to extend.
- AI via the proxy costs whoever owns the provider key; rate limits are in the Worker.
- No API-key field exists in the UI by design. The only client override is a dev proxy URL (not a secret) on one device.
