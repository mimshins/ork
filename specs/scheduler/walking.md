# Walking every way through

_Part of [The scheduler](../scheduler.md)._

Status: **Partial** ([walk.ts](../../packages/core/src/run/walk.ts),
[tests](../../packages/core/test/walk.test.ts),
[RFC-009](../../rfcs/active/RFC-009-walking-a-workflow.md)). `ork validate`,
`ork run` and the builder walk a workflow.

`walkWorkflow(graph)` tries every way through a compiled workflow on the real
`startRun`, so what the graph does for an outcome is what a run does. Stand-ins
choose the outcomes, so it can try one no run would give, or miss one a run
could. It starts no session, tool or script, and has no workspace or store, so
it writes no file and starts no process
([a test holds this](../../packages/core/test/walk-pure.test.ts)).

## Contents

- [One path](#one-path)
- [What's tried](#whats-tried)
- [Loops](#loops)
- [Watched nodes](#watched-nodes)
- [Limits](#limits)
- [Who walks](#who-walks)
- [What it reports](#what-it-reports)

## One path

Each path is one `startRun` with stand-in executors and a scripted human. Each
place a run can go more than one way is a choice, keyed on the node and round or
on the question asked. The first path takes the first way at each. The next one
replays the choices up to the last that has another way to go, and takes that.
Control nodes aren't stood in for: routers, splits and joins run the scheduler's
own code.

## What's tried

| Node            | How it can end                                  |
| --------------- | ----------------------------------------------- |
| `human.gate`    | Each option                                     |
| Claude nodes    | Success or failure                              |
| Tools           | Exit 0, or a failure with any other exit code   |
| `mcp.call`      | Success or failure                              |
| `workflow.call` | Success or failure; the called file walks alone |
| Any other type  | Success or failure                              |

A success then varies only by what some condition reads, because a value nothing
reads can't change where a run goes:

- A field with a closed list
  ([what a node says](../../packages/core/src/graph/says.ts)) gives each value
  on it. A Claude node's `status` gives `pass`, `changes_requested` and `done`;
  `fail` is its failure.
- Any other field takes values from the conditions themselves: each literal and
  a value that isn't it, a number either side of a bound, a text that does and
  doesn't contain a given one, and true and false for a bare name.
- What a router or split is asked goes to the node before it, and what a join is
  asked about `statuses` or `results` goes to its inputs' `status`.
- A failure varies only its exit code and tool output. Fields together are tried
  up to 32 ways per node.

Inputs take their default, or an empty value of their type. A condition on an
input isn't varied, so it usually goes one way (see
[what it reports](#what-it-reports)).

## Loops

A walk runs with each `maxRounds` cut to 2, so a large one costs nothing. A
node's rounds after the second repeat its second. What routes a node is its own
latest output, so a second round has nothing new to show after each possible
first one: it branches for the first history of first rounds to reach it, and
any other repeats its first round. What this could hide makes no claim: a
condition reading another node, and a join, which remembers its inputs between
rounds.

When a loop runs out, the scripted human answers each way: `stop`, `again` and
`onward`. `again` is offered once per loop edge on a path, so a path ends.

## Watched nodes

A `watch:` would wait in real time, so a walk runs its node with no `watch:`.
The node ends only ways a wait can: an outcome where `until` holds; running out
of time on a look where it doesn't, a failure that keeps that look's values, so
a handler for `pending` can run; or a failed look. Where no outcome tried makes
`until` hold, nothing is claimed after the node.

## Limits

A walk stops at 4,096 paths (twelve parallel nodes just fit) or after one
second, whichever comes first, and says it stopped: `complete` is false. The
time matters because a path costs more the more nodes it runs: 300 parallel
nodes reach about 100 paths in that second. The clock is checked inside a path
too, as splits that feed each other twice, with no join, multiply activations on
one path. `complete` means it didn't stop, not that every value was tried: a
node's values are cut at 32 ways, and later rounds repeat. A path that doesn't
settle within a second is a bug in the scheduler, and ends the walk.

It doesn't cover the order parallel branches finish in, so a `control.join` in
`any` mode goes one way; running out of budget or time; resuming; or what a
leader delegates, so an owned node runs only if an edge reaches it.

## Who walks

`checkWorkflowText` stays synchronous, and triggers, `ork context` and chat use
it without paying for a walk. `walkChecks` adds a walk to what it returned:

- `ork validate` prints the findings with its other diagnostics, then one line,
  `walkSummary`'s: `Walked 73 ways through: 5 succeed, 68 fail.`, or
  `Walked 4,096 ways through and stopped; not every way was tried.` `--paths`
  lists each ending, and `--json` carries the walk on each file's report. A file
  with errors isn't walked. Findings don't change its exit code.
- `ork run` prints the findings before it starts, and they don't stop it. It
  prints the summary line only for a walk that stopped, which has no findings
  and could otherwise look clean. A run of one node with `--node` doesn't walk,
  and nor does `ork resume`, as the run was walked when it started.
- The builder walks on each view of a workflow, and each edit waits for it, so
  there it stops after 200 ms, not a second
  ([builder-view.ts](../../packages/server/src/builder-view.ts)). The findings
  go in Problems and on the cards with the other diagnostics, and the summary
  line comes beside them. On `software-factory`, the largest example, an edit
  takes about 40 ms with its 461 paths. Saving doesn't walk: only errors block
  it.

## What it reports

`WalkResult` gives the number of paths, how many succeeded and failed, whether
it was `complete`, its `endings`, and its `findings`. An ending groups the paths
that ended with the same status and the same nodes not run, with the choices of
the first of them: a gate's answer, a loop's, and anything but a node going on
as hoped. Owned nodes aren't listed as not run.

Findings are warnings, since an outcome tried may never happen:

| Code               | Meaning                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `walk.never-runs`  | A node ran on no path.                                                                                                                       |
| `walk.only-rounds` | A loop was entered, and no path succeeded without it running out of rounds. A loop with no condition at all already has `loop.no-condition`. |
| `walk.unfinished`  | A path didn't settle. It's a bug in Ork, not the workflow, and says so.                                                                      |

The first two are claims about every way through, so they're made only when
proved. There are none when the walk stopped early, and none for what comes
after:

- an owned node, since delegation is a leader's judgment;
- a condition that reads anything but its own source node. An input is chosen at
  run time, and another node's output depends on what finished first and on
  rounds a walk cuts. It decides its node's other edges too, as a first-match
  router's are;
- a condition on its own source that went only one way across every path, as it
  may only have done so for what the walk tried;
- a node whose values were cut at the 32 ways, or a watched node whose `until`
  no outcome could make hold;
- a join a loop can feed, as it can fill across rounds a walk cuts or repeats.

A condition that went one way still counts when it reads one field of its own
source, and that field is how the node ended or has a closed list. Then every
value was tried, so going one way is the finding: a handler for
`status == 'fail'` behind a plain edge never runs, as a failed node takes no
plain edge. A gate's `ok` doesn't count, as a gate's failure isn't tried.

A failure isn't tried with each of a node's other values, so a join filled by a
failure handler and a value on the same failed node could be reported wrongly.
