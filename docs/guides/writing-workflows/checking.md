# Checking a workflow

_Part of [Writing workflows](../writing-workflows.md)._

## Values a condition can't have

A condition that compares a field with a value its node can't report is an
error, and the run doesn't start: `status == 'failed'` on an agent node, whose
statuses are `pass`, `changes_requested`, `done` and `fail`, or
`choice == 'aprove'` on a gate offering `approve`. The message names the values
it can have. A condition that reads nothing and is false, a loop with no
condition, a plain edge beside a loop, and a loop of sessions with no budget or
time limit are warnings.

## Every way through

Then it tries every way through the workflow, without running a session, a tool
or a script: each status, each gate answer, each value a condition asks about,
success and failure. It ends with a line such as
`Walked 14 ways through: 2 succeed, 12 fail.` To see how a run can end, and the
choices that lead there:

```sh
ork validate path/to/file.ork.yaml --paths
```

It warns about what it found:

- `no way the walk tried reaches b`: a node that ran on no way through. A join
  behind a router that only takes one edge is the usual cause.
- `every way the walk tried through the loop a -> b ran out of rounds`: a loop
  only its rounds end.

`ork run` prints the same warnings before it starts, and they don't stop it, and
the browser view shows them in Problems.

## What it can't tell you

The walk tries the shape of the workflow, not your work. Its warnings say what
it tried, and a run can still do something it didn't:

- It can't tell whether an outcome will happen, or see a mistyped field a tool
  never said it reports. Declaring a tool's output ([Scripts](../scripts.md))
  lets it check those values too.
- It doesn't vary inputs, try every order parallel branches finish in, or follow
  a leader's delegation, so it says nothing about what comes after those.
- A large workflow can stop it early, at 4,096 ways or a second, and then it
  says so and warns about nothing.

For the full rules: [the graph compiler](../../../specs/graph-compiler.md) and
[walking every way through](../../../specs/scheduler/walking.md).
