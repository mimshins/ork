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

Found building the integration lock
([RFC-016](../../rfcs/archived/RFC-016-integration-lock.md), a node's `lock:`
held across nodes, on the same ledger):

- **L290 · A lock is held to the run's end when its last naming node is
  skipped.** The run lets a lock go when a node naming it ends and no node the
  graph can still reach from there names it. A later naming node on a branch the
  run does not take keeps the lock until the run ends.
- **L291 · Items join a hold the run already has.** A fanned node's items take
  the lock one at a time, unless the run already holds the same lock from an
  earlier node; then they join that hold and run side by side.
- **L292 · A lock's waiters see the node that took it.** `lock.waiting` names
  the `<run>/<node>` whose record holds the lock, the first node of the hold,
  not the node now running under it.
- **L293 · Lock folders stay.** Each lock has a folder under `~/.ork/locks`;
  `ork doctor` sweeps the records of dead processes but never removes a folder,
  which a run may be about to take.
