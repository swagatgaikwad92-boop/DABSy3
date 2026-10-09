# Ecosystem integration: what is real and what isn't

DABSy is the hub. Study Space, Ghibli Calendar and SolveCount are separate PWAs.

## What works today (same origin, e.g. all on `you.github.io`)
- **Shared storage + BroadcastChannel.** GitHub Pages serves every repo of one account from the same origin, so apps can share `localStorage` and a `BroadcastChannel("dabsy-ecosystem")`.
- **Study Space hand-off.** DABSy writes a prepared session (plan, chosen resources, timer structure, related tasks) to `studyspace_inbox_v1`. `integrations/studyspace-adapter.js` in Study Space reads it, writes `studyspace_ack_v1`, and may write `studyspace_progress_v1`. DABSy only says **Opened** after the ack. Until then it says **Waiting**.
- **Ghibli Calendar.** Uses the existing `DABSyCore` (switched on under Settings → Connections). DABSy reads events when finding free time and writes only at the permission level you chose.
- **SolveCount.** Counts-only summary through `solvecount-adapter.js`.
- **Reachability dots** on the bubbles come from a real fetch of each app's `manifest.json`.

## What doesn't (and why)
- **Different origins** (custom domain on one app, another GitHub account) can't share storage. Needs a small backend (the Worker in `backend/` can host a `/handoff` route) or deep links with a payload in the URL hash.
- **Different devices.** Same reason. Needs sync through a server.
- **Study Space's side.** DABSy can only deliver the session; Study Space needs the adapter and an `onSession` handler to turn it into its own session object. I haven't seen its code, so that part is a documented hook, not wired.

## Adding another app
```js
DABSy.ecosystem.register({ id: "flashcards", name: "Flashcards", url: "../Flashcards/", icon: "book",
  hub(app){ /* optional custom sheet; default shows reachability + an Open button */ } });
```
