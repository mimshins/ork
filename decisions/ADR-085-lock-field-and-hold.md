# ADR-085 — A node's `lock:` field, held by the run across nodes

- **Status:** Accepted
- **Date:** 2026-11-12
- **Topic:** workflow format, scheduler, machine ledger, workflows (`issues`,
  `build`)
- **RFC:** [RFC-016](../rfcs/archived/RFC-016-integration-lock.md) (option A,
  accepted 2026-11-11); the plan "Parallel issues"

## Context

Runs work in parallel without conflicts, each in its own worktrees and branches.
What needed an order was integration into one shared branch: two runs that
fetch, rebase and push the same branch race, and on a rebase conflict `build`'s
`publish` aborted and stopped the run for the maintainer. The maintainer works
several GitHub issues at once into one branch and one pull request, so the lock
had to be held from fetch to push across the nodes a conflict needs (an agent
resolves it, the check runs again), for one run over many issues and for
separate runs onto one branch.

## Decision

- **A node field `lock: <name>`** on workers, tool nodes and `mcp.call`: one
  non-blank name per node, so two locks cannot be taken in different orders. It
  may read `{{inputs.*}}` and nothing else (`ork validate` refuses `{{nodes.*}}`
  and `{{item}}`). It is optional, so `schemaVersion` stays 1.
- **The run holds it, not a node.** It takes the lock before the first node that
  names it and lets it go after the last node the graph can still reach from
  there that names it, and on every end of the run (success, failure, stop, the
  sweep of a crash). It keeps it while the run waits on a decision. A fanned
  node takes it per item, one at a time, unless the run already holds it.
- **A machine-wide ledger on the slot ledger's mechanism** (tickets first come,
  first served, hard-link records of run, node and pid, a dead holder's record
  swept), one folder per lock under `~/.ork/locks`, **named by a hash of its
  key**, so no remote URL is written to disk. A `branch:<name>` key is the
  origin's URL (no scheme, no user part, no `.git`) and the branch; the repo's
  path when there is no origin; other names, the project's root and the name.
- **Sibling events, not the slot's.** `lock.waiting` (with `holders`),
  `lock.taken` and `lock.released` (`end`: `span` or `run`) are their own
  events, so every consumer of `slot.*` stays as it is. The wait stands the
  clocks still, as the slots' does, and `ork ps`, `ork logs`, `ork tree` and the
  UI say "waiting for <lock>, held by <run>/<node>".
- **A resume takes the lock again and reruns the locked nodes from the first
  one**, since the branch may have moved. Stopping a run releases its lock.
- **`ork doctor` sweeps the lock records and the check-slot records** of dead
  processes, naming each removed (this closes L259).
- **The resolver is a node group to copy, not a workflow to call.** A
  `workflow.call` is a separate run with its own checkout and its own hold, so
  it can neither continue the caller's rebase nor sit under its lock.
  `examples/resolve-conflict.ork.yaml` is both a workflow to run alone and the
  nodes `issues` copies. Ork commits nothing in a worktree while a rebase,
  merge, cherry-pick or revert is underway, so the resolver's edits wait for the
  step that finishes it.
- **`issues` integrates in a loop, not a `forEach`.** A fanned node's items
  cannot see the one before them, and each issue must be rebased onto the last
  one's result, so the integration is a loop of nodes under one lock; the
  builders and reviewers, which need no order, are `forEach`.
- **`build`'s `publish` names `lock: branch:main`** and otherwise behaves as
  before.

## Options considered

- **An integration node type, `git.integrate`.** It needs the same cross-node
  hold for its conflict loop, but no general lock, and a project that integrates
  another way could not use it.
- **A CLI lease, `ork lease take|release`.** Release depends on every script on
  every path; a stop or a crash between nodes leaves it to a sweep; the wait is
  not a run state, so the clocks run and nothing shows it.
- **A lock around one tool command only.** The resolver would work without it,
  and a check could pass on one tip before a push onto another.
- **Reusing the `slot.*` events.** Declined: a lock's hold spans nodes and names
  a lock, and consumers that count slots would count it.

## Consequences

- A format field, the Zod model and `workflow.schema.json`, the compiler, the
  scheduler's hold, a ledger beside the slots, three events (store, `ork logs`,
  `ork ps`, `ork tree`, the UI's logs) and a doctor check.
- A long check under the lock makes other runs wait, shown with the holder; the
  check runs once per integration.
- Left simpler, in the [register](../specs/gaps.md): a lock held to the run's
  end when its last naming node is skipped, items joining an existing hold,
  waiters seeing the first node of a hold, lock folders staying (L290–L293); the
  resolver's limits (L286–L289); the `issues` workflow's (L294–L299).
- A wrong resolution that passes the check is caught by the maintainer's answer
  (asked when the resolution changes behaviour) and by the review of the pull
  request.

Spec: [integration](../specs/integration.md); guide:
[Working on issues in parallel](../docs/guides/issues-in-parallel.md).
