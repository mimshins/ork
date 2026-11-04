---
"@krapht/ork": minor
---

Limits across runs. `quotas` with `dayUsd`, `weekUsd` and `monthUsd`, in
`~/.ork/settings.yaml` for all your projects and `.ork/project.yaml` for one,
caps what runs spend together. At a cap, or when your Claude plan refuses a
session, a run starts nothing new and ends `quota_exhausted`, and `ork resume`
goes on. `ork usage` and the Usage panel show each cap and when it resets.
