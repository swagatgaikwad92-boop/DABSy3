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
