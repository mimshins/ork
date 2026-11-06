---
"@krapht/ork": minor
---

`ork decide --id <d> --choose <option>` takes `--note <text>` and
`--rating good|bad`, and notes how the decision's node went, as the run's
feedback. The `ork ui` server takes the same note at `POST /api/runs/:id/notes`.
