---
"@krapht/ork": patch
---

The omp driver offers Ork's tools as host tools over the session's own pipe
instead of a private plugin, so no plugin folder or tool-server token is written
for it. `ork run` refuses a node whose exact `omp.<provider>/<model>` is not in
`omp models --json`, before anything is spent. A resumed omp session now tells
the model the real reason its call did not run: a pause, or a `heavy` slot that
was not free.
