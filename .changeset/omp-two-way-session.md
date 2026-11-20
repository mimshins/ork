---
"@krapht/ork": minor
---

Run `omp` as one long-lived `omp --mode rpc` process for each stretch, which Ork
talks to in both directions. A message to an `omp` node (`ork chat`, `ork send`)
now reaches the model before the turn ends instead of waiting for the stretch to
end, a stop sends an abort, and a permission question from `omp` comes to you in
`ork decide` (Ork never answers "approve for this session"). The session ends
when `omp` says it has settled. A paused node's call now waits 9 minutes; past
that Ork ends the stretch, and `ork continue` resumes the session with a message
asking the model to make the held call again, so a long pause costs one resume
instead of one model request each hour. A message that `omp` splits into chunks
above its frame limit ends the stretch with a line saying so. `omp` is still
built and not yet proven, so `ork validate` and `ork run` still refuse it.
