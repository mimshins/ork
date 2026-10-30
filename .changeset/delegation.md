---
"@krapht/ork": minor
---

Leaders can now hand work to the nodes they own. A `claude.leader` in a run gets
`delegate`, which runs its declared children in parallel and returns their
reports, and `spawn_worker`, which starts more instances of a child worker up to
the leader's `maxWorkers`. Ork commits the leader's work first, gives each child
its own worktree branched from it, and merges each passing child back before the
call returns. A waiting leader lends its session slot to its children, so
`limits.concurrency: 1` cannot deadlock. A leader that a loop sends work back to
now resumes its session instead of starting over. With the CLI driver, Ork's
tool server allows calls of up to 24 hours, so long delegations are not cut off
at 60 seconds.
