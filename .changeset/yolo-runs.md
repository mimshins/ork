---
"@krapht/ork": minor
---

`ork run --yolo` and `ork resume --yolo` run with no permission prompts: every
tool a node's deny list doesn't refuse is allowed, on every driver, after a
warning and a y/N (`--yes` agrees without it). Called runs inherit it, a resume
needs it again, and `ork ps`, `ork tree`, the run's first line and `ork ui` show
it while the run is live.
