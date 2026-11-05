# RFC-009 — Walking every way through a workflow before it runs

- **Status:** Implemented
  ([ADR-056](../../decisions/ADR-056-walking-a-workflow.md))
- **Date:** 2026-11-04
- **Supersedes:** —
- **Superseded by:** —

**As built,** the walk's findings say only what it tried, not that no way
through does: "no way the walk tried reaches `x`". The proof this RFC asks for
didn't hold up against review, so the maintainer chose wording that can't be
false ([ADR-056](../../decisions/ADR-056-walking-a-workflow.md),
[walking](../../specs/scheduler/walking.md)). The rest is as decided.

**Read with [RFC-010](./RFC-010-conditions-from-declared-outputs.md), which
comes first.** The maintainer's rule is to prevent a mistake where possible and
detect only what's left. RFC-010 stops value typos being made in the builder and
gives tools a declared shape. This RFC covers what remains: hand-written files,
and mistakes made of valid choices, such as an impossible join.

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Open questions](#open-questions)
- [Answered questions](#answered-questions)

## Context

`ork validate` checks that a workflow is well formed: its references resolve,
every cycle has a `maxRounds`, and every node can be reached along some edge
([graph compiler](../../specs/graph-compiler.md)). It doesn't check that the
workflow can do what it says. With the builder
([ADR-051](../../decisions/ADR-051-workflow-builder.md)), people who never read
the format can now write these mistakes, and a mistake can cost hours of
sessions before it shows.

### What compiles clean today

Each of these was written as a small workflow and run on the real scheduler with
stand-in executors. All of them pass `compileWorkflow` with no diagnostic.

| Workflow                                               | What happens                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `when: "false"` on the only edge into the rest         | The rest never runs. On a passing path: `succeeded`.                                                                                                    |
| `status == 'failed'` on a Claude node                  | Never true: the values are `pass`, `changes_requested`, `fail` and `done` ([types.ts](../../packages/core/src/graph/types.ts)). The handler never runs. |
| `choice == 'aprove'` on a gate offering `approve`      | Approving leads nowhere. `succeeded`.                                                                                                                   |
| `control.join` with `n: 2` behind a first-match router | Only one input can ever run, so the join and all after it never do.                                                                                     |
| A loop with no `when:`, or `when: 'true'`              | The loop can only end by running out of rounds.                                                                                                         |
| `maxRounds: 100000`                                    | Accepted, with no warning, even with no budget or timeout.                                                                                              |
| A plain edge beside a loop edge                        | Fires on every round, not once on the way out.                                                                                                          |

### Never-ending runs

Three different things can keep a run going:

- **A loop with no limit** can't be written. `graph.unbounded-cycle` is an
  error.
- **A run that never finishes** was an engine bug, found by the prototype below
  and fixed in `879c00a`. None of the four examples reached it.
- **A long, expensive loop** is still allowed, and is the risk that remains. It
  ends, but maybe only after thousands of sessions.

### The prototype

A prototype of about 80 lines drove the real `startRun` with stand-in executors,
because `startRun` already takes its executors as a port. It tried every outcome
of every node and every answer a person could give, read the outcomes from the
workflow's own conditions, and ran on the four examples and the workflows above.
It is not in the repository. Timings are from one run on one laptop, so they
show scale only.

| Workflow                                 | Nodes | Paths | Time       | Result                                      |
| ---------------------------------------- | ----- | ----- | ---------- | ------------------------------------------- |
| `across-projects`                        | 4     | 7     | 3 ms       | no false findings                           |
| `checked-build`                          | 3     | 6     | 1 ms       | no false findings                           |
| `pr-review`                              | 7     | 14    | 1 ms       | no false findings                           |
| `software-factory`                       | 11    | 73    | 6 ms       | no false findings; 3 owned nodes not walked |
| `when: "false"` strands the rest         | 3     | 2     | under 1 ms | `b`, `c` run on no path                     |
| Gate typo `aprove`                       | 2     | 2     | under 1 ms | `ship` runs on no path                      |
| Join `n: 2` behind a router              | 5     | 2     | under 1 ms | `y`, `j`, `after` run on no path            |
| Loop beside a plain edge, before the fix | 3     | 14    | 606 ms     | stuck on 4 paths                            |
| The same, after the fix                  | 3     | 14    | 1 ms       | stuck on none                               |

The walks wrote nothing to the run folder or the home folder they were given.
They have clear limits:

- **A typo in a value isn't found.** The prototype takes values from the
  conditions, so `status == 'failed'` makes it try `failed`, and the handler
  looks reachable. Only a check against the closed list of values finds this.
- **Owned nodes aren't walked.** Whether a leader delegates to one is the
  leader's judgment.
- **Only `==` and `!=` against a literal are read.** Other conditions run on
  what the real join computes, or don't get an outcome of their own.

**Paths multiply with parallel branches**, where each branch's outcome is
independent. A sequence grows slowly, as a failure ends the path.

| Shape                                 | Paths          | Time               |
| ------------------------------------- | -------------- | ------------------ |
| 100 nodes in a row                    | 101            | 31 ms              |
| 8 parallel nodes                      | 256            | 9 ms               |
| 12 parallel nodes                     | 4,096          | 133 ms             |
| 16 parallel nodes (stopped at 20,000) | 65,536 in full | 822 ms to the stop |

### What a warning costs

The proposed checks were run on the four examples, 25 nodes and 25 edges. No
other workflow was on this machine, so this says little about noise in real use.

| Check                                          | Hits | Reading                                      |
| ---------------------------------------------- | ---- | -------------------------------------------- |
| A `status` or gate `choice` outside its values | 0    |                                              |
| A condition that is always false               | 0    |                                              |
| A loop with no condition                       | 0    |                                              |
| A plain edge beside a loop                     | 0    |                                              |
| `maxRounds` above 20                           | 0    |                                              |
| A first-match router with no fallback          | 0    |                                              |
| A gate option with no edge                     | 3    | All intended: `keep` ends the run on purpose |
| Claude nodes, no budget or timeout             | 1    | `checked-build`, one session and no loop     |

This drops the last two as warnings. Three false alarms from three gates would
teach people to ignore the list. A gate answer that ends the run is a normal
thing to want, so it should be shown, not flagged.

## Options

### Option A — Keep the checks as they are

The first real run shows the mistake, and the docs warn about the common ones.

- **Pros:** nothing to build, and no warning can be wrong.
- **Cons:** the run that shows it is the expensive one, and several of these end
  as `succeeded`, so even the run may not show it. Ork's case rests on costing
  less than doing the work by hand
  ([roadmap](../../docs/interaction-map/public/js/data/roadmap.js),
  `benchmark`), and a wasted run works against that.

### Option B — More compiler checks, and nothing else

Compare each condition with the values its source can report, and warn on loop
shapes.

- **Pros:** cheap and local, with a line number on every finding. It is the only
  way to catch a typo in a value.
- **Cons:** it reads one edge or node at a time. It can't see a join that's
  impossible because of a router three nodes back, or a node stranded by what
  several conditions add up to, unless the compiler grows its own reasoning
  about how edges combine.

### Option C — Compiler checks, plus a walk through the real scheduler

Option B, plus a walk like the prototype, on the same `startRun`.

- **Pros:** the walk can't disagree with how a run behaves, because it is how a
  run behaves. It needs no second engine, and it costs milliseconds on the
  examples. It found both the impossible join and the engine's own hang.
- **Cons:** paths multiply with parallel branches, so it needs a cap and an
  honest way to say it stopped. It proves what the graph does for an outcome,
  not that the outcome will occur. It leans on `startRun` staying free of side
  effects when given no workspace.

### Option D — Compiler checks, plus a separate analysis of the graph

Reason over conditions and dead paths as a model checker would, without running
anything.

- **Pros:** can merge equivalent states, so parallel branches don't multiply. No
  need to run the scheduler.
- **Cons:** a second statement of how routing, dead paths, joins, routers and
  loop exhaustion work, which has to stay in step with the first. The hang would
  not have been found, as a model of the intended behavior doesn't have the bug.

### Option E — A simulated run that executes pure scripts

Run scripts marked as pure for real, during validation, and use their actual
output in the walk, so a condition is checked against what the script really
says.

- **Pros:** real output, so a `json.state` the script never prints would show.
  It is the only option that checks what a script says.
- **Cons:**
  - Ork can't tell that a script is pure, so `pure: true` is a claim, and a
    wrong one has side effects during validation.
  - The builder validates on every edit. Validation would run code on every
    edit, where today a saved `script:` runs only when someone starts a run
    ([ADR-051](../../decisions/ADR-051-workflow-builder.md)).
  - A script's output usually depends on what earlier nodes did in the worktree,
    and a walk has no such work, so real output on an empty checkout can
    mislead.
  - One output is one path. The walk needs every outcome anyway.
  - `ork run <wf> --node <id>` already runs one node for real, on demand.

## Decision

**Option C.** Ork checks what it can be certain of in the compiler, and walks
every way through the workflow on the real scheduler, without running a session,
a tool or a script.

Both go in `checkWorkflowText`
([check.ts](../../packages/core/src/project/check.ts)), which `ork validate`,
`ork run` and the builder already share, so the three can't disagree.

### 1. Compiler checks

These are the fallback for a file written by hand, as the builder's picker
([RFC-010](./RFC-010-conditions-from-declared-outputs.md)) can't produce most of
them. An **error** means the workflow certainly doesn't say what its author
meant, and no one would write it on purpose. For a file, it's the nearest thing
to prevention: the run doesn't start.

| Code                | Severity | Meaning                                                                                                                                                                                                                                                                                        |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `when.value`        | error    | A condition compares a field with a value it can't have: a Claude `status`, a gate's `choice`, or an `output.schema` field that lists its values. A node's own schema wins over the built-in `status`. A router or split passes its input through, so the check follows it to a single source. |
| `when.never`        | warning  | A condition that reads nothing and is false. It can be a way to switch an edge off for now, so it warns.                                                                                                                                                                                       |
| `loop.no-condition` | warning  | A loop edge with no `when:`, which can only end by running out of rounds.                                                                                                                                                                                                                      |
| `loop.beside-edge`  | warning  | A plain edge from the node a loop edge leaves. It fires every round; to leave once, give it a condition.                                                                                                                                                                                       |
| `loop.uncapped`     | warning  | A loop through a Claude node, with no `limits.budgetUsd` or `limits.timeout`. The message gives the most sessions it can start.                                                                                                                                                                |

There is no warning on a large `maxRounds` itself. Any line would be arbitrary,
and a loop with a budget is capped by that budget.

### 2. The walk

`walkWorkflow(graph)` in `core`, beside the scheduler, drives `startRun` once
per path, with stand-in executors, a scripted `HumanChannel`, no workspace and
no store.

**Outcomes** come from what is known about each node, beside the compiler's
known report fields ([types.ts](../../packages/core/src/graph/types.ts)):

- A **Claude node** can give each status, and each value its schema lists.
- A **gate** can give each option. A **loop running out of rounds** can be
  answered each way.
- A **tool** or **MCP call** can succeed or fail, and give each value it
  declares (RFC-010).
- A **`workflow.call`** can succeed or fail. The called workflow is walked on
  its own.
- Control nodes aren't stood in for: they are the scheduler's real code.
- A node type with nothing known about it can succeed or fail.

**Conditions** add values from their own expressions: each literal a field is
compared with and a value that isn't it, a number either side of a bound, and a
string that does and doesn't contain a given text. Where the walk can't make a
condition go both ways, it marks that edge as undecided.

**Findings** are warnings. An outcome the walk tries may never happen in real
use, so a walk never stops a save or a run.

| Code               | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `walk.never-runs`  | A node ran on no path, which `graph.unreachable` doesn't already report. |
| `walk.only-rounds` | Every way through a loop ends with it running out of rounds.             |
| `walk.unfinished`  | A walk didn't settle. It's a bug in Ork, not the workflow, and says so.  |

**A finding is only stated when it's proved.** Absence can't be claimed from an
incomplete walk, so `walk.never-runs` and `walk.only-rounds` are dropped when:

- the walk stopped at its cap;
- the node is behind an undecided edge;
- the node is owned, or behind one that is, since delegation is a leader's
  judgment.

**Limits:**

- **Paths:** the walk stops at a cap of about 4,000, which took 133 ms in the
  measurements above, and says how far it got. The final number is set when
  built.
- **Rounds:** only the first rounds of a loop branch, and later ones repeat the
  first outcome, so a loop adds few paths.
- **Not covered:** the order parallel branches finish in, so a `control.join` in
  `any` mode is walked only one way; running out of budget or time; and
  resuming.

### 3. What a person sees

- **`ork validate`** prints the findings, then one line, such as
  `Walked 73 ways through: 5 succeed, 68 fail.` or
  `Walked 4,000 ways through and stopped; not every way was tried.`
- **`ork validate --paths`** lists each ending, grouped by how the run ended and
  what didn't run, with the choices that led there. Here `keep` at a gate shows
  as a normal ending, with no warning.
- **The builder** shows findings in Problems, as it does the rest, with the
  summary line. A warning never blocks a save.
- **`ork run`** starts printing warnings, findings included, before it starts.
  Today it shows them only when an error stops it
  ([workflow.ts](../../packages/cli/src/run/workflow.ts)), so someone who runs
  without validating would never see a warning. They don't stop the run. A run
  of one node with `--node` skips the walk.

### What this leaves as it is

- **A test run stays a real run**
  ([ADR-051](../../decisions/ADR-051-workflow-builder.md)).
  [RFC-008](./RFC-008-workflow-builder.md) rejected a simulated run as a way to
  test a draft, as the user would script every outcome and Ork would carry a
  second way of running. A walk does neither, and it answers a different
  question: what the graph does across all outcomes, not what this draft does on
  this code. This needs no change to that decision.
- **Scripts aren't run** to validate (Option E). A later, explicit way to feed a
  walk real outcomes, such as those recorded by a past run, would add this
  without running code. It would need its own RFC.

## Consequences

**Better:**

- Mistakes that cost a run are found while writing, for free, in the terminal
  and the builder alike.
- The scheduler gets a test that tries every path of every example, the kind of
  run that showed the hang.

**Worse:**

- `when.value` is a new error, so a workflow that has this typo and runs today
  stops at `ork validate` and `ork run` until it's fixed. That's the point, and
  the message names the values it can have, but it is a break for that file.
- `startRun` has a new requirement: given no workspace, it must touch nothing. A
  test holds this, walking every example and checking no file is written and no
  process starts.
- The walk is more code for every new way of routing to stay true to, though a
  new node type gets succeed-or-fail with no work.
- A clean walk can read as more than it is. The wording has to say it tried the
  shape of the workflow, and that a typo on an undeclared field, such as
  `json.state == 'opne'` on a tool that doesn't declare `state`, can't be seen.

**Follow-up work:**

- Add the new codes to [graph-compiler.md](../../specs/graph-compiler.md), and
  the walk there or in a chunk of its own; `--paths` to
  [cli.md](../../specs/cli.md); the Problems behavior to
  [ui](../../specs/ui.md#workflow-builder).
- Add a guide section on what `ork validate` tells you, and what it can't.
- Write the ADR, and record the limits above in the
  [gaps register](../../specs/gaps.md).

**Decided separately:** [G8](../../specs/gaps.md#gaps) records that a run which
skipped most of its nodes still says `succeeded`. That changes what a finished
run reports, not what's checked before it starts, so it needs its own decision.

## Open questions

1. **Is the walk's result useful on real workflows?** Only the four examples
   were measured, and no others exist yet. The maintainer chose to check the
   findings and the path cap on the first real workflows once this is built; a
   noisy warning is easy to demote.

## Answered questions

The maintainer's answers, on 2026-11-04.

1. **Should `when.value` be an error or a warning?** An error: prevent where
   possible, and for a hand-written file the nearest thing is a run that doesn't
   start.
2. **Should Ork ever run scripts during validation?** No. The walk uses declared
   values ([RFC-010](./RFC-010-conditions-from-declared-outputs.md)) and never
   runs code. `ork run --node` still runs one node for real on demand, and
   feeding a walk outcomes recorded from a past run would need its own RFC.
