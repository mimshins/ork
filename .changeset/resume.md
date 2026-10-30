---
"@krapht/ork": minor
---

New: `ork resume <run>` continues a run that was stopped, failed, ran out of
budget or crashed, under the same id. Nodes that finished keep their results and
do not run again; the node that failed or was cut off runs again, with
everything it feeds. The run keeps its inputs and flags (`--input`, `--driver`
and `--in-place` change them), adopts the worktrees it left, and reuses your
answers to its loop questions. Runs now record their inputs and flags so they
can be resumed.
