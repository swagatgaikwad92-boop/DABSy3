# Integrations

Drop these into the *other* apps' repos. They only work when the apps share an origin
(all published under the same `https://you.github.io`). Different origins or different devices need a backend.

| File | Goes into | What it does |
|---|---|---|
| `studyspace-adapter.js` | Study Space | Receives sessions DABSy prepared, acknowledges them, reports progress back |
| `solvecount-adapter.js` | SolveCount | Publishes a counts-only summary for DABSy's SolveCount bubble |

Ghibli Calendar already shares `DABSyCore` (`dabsy-core.js`), which DABSy uses directly once you switch the connection on.

| `ghibli-calendar/dabsy-core.js` | Ghibli Calendar (replace its copy, bump its sw.js cache) | v2 sync: re-read on visible/focus/pageshow, tombstones, ack back to DABSy |
| `study-space/cards-colour-patch.css` | Study Space (append to style.css) | Lively, readable note colours; softer dimmed state |
