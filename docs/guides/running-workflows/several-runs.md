# Running several runs at once

_Part of [Running workflows](../running-workflows.md)._

Runs share your machine, and one full check (`pnpm check`, a whole test suite)
keeps most of its cores busy for half a minute. A build with four builders, or
several runs started together, would run many at once and make the laptop hot
and slow. Ork keeps that bounded with three things you can set in your project's
[rules](../project-rules.md#what-a-run-asks-of-the-machine): a few **slots** for
heavy commands, a **lower priority**, and checks that are **not repeated** by
the agents.

For the full rules: [the machine spec](../../../specs/machine.md).

## Contents

- [Slots for heavy commands](#slots-for-heavy-commands)
- [What waits](#what-waits)
- [Lower priority](#lower-priority)
- [Agents don't repeat your check](#agents-dont-repeat-your-check)
- [Seeing where the CPU went](#seeing-where-the-cpu-went)

## Slots for heavy commands

Name your project's full-suite commands in `.ork/project.yaml`:

```yaml
heavy:
  - pnpm check
  - pnpm test
  - vitest run
```

Each time a run is about to start one of them, it takes a **slot**. The slots
are shared by every run on your machine, in any project; by default there are 2.
A third command waits until one of the first two ends. To change the count:

```sh
export ORK_HEAVY_SLOTS=3
```

Anything that is not a positive whole number is ignored and the default stays.
Slots go first come, first served. If a run is killed while it holds one, the
next one waiting takes it over. With no `heavy` in the project, nothing waits.

## What waits

- A tool node's `command`, and a node's `verify:` and `before:` steps, when they
  match `heavy`.
- A Claude Code session's own Bash call that matches `heavy`. Ork holds the call
  before it starts, as it does for a [pause](./controlling-a-run.md), and lets
  it go when a slot is free. The slot is given back when the call ends, on the
  session's next call, or when the session ends. OpenCode and Command Code
  sessions don't take slots for their Bash calls yet
  ([L257](../../../specs/gaps/machine-limits.md)).

A wait is never silent. `ork ps` shows the run as `waiting for slot`, and
`ork logs`, `ork tree` and the Now column of `ork ui` say
`waiting for a check slot, held by <run>/<node>`. The time spent waiting does
not count towards a `timeout`: a command's clock starts when it gets its slot.

Only the full-suite commands wait. A targeted `vitest run <files>`, a lint or a
`git status` never does.

## Lower priority

By default Ork starts a run's sessions and tool commands at a lower priority
than your own programs (on macOS also as background-quality work), so your
editor and browser stay quick while runs work. A check may take longer when you
are busy with something else; that is the point. To turn it off:

```yaml
priority: normal # low is the default
```

The `ork` process itself always stays at normal priority, so its prompts and
`ork ui` answer quickly.

## Agents don't repeat your check

A node with `verify:` is checked by Ork after its session. So its session is not
allowed to run the full commands in `heavy`: it is told that Ork runs the check,
and a failed `verify:` comes back to it with the output. It can still run
targeted tests such as `vitest run packages/cli/test/usage.test.ts`. Nodes
without `verify:` are not limited.

In this repository, builders verify with `pnpm check:changed` (formatting, lint,
types, docs and `vitest run --changed`), and the leader and the publish step run
the full `pnpm check`. Inside a run, vitest also uses at most half your cores.

## Seeing where the CPU went

`ork usage --by node` has a `TOOL CPU` column: the seconds of CPU that each
node's tool commands used. It doesn't include the agent sessions' own CPU, and
isn't measured on Windows.
