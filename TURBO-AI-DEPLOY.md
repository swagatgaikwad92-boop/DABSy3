# DABSy v10.3 — Turbo AI: what was wrong, what changed, how to deploy (from your phone)

## 1. What I actually found (from the code, not guesses)
| Question | Finding |
|---|---|
| Which Worker is the app calling? | `dabsy-config.js` → `https://dabsy-brain.swagatdemo9292.workers.dev`, mode `"message"` (POST `{message}` → `{reply}`). **The source of that deployed `dabsy-brain` Worker is NOT in the project.** `backend/worker.js` is a different Worker (`dabsy-ai`). I did not guess what `dabsy-brain` does. |
| Model / endpoint / thinking? | Unknown for the deployed `dabsy-brain` (its code is missing). The old `backend/worker.js` defaulted to `gemini-2.0-flash`, which **Google shut down on 1 June 2026**, and sent no thinking settings (Gemini 2.5/3 "think" by default, which is the classic cause of 15–30 s answers). |
| Does one message make several AI calls? | **Yes, found and fixed.** `calendar-intel.js` called the AI for *every* message the rules didn't recognise, then `parseIntent` called it again for the reply: two sequential requests per ordinary chat message. Now the calendar AI step only runs when the text has a scheduling cue (a time, a day, "exam", "due"…). Measured: 2 browser requests → 1 per chat message. |
| Excess history? | The intent prompt used 6 messages untrimmed. Now: at most 4 messages, 220 characters each, about 900 characters in all. A 7-message test stays flat at about 1.8 KB per request. |
| Duplicate requests? | The app already blocked double sends (`utteranceBusy`). Added: identical in-flight AI requests are shared. Test: double Enter → 1 request, 1 task. |
| Retries / timeouts? | The app had no retries (good) and a 25 s timeout. The new Worker makes at most **one** retry, only for transient errors, with jitter and `Retry-After`. The app adds none (so retries can't multiply). |
| Who says "I'm a bit overloaded"? | **The app (frontend), not the Worker.** `ai-engine.js` showed it for *every* HTTP 429 (a used-up daily quota, a per-minute cap, or the Worker's own limit alike), and a generic message for every 5xx. Now each failure shows what really happened (quota / rate limit with seconds to wait / server hiccup / timeout / bad request / setup problem / offline). |
| Streaming? | Not supported anywhere before. Now: real streaming from Gemini (`streamGenerateContent?alt=sse`) through the Worker to the chat subtitle and Study Mode, no fake typewriter. |

## 2. Models (checked against Google's deprecations page, updated 2026-10-12)
Chat/intent/categorisation: `gemini-3.5-flash-lite`, thinking `minimal`. Study explanations/doubts: `gemini-3.8-flash`, thinking `low`. One capacity fallback: `gemini-3.6-flash`. Change them in **one place**: the `CONFIG` block at the top of `backend/dabsy-brain.js`, or via Worker variables (below). I could not test against the real Google API (no internet/key here), so see "Not verified".

## 3. IMPORTANT before you replace anything
`backend/dabsy-brain.js` is a **new** Worker I wrote to the contract your app uses. It does **not** include anything else your current `dabsy-brain` might do (notifications, search, etc.). Before pasting:
1. Cloudflare dashboard → **Workers & Pages → dabsy-brain → Edit code**. **Select all, copy, and save the old code** in Notes. Also send it to me if you want me to merge improvements into it instead.
2. If the old code does more than AI chat, tell me before replacing it.

## 4. Deploy the Worker (phone, dashboard)
1. dashboard.cloudflare.com → **Workers & Pages → dabsy-brain → Edit code**.
2. Delete everything, paste all of `backend/dabsy-brain.js`, tap **Deploy**.
3. **Settings → Variables and Secrets**: your Gemini key must exist as a **Secret** named `GEMINI_API_KEY` (the code also accepts `GOOGLE_API_KEY`, `GEMINI_KEY`, `API_KEY`). If your secret has a different name, rename it or add `GEMINI_API_KEY`.
4. Add a plain-text variable `ALLOWED_ORIGINS` = the address of your DABSy site (for example `https://swagatgaikwad92-boop.github.io`). If you skip it, only that address is allowed.
5. Optional variables: `AI_MODEL_FAST`, `AI_MODEL_SMART`, `THINK_SMART` (`low|medium|high`), `RATE_PER_MIN`, `RATE_PER_DAY`.
6. Open `https://dabsy-brain.swagatdemo9292.workers.dev/health` in your phone browser. You should see `"ok":true,"ai":true,"stream":true` and the two model names. `"ai":false` means the secret name is wrong.

## 5. Deploy the app
Upload the project (zip contents) to GitHub as before, wait a minute, open DABSy, **hard refresh / close and reopen the installed PWA twice** so the new service worker (`dabsy-v10.3.0`) replaces the old one. Nothing needs changing in `dabsy-config.js`. The app detects whether the Worker streams, and quietly falls back to normal answers if it doesn't (so the app works even before you update the Worker).

## 6. Rate limits and costs
Free, no new provider. The Worker's own limits are 30/min and 600/day per phone (counted per Worker instance unless you bind a KV namespace called `RATE`). Cloudflare Workers free plan: streaming a response does not use CPU while waiting for Gemini; each request is one invocation (100,000/day free). I did not load-test these limits.

## 7. Before/after (SIMULATED, see honesty note)
Same scripted "Gemini" (first token 0.9 s, 14-character chunks every 0.22 s), real app + real Worker code, Chromium:
| | first text on screen | complete |
|---|---|---|
| Old behaviour (non-streaming) | 3.35 s | 3.35 s |
| Streaming | 0.96–0.99 s | 2.7 s |
Plus: 1 AI request per chat message instead of 2. Your real 15–30 s will depend on the model/thinking the *old* Worker used, which I could not see or measure.

## 8. Not verified
Real Gemini calls and current rate behaviour, Android keyboard feel on a physical phone (keyboard tested by emulation only), Cloudflare limits under load, the deployed `dabsy-brain`'s actual behaviour. The Worker's model names and `thinkingLevel` field come from Google's docs and third-party mirrors; if Google rejects a name the Worker returns `model-unavailable` and the app says "needs attention on the server side". Send me that message and I'll adjust.

## 9. Manual steps for you
Confirm the secret name; set `ALLOWED_ORIGINS`; save old Worker code first; paste and deploy; open `/health`; hard-refresh the app.
