# DABSy v9.0 — changes since v8.4

**New files**
- `viewport-engine.js` — keyboard-aware layout (chat bar and sheets lift above the on-screen keyboard)
- `soda.css` — Banana Milk × Aoi Soda design tokens (light + dark), type, spacing, accessibility rules
- `stickers.js` — six original inline-SVG stickers
- `briefing-engine.js` — optional once-a-day briefing + study log
- `live-talk.js` — hands-free listen → think → speak loop
- `push-engine.js`, `backend/push.js`, `backend/gen-vapid.mjs` — optional Web Push for closed-app reminders (see backend/BACKEND.md)

**Changed**
- Study Mode: adaptive answer format instead of forced numbered steps; replies in the user's language
- Language setting (Settings → Accessibility): auto / English / Hindi / Marathi for replies, listening and speaking
- Touch: no keyboard flash on double-tap; petting no longer closes chat; keyboard stays up after sending
- Bow tie opens "today at a glance"; visible "Today" shortcut
- Pet: day-based streak; idle behaviour pauses when hidden or in live talk; quiet reaction on session start/finish
- Easter eggs: removed accidental shake trigger; added soda-fizz celebration and a sticker book
- Accessibility: focus rings, language tags, contrast/transparency media queries, 44 px targets
- Service worker cache version: dabsy-v9.0.1

**Setup**
- AI proxy: `ai.proxyUrl` in `dabsy-config.js` (already set to your dabsy-brain worker)
- Web Push is off until you deploy `backend/` and set `push.url`
