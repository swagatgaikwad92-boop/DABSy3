# DABSy v11.0.0 — conversation quality, butler, reply card, safer errors

- AI: plain chat takes a fast path (short 1-3 sentence replies; "Explain more" asks the model again, never truncates; Study Mode allows long answers). Language follows the latest message (English / Hindi / Marathi / Hinglish), an explicit request wins, one language per reply. Complex requests (30+ words) show an editable "What I understood" with Use / Edit / Change. Provider failures (timeout, bad reply, "Gemini request failed" arriving as a 200 reply) are detected, retried once quietly, then shown as a friendly line with Retry. Nothing is invented.
- Reply card: text plus optional buttons / choice chips. Chips appear only when they save effort (confirmations, real ambiguity). Typing always works and continues the same conversation. Replies stay visible above the keyboard instead of hiding.
- Butler (butler.js): complete, prioritise, rename, move and delete tasks (and Ghibli events when connected) by plain language; "plan my day" overview with overlap/overload warnings. Delete ALWAYS asks first. Every change is read back before DABSy says "done". Undo for reversible edits.
- Backend (optional): 20 s provider timeout, error mapping (timeout/empty-reply), per-request token cap, .dev.vars.example.
- Files: butler.js, v11.css (new); ai-engine.js, app.js, calendar-intel.js, index.html, sw.js, dabsy-config.js (11.0.0), backend/worker.js.

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

## 11.1.0
Keyboard-lag fix, real day planner + butler actions (dayplan-engine.js), 5 wallpapers with day/night, clock-based auto light/theme, floating widgets with customisation, butler persona. See V11.1_REPORT.md.
