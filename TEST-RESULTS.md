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
