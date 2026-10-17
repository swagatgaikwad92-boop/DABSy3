# DABSy v10.3.0 — Turbo AI + three user bugs
- **Widgets "not available":** added an always-visible widgets button (top left, next to Day/Night) and, on first run only, a Time & date widget is added so the feature is visible. Settings → Widgets still works.
- **Study Mode glass:** the answer surface is now real liquid glass (translucent tint, blur, rim, highlight), day and night.
- **Keyboard smoothness:** the chat dock now rises with a GPU transform and starts the instant you tap the input (predicted height, then corrected from the real one and remembered); DABSy makes ONE 0.3 s move instead of three. Keyboard tested by emulation only.
- **AI:** see docs/TURBO-AI-DEPLOY.md. New `backend/dabsy-brain.js` (streaming, bounded retry, honest errors, current Gemini models), streaming + honest errors + bounded history in `ai-engine.js`, one AI request per chat message (`calendar-intel.js`), streamed replies in the subtitle and Study Mode. Tests: `tests/worker-test.mjs` (24/24, mock Gemini), `tests/t15.py` (20/20, mock Worker).

---

# DABSy v10.2.0 (+ supplied day/night wallpapers) — wallpapers, manual Day/Night, habitat seating, keyboard perf, flowing Study Mode, glass widgets, tutorial

**Wallpapers supplied by you** are now real day AND night rooms: Moonlit window nook, Study desk, Lakeside (the daylight grade is gone). Cosy bed stays as an illustrated room. Files: `assets/magic/{room,desk,lake}-{day,night}.webp`, embedded in `magic-assets.js` (1.2 MB, loaded only when a wallpaper is on). Spots for the new rooms were placed by eye from your pictures; check them on your phone.
**1. Wallpaper selection.** I could NOT reproduce "cannot select" in headless Chromium: the old Magic World tile did switch. Real fragilities found and fixed: only ONE picture existed (so "choosing" looked like nothing happened), the settings sheet covered the result, a failed image silently flipped back to Classic, and the world kept its own light/roam prefs. Now: Settings → Wallpaper has Black screen + 4 rooms (3 new illustrated rooms, each with real day and night pictures, plus the supplied photo room). Tap applies immediately, a tick + aria-checked marks it, it persists, a failed picture is refused with a message (selection never silently changes), Black screen is one tap. Files: `habitat-scenes.js` (new), `habitats-data.js`, `world-engine.js`, `settings-engine.js`.
**2. Day/Night.** One control (`DABSy.theme.setMode("day"|"night"|"auto")`) drives interface AND room. Top-left sun/moon button + Settings → Day / Night. Default Night; Auto only if chosen; the clock is never read otherwise. The photo room has no day artwork: its Day is a static daylight grade (labelled as such). `theme-engine.js`, `perf.css`.
**3. Seating.** Spots are derived from object geometry in `habitat-scenes.js` (pillow top, desk top, sill top). Wandering now defaults to OFF (it was the random sitting); it can visit the room's other real objects if enabled. Switching wallpaper re-seats her. In Study Mode she tucks to a compact spot above the explanation.
**4. Keyboard lag — causes:** visualViewport `scroll` listener (fires constantly), `--vvh` rewritten every tick, smooth `scrollIntoView` on every change, an animated `bottom` on the chat dock, duplicate world listener, and blur/glow/breathing running during the transition. Fix: `viewport-engine.js` (single rAF reader, 4 px quantised, no scroll listener, once-only guard), `kb-moving` window pausing decorative work (`perf.css`), no `bottom` transition (`core.css`).
**5. Study Mode.** `study-engine.js` parses the answer into heading / definition / formula / paragraph / list and draws plain typography (`projection.css`); no per-step boxes. Only real procedures (3+ numbered steps) reveal progressively; "Show all steps".
**6. Widgets.** `widget-engine.js`, `widgets.css`: Time & date, Weather (Open-Meteo, needs location + network, setup state otherwise), Today's to-dos, Today's study, Up next, Focus. Shapes rounded/pill/circle/blob/leaf, sizes S/M/L, tints, drag, add/remove/restore, persistence, double-tap liquid-glass response.
**7. Tutorial.** 9 new steps with small pictures; first launch once; Replay from Settings → Help & Tutorial.
Version 10.2.0, cache `dabsy-v10.2.0`. Hard refresh / reinstall may be needed to replace the old service-worker cache.

---

# DABSy v10.1.0 — repair: images, Classic default, Banana Milk x Aoi Soda cards

**1. Images not loading — root cause.** The screenshots show broken-image icons for every Magic World picture while all CSS/JS loaded, i.e. the files under `assets/magic/` were not being served. The original v9.1 project had no sub-folders at all (flat repo), and v10 introduced `assets/magic/*.webp`; a flat/drag-drop upload skips folders, so every `./assets/magic/...` URL 404'd. (I could not inspect your live site; this is the cause the evidence fits. The paths themselves are correct relative paths and resolve on a local copy.)
   Fix: the artwork now ships inside a root-level script, `magic-assets.js` (data URIs, 296 KB, loaded only when Magic World is on), with the folder as a second route. Before Magic World is shown, every picture is preloaded and decoded; if any fails, DABSy shows **Classic** with a short message instead of broken icons. The settings preview tile hides a failed image and shows a night gradient. `sw.js` no longer lists the sub-folder images (precache stays non-fatal).
**2. Position — root cause.** Not a layout bug in Classic. Magic World deliberately stands DABSy on the cushion at the bottom of the room picture; with the room image missing, only a dark screen and a creature at the bottom were left. Classic keeps the original centred layout (verified 390x844, 360x640, squeezed 400 px tall, with chat open).
**3. Classic is the default.** `outfit-engine.js`: default form is Classic. Magic World is honoured only if the user chose it (`formChosen`); a stale v10 `magic` value that was never chosen, `furry`, or any invalid value falls back to Classic. Choosing Magic World/Classic in Settings still works and persists. Existing explicit choices are kept.
**4. Banana Milk x Aoi Soda.** New `banana.css`: tokens `--bm-*` / `--aoi*` (milk, cream, cyan borders, ink levels, link, ok, danger). Applied to resource cards and list rows, plan blocks, notification items and settings/hub rows; breaks stay mint, errors keep their red. Text contrast on the milk surface: 13.4 / 8.2 / 6.4 (primary/secondary/tertiary), cyan links 5.2, success 5.2, error 6.0. Dark and ivory page themes are untouched.

Files: `outfit-engine.js`, `world-engine.js`, `settings-engine.js`, `magic.css`, `magic-assets.js` (new), `tools/embed-assets.py` (new), `banana.css` (new), `index.html`, `sw.js`, `dabsy-config.js` (10.1.0).

---

# DABSy v10.0.0 — MAGIC WORLD, calendar intelligence, fast Ghibli sync, real-app launch

**Magic World** (replaces the old fur mode; the original black-screen mode is kept as "Classic black screen")
- The supplied DABSy sprites (body, eyes, bow) live inside the supplied night room. Fur is static. Habitat spots with a HOME, a roaming state machine (calm / lively / off), tap-to-return-home, gesture arbitration (tap eye = chat, hold = tasks, double-tap bow = apps, tap while away = come home first). Day/night control is persisted; **Day is disabled and says why — no day room artwork was supplied, and no CSS filter fakes one.**
- Files: `world-engine.js`, `habitats-data.js`, `magic.css`, `assets/magic/*`; removed `fur-engine.js`, `fur3d-engine.js`; `creature.css` rewritten; `outfit-engine.js`, `settings-engine.js`, `interaction-engine.js` updated.
- Fixed while testing: the click that follows a tap could land on a chat chip that appeared under her (she stands low on screen); small (far-away) DABSy mis-read an eye tap as a bow tap.

**Calendar intelligence** — root causes
- A message only reached the calendar if it had an explicit clock time. "Physics test tomorrow" had none, so it never did; "remind me to … tonight" became a DABSy-only task and never reached Ghibli Calendar.
- Category was guessed only for subjects, otherwise the user was asked; no read-back verification; no duplicate protection; write errors were swallowed.
- New `calendar-intel.js` (offline rules, AI refinement when the Worker is configured), `dabsy-core.js` v2 `saveEvent` (stable ids, duplicate detection, retry, read-back verification). Wired in `app.js`.

**Sync** — root causes (from Ghibli Calendar's real source)
- Ghibli loads storage once, `save()` writes the whole in-memory state, and nothing re-reads storage on visibility/focus; a backgrounded (frozen) tab missed both BroadcastChannel and `storage` events. Result: late appearance, and a later Ghibli save could overwrite DABSy's entry.
- `dabsy-core.js` v2 re-reads on visible / focus / pageshow / online / load, merges by id + updatedAt, keeps deletion tombstones, and Ghibli acknowledges back. **This file must be copied into the Ghibli Calendar repo** (`integrations/ghibli-calendar/dabsy-core.js`) and its service-worker cache version bumped.

**Study Space launch**
- DABSy has no iframe or embedded viewer anywhere. It opened a new tab with `_blank`+`noopener` every time (duplicate tabs). Now a named window per app (re-used), falling back to ordinary top-level navigation if blocked. The black bar is most likely Android Chrome's Custom Tab toolbar, tinted with DABSy's `theme_color`, shown when an installed app opens an out-of-scope URL. Optional `ecosystem.launch.androidBrowserIntent` (off by default, untested on a phone).

**Study Space colours** — `integrations/study-space/cards-colour-patch.css` (for the Study Space repo; measured, not applied there).

Version 10.0.0, service-worker cache `dabsy-v10.0.0`.

---

# DABSy v9.1.0 - real resource discovery + working Study Space hand-off

**Root causes fixed**
- Research always returned "no-search" in `message` AI mode, so DABSy fell back to four fixed search-link cards. Replaced by a provider pipeline (search Worker, Piped, Wikipedia, Internet Archive) with inspection, relevance/fit ranking and honest empty states.
- Study Space never implemented the receiving side and v1 only worked same-origin. Replaced by protocol v2 (URL-hash hand-off + postMessage/BroadcastChannel acks).
- "Understand Newton's laws in 25 minutes" was not recognised as a study goal; parsing now covers understand/explain/grasp, "25-minute", and topic->subject hints.

**Changed**: `research-service.js`, `study-space-bridge.js`, `planner-engine.js` (plans sized to real video lengths), `resource-cards.js` (variable-length recommendation list), `agent-engine.js`, `study-session.js` (send/open buttons, failure + alternatives), `ai-engine.js`, `dabsy-config.js`, `backend/worker.js` + new `backend/search.js`, `cards.css`, `sw.js` (cache v9.1.0).
**Not changed**: character, animations, chat, tasks, reminders, wardrobe, ecosystem links.

# Study Space (dabsy-v2 hand-off)
- New receiver `DS_init` in `app.js`: video -> existing YouTube player, PDF -> existing PDF viewer (fetched direct, or via optional proxy), plan sticky note, acks, de-duplication, error dialogs with "Open original".
- Fixed a pre-existing freeze: showing 4+ toasts at once caused an infinite loop in the toast code.
- `index.html`: optional `resource-proxy` meta. `sw.js`: cache version bumped.
