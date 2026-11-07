# ADR-056 — Walking every way through a workflow before it runs

- **Status:** Accepted
- **Date:** 2026-11-06
- **Topic:** validation / run semantics / UI
- **RFC:** [RFC-009](../rfcs/archived/RFC-009-walking-a-workflow.md)

## Context

`ork validate` checked that a workflow was well formed, not that it could do
what it said. A condition that's never true, a gate answer spelled wrong, or a
join behind a router that takes one edge all compiled clean, and several ended a
run as `succeeded` with most of its work skipped. With the builder, people who
never read the format can write these, and a mistake can cost hours of sessions
before it shows.

## Decision

**The compiler checks what it can be certain of.** A condition comparing a field
with a value its node can't report is an error, `when.value`, and so is a Claude
node declaring a `status` a session can't report, `output.status`. A condition
that reads nothing and is false, a loop with no condition, a plain edge beside a
loop, and a loop of sessions with no budget or time limit warn
([graph compiler](../specs/graph-compiler.md)).

**A walk tries every way through on the real scheduler.** `walkWorkflow` drives
`startRun` once per path, with stand-in executors and a scripted person, no
workspace and no store, so it starts no session, tool or script and writes no
file. Outcomes come from what each node declares and what each condition asks.
It stops at 4,096 paths or a second (200 ms in the builder) and says it stopped
([walking](../specs/scheduler/walking.md)).

**Its warnings say only what it tried.** `walk.never-runs` reads "no way the
walk tried reaches `x`", and `walk.only-rounds` "every way the walk tried
through the loop ran out of rounds". Rules hold them back where a walk would
most often be wrong: behind an input, another node's output, an owned node, an
eager join, a node that can run twice, a watch it can't end, or a gate a person
can stop. They're warnings, so they never stop a save or a run.

**`ork validate`, `ork run` and the builder share it** through `walkChecks`, so
the three can't disagree. `ork validate --paths` lists how a run can end.

## Options considered

From RFC-009, in full there: keep the checks as they were (the run that shows
the mistake is the expensive one); compiler checks only (can't see a join made
impossible three nodes back); a separate model of the graph (a second statement
of routing to keep in step, which wouldn't have found the engine's hang); and a
simulated run that executes scripts marked pure (Ork can't tell a script is
pure, and the builder validates on every edit).

## Rationale

The walk can't disagree with how a run routes, because it is how a run routes,
and it found an engine hang on its first day (`879c00a`). The compiler is the
only place a typo in a value can be caught.

RFC-009 proposed stating a finding only when proved. Built, that didn't hold:
three rounds of review each found workflows where a real run reached what the
walk said it couldn't, from finish orders, rounds a walk cuts, and outcomes a
stand-in doesn't give. A rule that's never quite right teaches people to
distrust the list. The maintainer chose wording that can't be false by
construction, and kept the rules that hold warnings back so they stay rare and
worth reading. A seeded fuzz runs random workflows on the real scheduler to keep
those rules honest, and each case found has its own test.

## Consequences

- A workflow with a value typo that ran before now stops at `ork validate` and
  `ork run` until it's fixed. The message names the values it can have.
- `startRun` must touch nothing when given no workspace; a test holds it, by
  patching the real `fs`, `child_process` and `net`.
- Every new way of routing has to stay true in the walk; a new node type gets
  success or failure with no work.
- A clean walk can read as more than it is. The guide says what it can't tell
  ([Checking a workflow](../docs/guides/writing-workflows/checking.md)), and the
  limits are in the register: [L139–L142](../specs/scheduler/walking-limits.md).
- [G8](../specs/scheduler.md#edges) (since closed), a run that skipped most of
  its work saying `succeeded`, stays its own decision.
