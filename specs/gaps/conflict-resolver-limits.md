# Limits found building the conflict resolver

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building the `resolve-conflict` example
([RFC-016](../../rfcs/archived/RFC-016-integration-lock.md), the plan "Parallel
issues", [the example](../../examples/resolve-conflict.ork.yaml)). What was left
simpler:

- **L286 · The resolver's nodes are copied, not called.** A `workflow.call` is a
  separate run with its own checkout and its own hold on a lock, so it can
  neither continue the caller's rebase nor sit under the caller's `lock:`. A
  workflow that integrates copies the nodes `inspect` to `check` of the example.
  There is no include or reusable node group in the format.
- **L287 · One conflicting commit per run.** A rebase that stops again on its
  next commit fails `finish`, with the new conflict in the checkout. Workflows
  commit once before they integrate, so this is rare; resolving several would
  need a loop back to `inspect`.
- **L288 · The resolver works where its session does.** Its tool steps take a
  `cwd:`, but the agent works in the run's checkout for its isolation, and
  `continue` follows only an agent's worktree, never a tool node's. A workflow
  that rebases in another node's worktree has to give the resolver an edge from
  the agent that worked there.
- **L289 · "Behaviour changed" is the resolver's own report.** Ork checks that
  only the conflicted files were edited, that no marker is left and that the
  project's check passes, but not whether the two sides' logic was kept. The
  maintainer's answer and the review of the pull request are the backstop. Text
  sides only: a binary or a rename conflict shows no useful diff.
