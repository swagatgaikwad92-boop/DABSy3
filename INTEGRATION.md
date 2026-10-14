# DABSy ⇄ Study Space integration (protocol v2)

## How it works
1. In DABSy you tap **Start study plan** or **Open in Study Space** on a result.
2. DABSy calls `window.open(StudySpaceURL + "#dabsy=<payload>", "studyspace")` inside that tap. A URL hash works across ANY origin and never reaches a server.
   If Study Space is open in another tab of the SAME origin, DABSy sends over `BroadcastChannel("studyspace-handoff-v2")` instead.
3. Study Space validates the payload, de-duplicates by `requestId`, removes the hash (a refresh never replays it), and opens the real viewer: YouTube video -> its video player, PDF -> its PDF viewer (+ a sticky note with the plan).
4. Study Space answers `received`, then `opened` (only after the viewer loaded) or `failed` (with reason). Channels: `window.opener.postMessage` (works cross-origin), `BroadcastChannel`, `storage` event (same-origin).
5. DABSy shows sending -> sent -> received -> opened, or blocked / failed / unconfirmed, and offers "Try another" / "Open original" on failure.

Payload: `{v:2,type:"studyspace.open",requestId,sessionId,createdAt,expiresAt,replyTo,resource:{id,title,url,type:"video"|"pdf",...},plan:{...}}`.
Ack: `{v:2,type:"studyspace.ack",requestId,stage:"received"|"opened"|"duplicate"|"failed",code?,message?}`.

## What cannot be known
- Popup blocked: DABSy says so and shows an "Open Study Space" button.
- If Study Space opens in a different browser/app context (e.g. an installed PWA window with no `window.opener`) and the origins differ, it can still open the resource but cannot report back. DABSy then shows "unconfirmed" - never "opened".
- Requests older than 30 minutes are rejected.

## Configuration
- `dabsy-config.js` -> `ecosystem.apps[id=study].url` : Study Space address (relative like `../StudySpace/` or absolute `https://you.github.io/study-space/`). Different origins are fine.
- `dabsy-config.js` -> `search.url` : URL of the search Worker (below). Optional but strongly recommended.
- Study Space `index.html` -> `<meta name="resource-proxy" content="https://YOUR-WORKER">` : lets Study Space load PDFs from sites that block direct download. Without it only PDFs that send CORS headers open; others show an "Open original" dialog.
- Dev overrides (browser console on DABSy): `localStorage.dabsy_dev_search`, `localStorage.dabsy_dev_studyspace`. On Study Space: `localStorage.ss_resource_proxy`.

## Deploying the search Worker (free Cloudflare plan, no API key needed)
1. `cd backend && npx wrangler deploy` (new Worker, e.g. name `dabsy-search`; or add to your existing one).
2. In `wrangler.toml` set `ALLOWED_ORIGINS` to BOTH app origins, comma separated (e.g. `https://you.github.io`).
3. Put the Worker URL in `dabsy-config.js` (`search.url`) and Study Space `resource-proxy`.
4. Check `GET <worker>/health` -> `{"search":true,"pdfProxy":true}`.
Routes added: `POST /v1/research` (YouTube + optional PDF discovery, each video checked with YouTube oEmbed, each PDF checked for a real PDF header), `GET /v1/pdf?url=` (https only, <=25 MB, no private hosts, redirects re-validated, must be a real PDF).
Note: YouTube/DuckDuckGo discovery is scraping-style and can break when those sites change; the Worker returns an honest error and DABSy says so.

## After deploying
Both apps use service workers: hard-refresh (or close and reopen the installed app twice) so the new files replace the cached ones. DABSy cache `dabsy-v9.1.0`; Study Space version `1879242102-dabsy2`.
