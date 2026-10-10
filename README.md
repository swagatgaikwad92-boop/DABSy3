# D.A.B.S.y v8 — AI study companion + ecosystem hub

A flat-file, no-build PWA. Drop the folder on GitHub Pages and it runs.

## New in v8.3 (visual + gesture repair)
- **Fur On no longer changes who DABSy is.** Fur Off is the canonical design: two floating glowing eyes and a small fuzzy purple bow tie, nothing else. Fur On draws the *same* eyes and bow tie (same position, scale, shape, colour, glow, blink and expressions) and only adds fine shell-fur fibres around them (`fur3d-engine.js`, WebGL, drawn behind the DOM eyes). No head, body, ears, muzzle, nose or eye sockets exist in either look. The fibres follow each eye's live shape, so they stay attached when DABSy squints or looks around. Switching modes only fades the fibres in/out — nothing reloads and no expression resets.
- Fixed: after Fur On → Fur Off the old build could leave a ghost body behind; the body/ears/plate/cheek/bead layers are gone entirely.
- No WebGL? Fur Off is unchanged; Fur On then shows only the CSS fibre rim on the eyes (an honest, smaller effect — real 3D fur needs WebGL).
- **Gestures (all handled in `interaction-engine.js`, one set of listeners):**

| Gesture | Alternative | Result |
|---|---|---|
| Tap an eye | Enter / Space, "Talk" button | Chat input opens at once (once) |
| Tap the bow tie | | DABSy spins, may say a line; the tie puffs |
| Double-tap (anywhere) | "Apps" button, ArrowDown | Ecosystem bubbles (apps) |
| Press and hold | ArrowUp | Tasks / reminders |
| Stroke | | Pet |

- A double-tap closes the chat that its first tap opened and never opens the keyboard; a hold cancels any pending tap; one finger is tracked; the browser's follow-up click after a hold/double-tap is swallowed (it used to close the tasks sheet the instant you lifted your finger).

## v8.2 notes (superseded by v8.3 where they mention a body, ears, a bead or hold-for-command-mode)
- **Real 3D plush fur** (`fur3d-engine.js`, small WebGL canvas): rounded body, tapered volumetric ears and a puffed bow tie with a raised knot, drawn as ~16 fur shells with tapered, curved strands, key + rim light, root occlusion, eye-socket shading and a contact shadow under the tie. It turns slightly toward where DABSy looks. No WebGL → the previous CSS fur stays (automatic). Lite phones: fewer shells, 1× pixel ratio; a frame-time monitor lowers resolution on slow GPUs; paused while the tab is hidden.
- **Furry is now the default look** (saved devices move to it once; Settings → Wardrobe → Fur mode switches it off). Egg-shaped cyan eyes + the small glassy bead between them follow the v7 reference sheet; Minimal keeps its pill eyes and gets the 3D bow tie.
- **Blink**: the lid now lives inside each eye, clipped to its shape, with a curved edge that sweeps down (≈90 ms), holds, and lifts slower (≈200 ms); no more flat navy rectangles.
- **Gestures**: tap on the eyes → chat immediately · hold on the eyes → tasks / reminders (a hold never also opens chat) · double-tap (the bow tie, or anywhere) → apps · hold elsewhere → command mode (as before). Hit areas are measured from the rendered eyes and bow tie and padded to ≥ 46 px; the old bow-tie zone sat below the visible tie, which is why it felt dead.
- Bow-tie double-tap gives feedback: a ring, a tiny haptic and a puff of the tie.

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
| Tap an eye | Enter / Space | Chat input |
| Tap the bow tie | | Spin + a line |
| Double-tap | "Apps" button, ↓ key | Ecosystem bubbles: Study Space, Ghibli Calendar, SolveCount, Settings (extensible via `DABSy.ecosystem.register`) |
| Press and hold | ↑ key | Tasks and reminders |

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
- Creature body, ears and tie are WebGL shell fur (v8.2); eyes, lids, cheeks and gear stay DOM/SVG. Without WebGL the CSS fur is used instead.
- The Hood accessory is a hood shape; in Minimal it floats around the eyes rather than wrapping a head.
- Light theme: the manifest / install splash colour stays dark (a PWA manifest can't change at runtime); the browser bar colour does follow the theme.
- Outfits ship a small starter set; the data format in `outfits-data.js` is built to extend.
- AI via the proxy costs whoever owns the provider key; rate limits are in the Worker.
- No API-key field exists in the UI by design. The only client override is a dev proxy URL (not a secret) on one device.
