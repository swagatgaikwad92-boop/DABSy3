# v10 test results (honest) — Playwright + Chromium, 390x844 touch, local server, no internet

Scripts are in `tests/`. "Stand-in" = `tests/ghibli-standin.html`, a page that loads the real `dabsy-core.js` and mimics Ghibli's `state.js` (load once, whole-state save, no listeners) as read from the repo. The REAL deployed Ghibli / Study Space were never loaded.

| # | Test | Result |
|---|---|---|
| 1 | "I have a physics test tomorrow." -> Physics test, category `important`, local date tomorrow, saved + read back | PASS |
| 2 | "Remind me to finish maths homework tonight." -> homework, today, no invented time | PASS |
| 3 | Create while the stand-in Ghibli page is open -> it updates without reload, DABSy reports "showing now" only after its ack | PASS (stand-in only) |
| 4 | Open Ghibli page afterwards -> contains every entry | PASS (stand-in only) |
| 5 | Study Space launch: no iframe in DOM; named top-level window to the real URL; second tap re-uses it | PASS (window.open spied). Black bar itself: NOT TESTED (needs Android installed PWA) |
| 6 | Card colours: before/after measured (saturation 0.06-0.23 -> 0.19-0.52, text contrast stays >= 9.2:1) | PARTIAL — rendered from the repo's real CSS rules in a mock; patch NOT applied to or viewed in the live app |
| 7 | Same sentence twice / `saveEvent` retry -> no duplicate | PASS |
| 8 | Storage write failure -> honest "couldn't save", nothing stored; recovers after | PASS |
| + | Frozen tab (CDP lifecycle freeze) -> resumed stand-in shows the entry; Ghibli's own save keeps DABSy entries; delete in DABSy removes it in an open Ghibli | PASS (stand-in only) |
| + | Magic World gestures, roaming, tap-to-return, day/night honesty, resize/landscape (`tests/t2.py`) | PASS except console errors = sandbox offline network |

**NOT TESTED:** real AI Worker classification (offline), real Ghibli/Study Space pages, Android Chrome / installed PWA, `androidBrowserIntent`, battery/perf profiling, reduced-motion and hidden-tab roaming pause on a device, accessories placement on the new body, light theme with Magic World, Study Mode multilingual formatting, live talk, notifications.

# Test results (honest)

Run with Chromium (Playwright), 390x844 touch viewport, DABSy on :8081 and Study Space on :8082 (two different origins), mock search/AI/PDF servers, and a STUB YouTube player. The sandbox had no internet.

| Area | Result |
|---|---|
| Newton's laws / 25 min: parse, results, ranking, plan, Start Study -> Study Space (other origin) opens video, ack "opened" back to DABSy, hash removed, refresh safe, duplicate request, invalid/expired/js: payloads | 16/16 pass |
| Blocked embed -> failure + error panel + alternatives; PDF direct; PDF blocked (no proxy) dialog; PDF via proxy; non-PDF link rejected | 8/8 pass |
| Other topics (photosynthesis 15 min, derivatives 1 h), plans sum to time; empty results; search down; AI down (results still shown, noted) | pass |
| Popup blocked -> tap-to-open; no ack -> "unconfirmed" | 2/2 pass |
| Same-origin open tab via BroadcastChannel; direct launch; garbage hash; reminder parsing still works | pass |
| Core modules (tasks, memory, emotion, outfits, ecosystem, notify) still load | pass (planner/learning/research/cards are lazy modules loaded on first study request, which the tests exercised) |

**NOT tested (needs your deployment):** real YouTube/Piped/Wikipedia/Internet Archive/DuckDuckGo responses (their JSON/HTML shapes are my assumptions), the Cloudflare Worker routes (syntax-checked only), real YouTube playback/embedding, real GitHub Pages origins, iOS Safari popup behaviour, installed-PWA window behaviour.
