---
"@krapht/ork": patch
---

A new `issues` workflow works GitHub issues in parallel, in `examples/` and
offered by `ork init --issues` (or asked once on a terminal).
`ork run issues --input label=ready` (or `--input issues=12,15,18`) labels each
issue `in-progress`, builds each in its own worktree, reviews each, integrates
the ones that pass one at a time into the branch you name under its lock (an
agent resolves a rebase conflict, and you are asked only when its resolution
changes what a reviewed change does), runs your check after each, pushes, and
opens or updates one pull request that closes them. An issue that failed is left
out, unlabelled and named in the run's summary; a second run naming the same
branch adds to the same pull request.
