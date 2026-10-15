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
