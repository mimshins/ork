---
"@krapht/ork": minor
---

New: `ork migrate` moves an attached project into its repository's `.ork/`, with
its runs, and records it as in-repo. `--agents` also moves the agents and skills
your tools' folders hold (such as `.ai/agents`) into `.ork/` and points those
folders at it. It shows the plan first, moves nothing on a clash or while a run
is live, asks before applying (`--yes`, `--dry-run`), and commits nothing.
`ork migrate --from-agents a,b --reviewer r` drafts a workflow from your agents:
each in its worktree, a gate before the reviewer, a review loop, then a gated
commit on a branch you name, with `git.commit: never`. A readonly node now
follows its input through human gates too.
