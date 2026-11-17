---
"@krapht/ork": patch
---

`ork validate ork:security-audit` and `ork context explain` work in a project
attached with `ork register`, with no false `ref.context ... does not exist`
errors. A node whose session throws after `ork stop` now reads "was stopped",
not "ended for a reason Ork doesn't recognize". The audit scanner lists an
unpinned action once, however many jobs use it, and the audit report no longer
says whether the run is complete (its Run section does). `ork onboard` tells the
writer about every uncommitted file under `.ork/` and `.gitignore` that its
worktree lacks, not only the ones `ork init` just made.
