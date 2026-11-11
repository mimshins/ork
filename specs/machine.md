# The machine runs share: slots, priority and CPU

Status: **Built** for Ork's tool commands and for a Claude Code session's Bash
calls; OpenCode and Command Code are not covered yet
([L257](./gaps/machine-limits.md)). The build run that measures the saving is
still to do ([L261](./gaps/machine-limits.md)). Code:
[slot ledger](../packages/core/src/machine/slot-ledger.ts),
[heavy rules](../packages/core/src/project/heavy.ts),
[a node's port](../packages/core/src/run/machine.ts),
[spawn](../packages/nodes/src/spawn.ts),
[tool CPU](../packages/core/src/store/tool-cpu.ts)
([tests](../packages/core/test/slot-ledger.test.ts),
[heavy commands](../packages/nodes/test/heavy-slots.test.ts),
[CPU](../packages/core/test/tool-cpu.test.ts)). Why:
[ADR-080](../decisions/ADR-080-machine-slots-and-lower-priority.md).

Several runs share one machine, and one full check keeps most of its cores busy.
This spec is what Ork does so that runs stay cool: a few **slots** for heavy
commands, a **lower priority** for what a run starts, and the **CPU** it records
so the next look at heat starts from numbers. The project's side is two
[rules](./project-rules.md#machine-rules); the user's side is
[running several runs at once](../docs/guides/running-workflows/several-runs.md).

## Contents

- [Heavy commands](#heavy-commands)
- [Slots](#slots)
- [Priority](#priority)
- [CPU](#cpu)
- [Around a run](#around-a-run)

## Heavy commands

`heavy` in `project.yaml` is a list of command patterns in the permission
patterns' syntax (`*` is any text; a pattern without `*` matches only that
command, so `vitest run` leaves `vitest run <files>` alone):

```yaml
heavy:
  - pnpm check
  - pnpm test
  - vitest run
```

- **Denied to a checked node.** A Claude node with `verify:` gets each pattern
  as a `Bash(…)` deny rule when the project's rules are put under the workflow
  ([precedence](./project-rules.md#precedence)); Ork runs that check, and a
  failed `verify:` goes back to the session with its output. Nodes without
  `verify:` and targeted test runs are never denied.
- **Taking a slot.** A command that matches takes a [slot](#slots) around it: a
  tool node's `command`, a `verify:` and a `before:` step, and a Bash call of a
  session (below).
- With no `heavy`, nothing is denied and no slot is taken.

## Slots

A slot is a record in `~/.ork/slots`, shared by every run on the machine, in any
project. `ORK_HEAVY_SLOTS` sets how many at once; anything but a positive
integer is the default, 2.

- **First come, first served.** A command that finds no free slot queues a
  ticket and polls; slots go to tickets in order.
- **Atomic.** A record is written whole and linked into a free slot, which fails
  if the slot exists, as the [lease ledger](../packages/runtime/src/lease.ts)
  does.
- **A dead holder frees its slot.** A record or ticket whose process is gone is
  swept by the next waiter, and its slot taken over. Nothing else sweeps: there
  is no `ork doctor` check yet ([L259](./gaps/machine-limits.md)).
- **A record holds** a run id, a node id and a pid, and nothing else.

### A wait is shown

When a slot is not free, `slot.waiting` is appended with who holds the slots
(`<run>/<node>`); when it is taken, `slot.taken`
([events](./event-store.md#runs-and-events)). Meanwhile:

- `ork ps` shows the run as `waiting for slot`;
- `ork logs` and `ork tree` say `waiting for a check slot, held by <run>/<node>`
  (the Now column of `ork ui` too: [the Monitor](./ui.md));
- the node's clock, its owners' and the run's stand still, as while it waits on
  a decision, so a command's `timeout` counts from the slot
  ([run control](./run-control.md)).

### A session's Bash call

The pre-call hook Ork already puts in a Claude Code session takes a slot for a
Bash call that matches `heavy`. Waiting is a hold
([ADR-041](../decisions/ADR-041-pause-continue-stop.md)): the hook waits within
the hold window and defers past it, as a pause does. The post-call hook releases
the slot; so does the session's next call, and its end.

## Priority

`priority: low` (the default) or `normal`. Under `low`, a session and a tool
command start below the `ork` process: under `nice -n 10`
(`PRIORITY_BELOW_NORMAL`), and on macOS under `taskpolicy` utility QoS too, so
they and what they start run lower from the first instruction, and the user's
editor and browser come first. `normal` leaves them. The `ork` process itself
always stays normal, so prompts and the UI answer quickly.

Without `nice` (Windows), Ork lowers the child with `os.setPriority` just after
it starts, which is all Windows gets.

## CPU

A tool command's user and system CPU time, children included, comes from `times`
and rides on its `tool.result` event (`cpu: { userMs, systemMs }`). The
`tool_cpu` table in `~/.ork/state.db` (migration 19, filled from the runs
already stored) keeps one row per command beside the
[usage ledger](./usage.md#the-ledger), so pruning a run keeps it.

- `ork usage --by node` has a `TOOL CPU` column (seconds); the benchmark records
  `tool_cpu_seconds` ([benchmark-run](../.ai/skills/benchmark-run/SKILL.md)).
- Not measured on Windows ([L258](./gaps/machine-limits.md)). A session's own
  CPU (Claude Code, OpenCode, Command Code processes) is not measured at all
  ([L256](./gaps/machine-limits.md)).

## Around a run

Quick changes that go with these, in this repository's own process:

- `pnpm check:changed` runs the static checks and `vitest run --changed`; the
  `implement` and `engine` nodes of `build` verify with it, and the leader and
  the publish keep `pnpm check`.
- `vitest.config.ts` caps `maxWorkers` at half the cores when `ORK_RUN` is set.
- The overview stream reads a running run's live and paused state from
  `EventStore.controlEvents` (its pause, continue, start and finish events), not
  from every event.
