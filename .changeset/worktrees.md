---
"@krapht/ork": minor
---

Each writing node now runs in its own git worktree, beside the clone in
`../<clone>-worktrees/` on an `ork/<run>/<node>` branch, with your
`CLAUDE.local.md`, `.claude/settings.local.json` and `.worktreeinclude` files
copied in. Reviewers work in their owner's worktree, a passing child is merged
into its owner's branch, and the run keeps its result's worktree for you. A run
refuses to start while instructions or skills have uncommitted changes
(`--allow-dirty` to override). New: `ork worktrees` lists Ork's worktrees and
branches, and `ork worktrees clean` removes them safely. `ork init` no longer
adds `.ork/worktrees/` to `.gitignore`.
