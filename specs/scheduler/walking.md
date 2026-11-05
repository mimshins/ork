# Walking every way through

_Part of [The scheduler](../scheduler.md)._

Status: **Built** ([walk.ts](../../packages/core/src/run/walk.ts),
[tests](../../packages/core/test/walk.test.ts),
[fuzz](../../packages/core/test/walk-fuzz.test.ts)). `ork validate`, `ork run`
and the builder walk a workflow. Why:
[ADR-056](../../decisions/ADR-056-walking-a-workflow.md),
[RFC-009](../../rfcs/archived/RFC-009-walking-a-workflow.md).

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
| Tools           | Exit 0, or a failure with any other exit code¹  |
| `mcp.call`      | Success or failure                              |
| `workflow.call` | Success or failure; the called file walks alone |
| Any other type  | Success or failure                              |

¹ A tool with `output: { format: json }` can also fail on exit 0, when its JSON
says it failed or holds what it didn't declare.

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
- A tool's failure varies only its exit code and output, as it keeps no JSON.
  Any other node's failure is also tried with each value, as a report keeps
  them, and with none, as a session can end with no report. A failed node holds
  nothing it didn't declare. Fields together are tried up to 32 ways per node.

Inputs take their default, or an empty value of their type. A condition on an
input isn't varied, so it usually goes one way (see
[what it reports](#what-it-reports)).

## Loops

A walk runs with each `maxRounds` cut to 2, so a large one costs nothing. A
node's rounds after the second repeat its second. What routes a node is its own
latest output, so a second round has nothing new to show after each possible
first one: it branches for the first history of first rounds to reach it, and
any other repeats its first round. A node with more than one edge in can run
more than once on a path too, and the same holds for it. What this could hide is
held back (see [what it reports](#what-it-reports)).

When a loop runs out, the scripted human answers each way: `stop`, `again` and
`onward`. `again` is offered once per loop edge on a path, so a path ends.

## Watched nodes

A `watch:` would wait in real time, so a walk runs its node with no `watch:`.
The node ends only ways a wait can: an outcome where `until` holds; running out
of time on a look where it doesn't, a failure that keeps that look's values, so
a handler for `pending` can run; or a failed look. Where no outcome tried makes
`until` hold, or `until` reads an input or another node, which a walk doesn't
vary, nothing is said of what comes after the node.

## Limits

A walk stops at 4,096 paths (twelve parallel nodes just fit) or after one
second, whichever comes first, and says it stopped: `complete` is false. The
time matters because a path costs more the more nodes it runs: 300 parallel
nodes reach about 100 paths in that second. The clock is checked inside a path
too, as splits that feed each other twice, with no join, multiply activations on
one path, and when nodes finish, as each finish costs more the more nodes run at
once. Past a couple of thousand nodes in parallel a walk can still run past its
limit, by about what compiling the workflow costs. `complete` means it didn't
stop, not that every value was tried: a node's values are cut at 32 ways, and
later rounds repeat. A path that doesn't settle within a second is a bug in the
scheduler, and ends the walk.

It doesn't cover the order parallel branches finish in, so a `control.join` in
`any` mode goes one way; running out of budget or time; resuming; or what a
leader delegates, so an owned node runs only if an edge reaches it. Its
stand-ins differ from real nodes in places: a failed commit keeps the node's
`status` ([gaps](../gaps.md)).

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
  line comes beside them. On `software-factory`, the largest example, its walk
  takes about 60 ms with its 573 paths. Saving doesn't walk: only errors block
  it.

## What it reports

`WalkResult` gives the number of paths, how many succeeded and failed, whether
it was `complete`, its `endings`, and its `findings`. An ending groups the paths
that ended with the same status and the same nodes not run, with the choices of
the first of them: a gate's answer, a loop's, and anything but a node going on
as hoped. Owned nodes aren't listed as not run.

Findings are warnings. An outcome a walk tries may never happen, and it can't
try every outcome a run can have, so each says only what the walk tried:

| Code               | Message                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `walk.never-runs`  | No way the walk tried reaches `x`: it ran on no path.                                                                                                                   |
| `walk.only-rounds` | Every way the walk tried through the loop ran out of rounds: no path succeeded through its nodes another way. A loop with no condition already has `loop.no-condition`. |
| `walk.unfinished`  | A path didn't settle. It's a bug in Ork, not the workflow, and says so.                                                                                                 |

The first two are left out where a walk would most often be wrong, to keep them
worth reading. There are none when the walk stopped early, and none for what
comes after:

- an owned node, since delegation is a leader's judgment;
- a condition that reads anything but its own source node. An input is chosen at
  run time, and another node's output depends on what finished first and on
  rounds a walk cuts. It decides its node's other edges too, as a first-match
  router's are;
- a condition on what a join in `any` or `n` mode reports, directly or through
  routers and splits. Whether it fires doesn't depend on what finished first,
  but what it reports does;
- a condition on its own source that went only one way across every path, as it
  may only have done so for what the walk tried;
- a node whose values were cut at the 32 ways, or a watched node whose `until`
  no outcome could make hold, or that reads an input or another node;
- a join behind a node that can run more than once on a path: a loop's, or one
  with more than one edge in. It can fill across rounds a walk cuts or repeats,
  or when a later run overtakes a slower branch, an order a walk doesn't try.

`walk.only-rounds` is also left out if anything after the loop is held back, as
a way out may be, and for a loop edge on no cycle, as another loop decides how
often its source runs.

A condition that went one way still counts when it reads one field of its own
source, and that field is how the node ended or has a closed list. Then every
value was tried, so going one way is the finding: a handler for
`status == 'fail'` behind a plain edge never runs, as a failed node takes no
plain edge. Nothing a gate answers counts, directly or through routers and
splits, as a gate someone stops has no `choice` and a walk doesn't try that. Nor
does `ok` on a node that declares a field of that name, which it reports
instead.

[A fuzz](../../packages/core/test/walk-fuzz.test.ts) holds these to the real
scheduler: it runs small random workflows on it, with every activation free to
end any way, real `maxRounds`, and several finish orders, and fails if it
reaches what a walk said it didn't. It passes on its seeds, which is evidence,
not proof: each review so far has found shapes it doesn't make. It uses a walk's
own outcomes, so it can't see a stand-in that differs from a real node, and it
has no watched, owned or MCP nodes, and its finish orders don't wait on timers.
[The walk's tests](../../packages/core/test/walk.test.ts) hold each shape found
by hand.
