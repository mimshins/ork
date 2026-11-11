# Limits found building the machine rules

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building [slots, priority and CPU](../machine.md) (heavy commands take a
machine-wide slot, runs start at a lower priority,
[ADR-080](../../decisions/ADR-080-machine-slots-and-lower-priority.md)). What
was left simpler:

- **L256 · A session's own CPU is not measured or limited.** Claude Code,
  OpenCode and Command Code processes run at the project's priority, but their
  CPU is not recorded, and nothing caps how many run at once beyond a node's
  `concurrency`. Only Ork's tool commands have a CPU figure.
- **L257 · Only Claude Code's sessions take a slot for a Bash call.** The
  pre-call hook that holds a Claude Code session also takes the slot for a
  matching Bash call. OpenCode's and Command Code's hooks are not used for it,
  so their sessions' heavy Bash calls take no slot. Their `verify:` nodes still
  have the heavy commands denied, and their tool commands still take slots.
  Carry to the drivers' next hook work.
- **L258 · CPU time is not recorded on Windows.** It comes from `times`, which
  Windows lacks; a tool command there has no `cpu`, and its `TOOL CPU` cell is
  empty. Priority gets only what Node's `os.setPriority` gives.
- **L259 · Nothing but a waiter sweeps the slot ledger.** A record whose process
  died is taken over when another command waits for a slot, but `ork doctor`
  doesn't look at `~/.ork/slots` or list its holders.
- **L260 · Priority is set just after the process is spawned.** The child runs
  for a moment at normal priority before `os.setPriority` and macOS's
  `taskpolicy` apply. A `nice` wrapper would close the gap if it shows.
- **L261 · The saving is not measured yet.** The plan's check, a build like run
  `029a5164` measured again (full suites per run from about 25 to the leader's
  rounds and the publish, and CPU-hours), needs a real run, and is written into
  the benchmark notes when one is done. Carried, unplanned: it waits on the
  world.
