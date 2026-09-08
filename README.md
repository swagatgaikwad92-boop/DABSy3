# D.A.B.S.y — v2 (Butler build)

A small AI creature that lives on your desk, doubling as a real day-planner.
Home screen is just its eyes on black — nothing else is visible until you
interact with it.

## How to install this update

Every file in this bundle is **flat** — no subfolders — matching how your
repo is currently laid out (GitHub's upload flattened folders the first time
around, so this build embraces that instead of fighting it).

1. Open your repo on github.com.
2. Select **all existing files** and delete them (or just upload these on top —
   same filenames will overwrite; a couple of names changed, see below).
3. Drag every file from this bundle into the repo root — no folders, just the
   flat file list.
4. Commit.
5. Close the app tab completely and reopen your `.github.io` URL — the old
   service worker cached the previous version, so a hard reload matters here.

**Note:** a few files from the previous build (`emotion-engine.js`,
`memory-engine.js`, `face-engine.js`, `ai-engine.js`, `voice-engine.js`,
`study-engine.js`, `projection-engine.js`, `interaction-engine.js`, `app.js`,
`boot.js`, `sw.js`, `manifest.json`, `index.html`) are **replaced** by the
versions in this bundle — same filenames, new content. Two files are brand
new: `schedule-engine.js` and `quickbubbles-engine.js`, plus a new stylesheet
`bubbles.css`.

## v4 — Behavior Director + Attention System

The architecture change from the roadmap discussion: previously, several
engines (`pet-engine.js`, `app.js`, `quickbubbles-engine.js`,
`projection-engine.js`, `utility-engine.js`) each called
`emotion.setState()` / `emotion.flashExpression()` / `bus.emit("dabsy:say")`
directly and independently. Two of those could fire within milliseconds of
each other with no arbitration — whichever ran last silently won. That's
now fixed.

- **`context-engine.js`** (new) — the attention system. Tracks
  `userState` (`INTERACTING` / `STUDYING` / `READING` / `IDLE`) and
  `dabsyState` (`SPEAKING` / `IDLE`), purely by observing existing bus
  events. Exposes `isQuiet()` — true while the user is studying or reading,
  the signal every ambient reaction checks before interrupting.
- **`director-engine.js`** (new) — the Behavior Director. Every reactive
  event (petting, task completed, AI responded, schedule conflict, timer
  finished, idle personality beat, etc.) now goes through
  `window.DABSy.director.dispatch(intent, payload)` instead of engines
  touching the face/voice directly. The Director: runs a real multi-step
  transition (`emotion.transition()`, new helper in `emotion-engine.js`)
  instead of an instant expression swap, checks `context.isQuiet()` before
  letting a suppressible reaction speak, and holds a simple busy-lock so a
  low-priority ambient beat can't collide with something important like an
  AI response or a schedule conflict question.
- Structural UI-mode changes (entering/leaving Study Mode, mic listening
  state) still set emotion state directly, since those aren't reactions —
  they're the mode itself. The Director is specifically for discrete
  reactive events layered on top of whatever mode you're in.

Two files that previously duplicated the same "petting" reaction
(`quickbubbles-engine.js`'s pet bubble, and `pet-engine.js`'s drag-across-
the-face detector) now both dispatch the same `USER_PETTED` intent instead
of each writing their own version.

## What's new in v2/v3 (butler build)



- **Boot**: DABSy starts with eyes closed ("asleep"), opens them, glances
  left/right once, settles, goes happy, then greets you out loud — mentioning
  your next scheduled item if you already have one.
- **Scheduling by voice**: say something like *"I have chemistry revision at
  5:45"* and DABSy adds it to today's schedule. If something's already there,
  it asks — out loud, freshly generated each time — whether to move the
  existing thing, cancel it, or keep both.
- **Recurring tasks**: *"I do yoga every day at 7am"* is remembered and
  reappears on the schedule every day until you say *"stop reminding me about
  yoga."*
- **Study Mode**: DABSy shrinks to the top-right corner, and a small ▲ pointer
  tracks along the words as it reads each step aloud.
- **Double-tap the eyes** → 4 quick bubbles: what's next, quick note, pet
  DABSy, play. Small and fast.
- **Double-tap the bow tie** → the full menu: Schedule / Study / Utility /
  Play / Room / Memory / Settings.
- **Touch** → dragging/tapping the face makes the eyes glance toward you.

## Known limitations (by design, not bugs)

- Reminders only fire while the app is open — this is a static site with no
  server, so it can't wake your phone at 5:45 if the tab is closed. It *will*
  catch you up the moment you reopen it though.
- Schedule conflict handling only actively reschedules **one-off** items; a
  clash with a recurring rule will ask you the same way, but "move" only
  shifts that day's one-off event, not the recurring rule itself (recurring
  rules are meant to repeat at a fixed time every day).
- Tap-to-talk, not always-listening — continuous wake-word detection isn't
  reliable in a browser without a dedicated library, and would drain battery.

## Files

| File | Job |
|---|---|
| `emotion-engine.js` | State machine + mood + event bus + transition() helper |
| `memory-engine.js` | Session/preferences/history/tasks/reminders/settings |
| `schedule-engine.js` | Recurring rules + one-off events + conflict detection |
| `context-engine.js` | Attention system: user/DABSy state, isQuiet() |
| `director-engine.js` | Behavior Director: single arbitration point for every reaction |
| `face-engine.js` | Expressions, blinking, look-at, boot wake-up sequence |
| `interaction-engine.js` | Tap/double-tap/long-press on face and bow tie |
| `voice-engine.js` | Speech recognition + synthesis + word-boundary tracking |
| `vision-engine.js` | Camera/screen capture (on-demand only) |
| `ai-engine.js` | Gemini calls: intent parsing, conflict dialogue, study answers |
| `pet-engine.js` | Continuity: neglect, affection, return-greetings |
| `projection-engine.js` | Full-menu + study-projection open/close choreography |
| `quickbubbles-engine.js` | The 4-bubble quick menu (double-tap eyes) |
| `study-engine.js` | Step-by-step explanations + reading pointer |
| `utility-engine.js` | Timer / tasks / reminders |
| `entertainment-engine.js` | Mini-games |
| `pwa-engine.js` | Service worker registration, install prompt |
| `app.js` | Wires everything together; renders Schedule/Room/Memory/Settings |
| `boot.js` | Runs last — plays the wake-up + greeting |
