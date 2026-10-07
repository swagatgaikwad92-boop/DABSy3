# D.A.B.S.y — creature-first upgrade

This bundle upgrades the existing DABSy v2/v6 architecture instead of replacing it.

## What was preserved

The existing emotion state machine, Behavior Director, context/quiet system, face/eye engine, petting, voice, Study Block, study projection, scheduling, shared Ghibli Calendar core, memory, PWA shell, entertainment, and vision capture remain in place.

## What changed

- DABSy now has a CSS-rendered creature shell around the existing expressive eyes.
- Double-tap opens a creature-first ecosystem hub instead of the old quick-bubble menu.
- Ecosystem entries are explicit and honest about connection state.
- Long-press opens the existing assistant input and is now treated as command mode.
- Added a study-agent abstraction for goal -> plan -> session.
- Added a research-service abstraction. The frontend never claims it browsed unless the backend returns real resources.
- Added an attractive agent plan sheet.
- Added contextual in-app notification storage plus real browser Notification API support when permission is granted.
- Added just-in-time notification permission controls.
- Added one-time tutorial persistence with Settings -> Replay.
- Added data-driven wardrobe/outfit state.
- Removed the normal-user Gemini API-key input completely.
- Added `ai-provider.js`, which sends LLM requests only to a secure backend endpoint.
- Added an AI connection status in Settings.
- Expanded the service-worker shell for the new modules.
- Added reduced-motion-friendly ecosystem/tutorial UI.

## AI/backend contract

A public GitHub Pages site cannot safely contain a private model-provider key. The frontend therefore calls:

`POST /api/ai`

or the endpoint supplied by `window.DABSY_AI_ENDPOINT` / Settings.

Request:

```json
{
  "messages": [
    {"role":"system","content":"..."},
    {"role":"user","content":"..."}
  ],
  "imageBase64": null,
  "responseFormat": "json"
}
```

Expected response:

```json
{
  "text": "model output"
}
```

The backend owns the provider SDK/key. Do not put that key in the GitHub repository.

The same endpoint can later implement:
- LLM chat
- structured intent parsing
- study planning
- web research
- resource ranking
- vision requests

## Cross-app ecosystem

DABSy can use same-origin communication through the existing `dabsy-core.js` approach when apps are hosted under the same GitHub Pages origin. Ghibli Calendar is wired to the existing relative route from the project.

Study Space and SolveCount are deliberately shown as ecosystem destinations without pretending they are installed. The current ecosystem destinations are wired to the supplied live URLs for Study Space, Ghibli Calendar, and SolveCount. They open as real destinations rather than simulated in-app panels.

A future shared contract can pass:

```js
{
  resources: [],
  plan: [],
  sessionId: "...",
  tasks: []
}
```

through `BroadcastChannel`, localStorage/storage events, or a backend.

## Native Android boundary

A GitHub Pages PWA cannot create a system-wide floating overlay above other Android apps. The code does not fake one.

A future Android wrapper can expose a native bridge such as:

```js
window.DABSyNative?.showOverlay()
window.DABSyNative?.hideOverlay()
window.DABSyNative?.scheduleExactNotification(...)
```

The web app can feature-detect that bridge later.

## Notifications

The in-app notification centre works locally.

Native/browser notifications use the real Notification API. They are requested only when the user chooses to enable them.

A normal PWA cannot guarantee native Android delivery while completely closed on every device. A native wrapper/backend is the correct future boundary for reliable scheduled delivery.

## Deploy to GitHub Pages

1. Upload the files in this bundle to the existing DABSy repository.
2. Commit the new files.
3. In GitHub Pages, keep the existing Pages source.
4. Open the deployed URL.
5. Close any previously installed DABSy tab/PWA.
6. Reopen it so service-worker v7 can install.
7. If an old cached shell persists, unregister the site's service worker in browser site settings and reopen once.

## Real vs infrastructure-dependent

### Functional in this bundle
- Creature-first visual shell
- Existing expressive eye system
- Idle/breathing/blinking behavior
- Existing petting/touch reactions
- Double-tap ecosystem hub
- Long-press assistant reveal
- One-time tutorial + replay
- Data-driven outfit state
- In-app notification centre
- Browser notification permission request
- Local scheduling/memory
- Existing Ghibli Calendar shared-origin integration
- AI provider abstraction
- Study-agent abstraction
- Study session persistence

### Requires a backend
- Real LLM responses without user API keys
- Real web research
- Server-backed resource discovery
- Cloud sync
- Reliable closed-app scheduled notifications

### Requires native Android
- System-wide floating DABSy bubble
- Overlay above other apps
- Deep system integration beyond browser permissions
- Reliable background scheduling independent of browser lifecycle

## Important limitation

The ZIP cannot magically contain a secure AI backend because GitHub Pages is static hosting. This build therefore removes the unsafe API-key UX and provides the correct interface boundary rather than hiding a secret in JavaScript.


## Multilingual voice and Live Talk

- DABSy supports device/browser speech synthesis voices and configurable recognition languages including English (India), Hindi, Marathi, Gujarati, Tamil, Telugu, Kannada, and Bengali where the device exposes them.
- `Auto` follows the device language.
- Live Talk uses the browser SpeechRecognition API plus speech synthesis. It is a real microphone conversation loop, but browser/device support and available voices vary.
- Microphone permission is requested by the browser when Live Talk is started.
- Live Talk does not provide server-side voice intelligence; the spoken content still comes from DABSy's AI/local response pipeline.
