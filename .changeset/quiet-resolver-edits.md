---
"@krapht/ork": patch
---

The conflict resolver in the `issues` workflow (`ork init --issues`) and in
`examples/resolve-conflict.ork.yaml` edits without asking: `Edit` and `Write`
are now in its `tools.allow`, not only in `tools.only`, so a conflict no longer
stops the run on a permission prompt per file. Its `stage` step still refuses an
edit outside the conflicted files.
