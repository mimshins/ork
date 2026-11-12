# Limits found building the `issues` workflow

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building the `issues` example
([RFC-016](../../rfcs/archived/RFC-016-integration-lock.md), the plan "Parallel
issues", [the example](../../examples/issues.ork.yaml)). What was left simpler:

- **L294 · The integration worktree comes from a session.** The resolver agent
  continues the worktree of the agent upstream of it
  ([L288](./conflict-resolver-limits.md)), and no tool node makes a worktree, so
  `prepare` is a cheap Haiku session (two turns, one tool) whose only job is to
  create the one worktree every integration, resolver and check works in. An
  edge from `prepare` to `resolve` that is taken only if `prepare` fails ties
  the resolver to it. A worktree a tool node could make would remove the
  session. Ork also commits what a `continue` session leaves, here in the middle
  of the rebase, so `stage` can no longer see which files the resolver touched:
  only its tool list (`Read`, `Grep`, `Glob`, `Edit`, `Write`) and the check
  guard against a stray edit, and `finish` goes on through `rebase --skip`.
- **L295 · An issue is built and reviewed once.** A review that is not `pass`
  leaves the issue out; there is no round back to its builder, because a loop
  cannot run for one item of a `forEach`. At most 10 issues are taken (a
  `forEach` needs its cap in the file), and the review reads the diff as text in
  its prompt, cut at 60,000 characters, rather than the builder's worktree.
- **L296 · The rebase replays what the remote branch lacks.** Each issue's
  branch starts from the project's `HEAD` when its builder ran, and the
  integration replays every commit of it that the remote branch does not have,
  so unpushed commits of the checkout the run started in go along. Each issue is
  squashed into one commit, `Resolve #n: <title>`.
- **L297 · The queue is state in files, and a resume starts it over.** What is
  queued, done and left out lives in files in the integration worktree's git
  folder, written by `plan`. A resumed run runs `plan` again, which empties
  `done`, so an issue already pushed is rebased again and finds nothing new (it
  is counted as integrated). `gather` and `plan` run on `node`, which Ork itself
  needs; `list`, `integrate`, `push` and `pr` need `gh` and `git`.
- **L298 · A walk of `issues` stops at its caps.** The workflow has about 5,600
  ways through it (a loop of integration nodes, each of which can fail), more
  than a walk's 4,096-path and one-second caps, so `ork validate` and `ork run`
  say "Walked … and stopped; not every way was tried" for it. The walk's own
  test raises the caps for the example and finds nothing.
- **L299 · `build`'s lock is the constant `branch:main`.** A lock name may read
  only `inputs`, and `build` has no branch input (the branch is the maintainer's
  answer at `decide`), so every publish holds `branch:main`, whichever branch it
  pushes. A `build` publishing to a branch `X` is therefore not ordered against
  an `issues` run with `--input branch=X`, and two builds to `X` are not ordered
  against each other. The way out is a branch input, or a lock name that may
  read a node's output.
