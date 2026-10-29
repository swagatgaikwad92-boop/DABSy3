# DABSy V3 — audit & architecture

## What the audit could and could not cover

The brief names a **DABSy v11.2 frontend ZIP** as the starting point. That ZIP was **not in the upload** — the only archive
supplied was `gemini-watermark-removed-8-images.zip` (eight wallpapers), plus the character images (body, eyes, bow bow-tie,
composite). So there was no v11.2 code, widgets, AI integration or task system to classify feature-by-feature. Rather than
guess at code I could not see, V3 is built fresh to the brief, using the supplied art. If you send the v11.2 ZIP, a real
KEEP / IMPROVE / REBUILD / REMOVE pass over it is the natural next step (see "Open items" in the README).

## Audit of what was supplied

| Item | Verdict | Notes |
|---|---|---|
| Character layers (body, eyes, bow) | **KEEP** | Cleanly separable, so expressions are possible without redrawing: eyes blink/gaze/squint, bow flutters, body squashes. Eyes were cut from a black JPG into alpha PNG → WebP (`scripts/prepare-assets.py`). |
| Body colour | **FLAG** | Supplied body is warm grey-brown, not the "midnight blue / black-purple" in the brief. Kept as supplied (it is the art you provided); the UI palette carries the midnight/lavender identity around it. Easy to recolour later with a hue shift or re-render. |
| Wallpapers (4 scenes × day/night) | **KEEP** | Re-encoded to WebP (~470 KB total). Seven of eight are only 572×1024 — soft on 3× phones; higher-res exports would sharpen them. |
| Everything else (UI, AI, tasks, widgets, study) | **REBUILD** | Nothing to port; designed against the brief. |

## Architecture (simplest thing that supports the vision)

Vanilla ES modules, bundled by esbuild (≈100 KB JS / 33 KB CSS minified). No framework: the UI is a handful of
long-lived components and streaming text, which plain DOM handles without a virtual-DOM layer.

```
src/
  core/       storage (versioned slices), state, dom helpers, dates, back-button navigation
  character/  Dabsy: layered parts + state machine + flight (Web Animations, transform-only)
  scenes/     wallpaper crossfade, time-of-day / study-mode selection
  chat/       conversation controller (tool loop), chat view, composer, markdown, cards
  ai/         SSE client (cancel/timeout/retry), prompts, context trimming
  butler/     tasks, events, tool schemas + executors (the only place that mutates data for the AI)
  study/      progress, focus sessions, quiz validation
  widgets/    registry (layout model), definitions, board, weather service
  ui/         sheets, controls, icons
worker/       Cloudflare Worker: key-holding streaming proxy + provider adapter
```

Boundaries that matter:

* **Character ↔ conversation** never touch: the conversation emits *phases*; `main.js` maps phases to character
  states. The character reacts the instant you send, independent of the network.
* **AI provider** is replaceable: the browser speaks a 4-event protocol (`text`, `tool`, `done`, `error`);
  `worker/providers/anthropic.js` is the only provider-specific code.
* **The API key never reaches the browser** — it is a Worker secret.
* **Butler honesty**: tool executors validate, mutate the real store, and return what happened; the model only hears
  "ok" if the store changed. Deletes and day plans require an explicit in-app confirmation.

## Removed on purpose (vs. a typical chatbot/dashboard build)

No nav bar, no chat history list, no always-visible mode switches, no decorative cards, no fake data. The home screen is
the character, one status line, the widgets, and the composer.
