# ADR-034 — `tool.git`: a commit is an explicit step

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** integrations / git
- **RFC:** waived — the author chose a `tool.git` node over `tool.shell`; the
  options are below
- **Builds on:** [ADR-022](./ADR-022-integration-registry.md) (integrations as
  adapters), [ADR-032](./ADR-032-project-rules.md) (`commit: never`)

## Context

Under `git.commit: never` ([ADR-032](./ADR-032-project-rules.md)) Ork runs no
`git commit` on its own, and a run's result is the root node's worktree with its
changes uncommitted. A project such as se-backend commits only after a human and
a reviewer approve, and only when a human asks. That commit has to be a step the
workflow declares, after its gates, and the human approving it should see what
it will commit.

## Decision

1. **A `tool.git` node type**, from a git adapter in the integration registry
   ([git.ts](../packages/integrations/src/git.ts)): it runs the user's own
   `git`, without a shell, in the node's `cwd` (often
   `{{nodes.<root>.output.worktree}}`).
2. **A default allow list.** The integration port gains an optional `allow`: the
   list a node has when it sets none. Git's is `add` and `commit`; `push`, or
   anything else, runs only when the node's own `allow` lists it.
3. **Observed output.** The port gains an optional `observe`: output fields read
   after the command, in the same folder. Git's are `staged`
   (`git diff --cached --stat`), `diff` (the staged patch, cut like stdout with
   the rest in a run file) and `head` (the commit `HEAD` names). They are
   recorded with the node's output on `node.finished`, so a gate after an `add`
   step can show exactly what a `commit` step will commit.
4. **Clean keeps what it would lose.** A commit in a detached worktree (made by
   a `tool.git` node under `commit: never`) is on no branch;
   `ork worktrees clean` keeps such a worktree unless `--force`.

## Options considered

- **`tool.shell` with `allow: [git commit]`:** nothing new to build, as the
  examples already do for `git push`, but no default that keeps a push out, and
  no staged diff for a gate to show. Rejected.
- **A commit node that is not a CLI integration** (`control.commit`): Ork would
  own a commit policy (message, author, signing). Rejected: the commit is the
  user's own `git`, with their identity, hooks and signing.
- **Observing in the event only** (a field on `tool.result`): a gate reads
  outputs through templates, not events. Rejected for output fields, which the
  events record anyway.

## Rationale

A commit is the project's policy, so it belongs in the workflow as a step, run
by the user's own tool like every other integration. The default allow list
keeps the safe case short (`add`, `commit`) and makes a push something a
workflow says out loud. Showing the staged diff before the commit gives the
human gate the same view `git diff --cached` would.

## Consequences

- se-backend's "commit only when a human asks" is expressible: `add`, a gate on
  `{{nodes.stage.output.staged}}`, then `commit`.
- Under `commit: never` the root's worktree is detached, so a workflow that
  wants a branch creates one itself (`switch -c`, allowed on the node); a commit
  on no branch is kept by `ork worktrees clean`.
- `ork doctor` reports whether git's `user.name` and `user.email` are set
  (needed only for a `tool.git` commit), without printing them.
