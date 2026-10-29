# DABSy V3

A small, fluffy digital companion: streamed chat, an AI butler that edits your real task list, a study mode that
changes how DABSy teaches, and a set of liquid-glass widgets — mobile-first, installable as a PWA.

* Audit & architecture: [`docs/AUDIT.md`](docs/AUDIT.md)

## Run it

```bash
npm install          # esbuild + eslint (dev only)
npm run dev          # builds and serves http://localhost:5173 (rebuilds on change)
npm run check        # lint + unit tests + production build + end-to-end tests
```

The app works without a backend (widgets, tasks, calendar, focus timer, study progress). **Chat needs the backend.**

## Backend (AI) in 5 minutes — Cloudflare Worker

The browser never holds an API key. A tiny Worker does.

```bash
cd worker
# edit wrangler.toml: ALLOWED_ORIGINS = "https://<you>.github.io"  (and MODEL if you like)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Then either put the Worker URL in `public/config.json` (`{"apiUrl": "https://dabsy-api.<you>.workers.dev"}`) before
deploying, or paste it into **Settings → AI connection** on the device (stored locally; has a *Save & test* button).
Add a Cloudflare rate-limiting rule on the Worker route to cap abuse.

## Deploy the frontend (GitHub Pages)

Push to `main`; `.github/workflows/deploy.yml` lints, tests, builds and publishes `dist/`. Optionally set a repository
*variable* `DABSY_API_URL` to bake in the Worker address. All asset URLs are relative, so project sub-paths work.

## What's in it

* **Home**: DABSy floats above your widgets; tap her or the composer and she flies up to the top-middle of a frosted
  conversation card (and flies back on close / Android Back).
* **Character states**: idle, listening, thinking, answering, happy, confused, flying, returning home.
* **Chat**: real streaming (no fake typing), Stop, retry, auto-retry on dropped connections, adaptive Markdown
  (lists, tables, code with copy), follow-up chips, context trimming, answer style (Concise / Balanced / Detailed).
* **Butler**: create / complete / rename / re-prioritise / move / delete tasks, add calendar events, start focus
  sessions, and **plan a day** (reviewed and confirmed before anything is saved; reuses existing tasks).
* **Study mode**: different tutoring prompt (idea → example → check), interactive quizzes whose results feed real
  progress (accuracy, streak, focus minutes), focus timer that survives reloads.
* **Widgets**: clock/date, weather (Open-Meteo), quick actions, tasks, calendar, study progress. Show/hide, reorder,
  resize, per-widget options; persisted.
* **Scenes**: 4 wallpapers × day/night; auto by time, or choose; Study mode switches to the study room.

## Not included (honest list)

* Native Android home-screen widgets (a separate native feature). Widgets live inside the app.
* Calendar sync (events are stored on the device only). Task/event data is local — no accounts or cross-device sync.
* Drag-and-drop widget reordering (up/down buttons instead — more reliable on touch).
* Custom web fonts (could not be fetched in the build environment; a system serif/sans stack is used).
* Verified in headless Chromium at phone sizes with a scripted backend. **Not yet run against a real model, on a
  physical Android device, with a real on-screen keyboard, or the live weather API** (mocked in tests).

## Tests

`tests/unit` (40, Node): Markdown, SSE + client retry/abort/timeout, context trimming, tasks & tools, worker.
`tests/e2e` (25, Playwright): see `tests/e2e/run.mjs`. The mock backend in that folder is a test fixture only.
