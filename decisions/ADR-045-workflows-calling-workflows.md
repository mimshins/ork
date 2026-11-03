# ADR-045 — A workflow calls another as its own run, through a node

- **Status:** Accepted
- **Date:** 2026-11-03
- **Topic:** workflow format / engine / store / CLI
- **RFC:** [RFC-004](../rfcs/archived/RFC-004-workflows-calling-workflows.md)
- **Builds on:** [ADR-044](./ADR-044-relay-between-runs.md) (a channel to a call
  is a link), [ADR-043](./ADR-043-timeouts.md) (a call takes a `timeout`),
  [ADR-026](./ADR-026-resume-by-replay.md) (what a resume keeps)

## Context

A workflow file was the largest unit: one workflow could not start another or
use its result, and work often spans repositories. A run has one root, and an
owner cannot merge across repositories, so a call across projects cannot be one
run.

## Decision

A new node type, `workflow.call`, starts the named workflow as a separate
detached run, in this project or another registered one. Workflows gain optional
`outputs:`, and `schemaVersion` stays 1. The contract is
[specs/scheduler/calls.md](../specs/scheduler/calls.md).

- **A node, so nothing else changes.** Edges, `when`, `maxRounds`, joins and
  routers apply unchanged, and the called workflow keeps its project's rules,
  agents and worktrees.
- **A port, not a dependency.** The executor reaches a `CallPort`, which the CLI
  builds, so the package direction stays as it is.
- **Three ways to wait:** `run`, `node` and `none`. A waiting call holds no
  session.
- **One run per activation, unless it names a node.** With `node`, one run is a
  conversation, and a session that has ended is resumed with the next input.
- **One budget, one stop.** A called run is capped to what its caller had left,
  its cost counts against the caller, and a stop reaches it. Runs joined by
  `ork relay` stay separate.
- **A resume resumes what it called.** A call stays open until the caller keeps
  a successful result naming its run. An open run that stopped, crashed or
  failed is resumed with its caller, as `ork resume` retries its own failed
  nodes.
- **Any registered project may call,** unless the target's `calls.accept` limits
  it. A rendered name must be a plain file name, so it cannot walk past that
  rule.
- **Runs form a tree in the store:** `runs.parent` and `runs.depth`, in
  migration 7. Calls nest 5 deep, since the compiler sees one file and files can
  call in a circle.

## Options considered

The RFC weighed them: **A**, this node; **B**, inlining the called workflow at
compile time; **C**, one node in another project; **D**, a shell node running
`ork run`. B and C cannot cross projects, since a run has one root. D gives no
structured output and no shared budget or stop.

Two choices came up in the build:

- **A failed called run on the caller's resume:** retry it, or resume only runs
  a stop or crash ended. The maintainer chose the retry on 2026-11-03: it is the
  same rule `ork resume` has for a failed node, and one rule is easier to hold
  in mind. It can spend money, and resuming is the user's own act.
- **Telling a run's address to its caller's agents:** a channel names the call,
  not a run id, so a workflow file holds no ids. A message sent before the run
  has started waits for it.

## Rationale

Running the called workflow as its own run reuses what is built and proven: the
store, sockets, `detachRun`, `followEvents`, `resumable`, links and timeouts.
Each run can be read, stopped and resumed alone. What this costs is working out
budget, stop and resume across runs, and those are where the bugs were: a review
of the first build found them almost all in resume and stop.

## Consequences

- **Proven on real sessions on the CLI driver,** on 2026-11-03 for $0.036: two
  sessions in two repositories talked over a channel with no run ids; a
  conversation resumed an ended session and counted both costs; a cap ended a
  session; `ref` started a worktree from a branch; and a stop ended a resumed
  session within a second, with nothing left running. The SDK driver only
  against stand-ins ([C5](../specs/gaps.md#chores)).
- **Limits:** [L53–L61](../specs/gaps/limits.md). The budget is settled late, so
  calls running together can overspend it.
- **The Monitor must show a tree of runs,** and a tree's total, since `ork ps`
  shows a called run's cost on both it and its caller.
