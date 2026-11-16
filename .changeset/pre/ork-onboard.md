---
"@krapht/ork": minor
---

New `ork onboard`: reads your project (package manager, scripts, test and check
commands, CI, agents and skills), asks three questions about what slows you
down, proposes workflows that fit with the evidence for each, writes the ones
you pick on a branch, and stops at a gate that shows the diff and every new
permission. Ork shows the most it can spend before it starts and never merges.
Run again in a project that has workflows and runs, it reviews what the runs
showed. It uses whichever of Claude Code, OpenCode or Command Code is ready
(`--driver` picks one; `--review` and `--fresh` set the mode). Two built-in
workflows, `ork:onboard-propose` and `ork:onboard-write`, do the paid steps.
