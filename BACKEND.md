# DABSy AI backend (the "secure proxy")

DABSy's front end is static files on GitHub Pages. Anything in them can be read by anyone, so **no API key may ever live in the app**. The architecture is:

```
DABSy PWA  ──►  DABSy proxy (Cloudflare Worker)  ──►  AI provider  +  search API
 (no secrets)        (holds the secrets)
```

The app shows **DABSy AI → Ready / Limited mode** and has no key field. Until you deploy this proxy, DABSy runs in *limited mode*: tasks, reminders, planning, the session timer, wardrobe, notifications and the Study Space hand-off all work; free chat, explanations and live web research do not (and say so).

> **Cost honesty.** This is not free unlimited AI. Every request is billed to whoever owns the provider key. The Worker rate-limits per IP (12/min, 150/day by default, edit `LIMITS`) and only accepts calls from your origin, but you remain responsible for the budget. Set a spend cap in your provider's dashboard.

## Deploy (about 10 minutes)

1. Install Node 18+, then `cd backend && npx wrangler login`.
2. Edit `wrangler.toml`: set `ALLOWED_ORIGINS` to your Pages origin, e.g. `https://yourname.github.io` (origin only, no path, no trailing slash).
3. Add secrets (they are stored by Cloudflare, never in git):
   ```
   npx wrangler secret put ANTHROPIC_API_KEY     # or GEMINI_API_KEY
   npx wrangler secret put BRAVE_API_KEY         # optional but needed for real web research
   ```
4. `npx wrangler deploy`. Note the URL it prints, e.g. `https://dabsy-ai.you.workers.dev`.
5. Put that URL in `dabsy-config.js` → `ai.proxyUrl`, commit, push. (Or, for testing, open Settings → About, tap the version 7 times and paste it. That override is stored on that one device only.)
6. Open DABSy → Settings: *DABSy AI* should say **Ready**.

## API contract

| Endpoint | Request | Response |
|---|---|---|
| `GET /health` | – | `{ok, ai, search}` |
| `POST /v1/generate` | `{task, system?, prompt, json?, image?}` | `{ok, text}` or `{ok:false, error}` |
| `POST /v1/research` | `{query, subject?, level?, maxResults?}` | `{ok, results:[{title,url,source,description,type,durationMin,relevance}]}` |

Errors: `rate-limited` (HTTP 429 with `retryAfter`), `origin-not-allowed` (403), `no-search`, `bad-size`, `provider-NNN`.

## How research stays honest

`/v1/research` calls a real search API (Brave Search) and returns **only URLs that search returned**. The model may rank and describe those items, never add one. If `BRAVE_API_KEY` is missing the endpoint answers `no-search`, and DABSy shows labelled *Search link* cards instead of pretending it searched.

Swap providers by editing `callModel()` / `brave()` in `worker.js`. The front end never knows which provider is behind it.

## Other hosts

The Worker is plain `fetch`-style code. For Vercel/Netlify/Deno Deploy, keep the same three routes, CORS rule and secrets-in-environment approach.

## Using the single-message `dabsy-brain` Worker (current setup)

`dabsy-config.js` has `ai.mode: "message"`. The app then POSTs `{ "message": "..." }` to `ai.proxyUrl` and reads `reply`. Research and image input are not available in this mode, and no conversation history is sent. Put only the public Worker URL in `ai.proxyUrl`. For CORS, the Worker must answer with `Access-Control-Allow-Origin: https://YOUR-USERNAME.github.io` (origin only, no path) and handle `OPTIONS` preflight with `Access-Control-Allow-Headers: Content-Type`. Add rate limiting before public release.
