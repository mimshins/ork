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
- **L363 · A script's heavy command is found by reading it, not by running it.**
  A shell `script:` takes a slot when one of its lines, split at `;`, `&&`,
  `||`, `|` and `&`, matches `heavy`. The split ignores quotes, and so does the
  strip of an inline comment (`echo "a # b" && pnpm check` hides `pnpm check`).
  It cannot see a command run through `eval` or a variable (the issues
  workflow's `check` node, `eval "$CHECK"`), a heredoc, or a called script; a
  script with a non-shell `interpreter:` (`node`) takes no slot, and neither
  does `interpreter: "/usr/bin/env bash"`. A line that starts with `if`,
  `while`, `!`, `time`, `exec`, `(` or `{` is not matched either (only
  `then`/`do`/`else` and a `VAR=value` prefix are dropped). Such a command runs
  without a slot. Refusing or warning in `ork validate` was ruled out (QA
  bd542734).

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

Found fixing the lock after a QA pass
([ADR-087](../../decisions/ADR-087-node-processes-end-with-ork.md), a node's
processes end with `ork`):

- **L317 · A reused pid holds a dead holder's lock or slot.** A ledger record is
  alive while its pid is, so a process that takes a dead holder's pid keeps its
  lock or heavy-check slot held. A run's own liveness also checks the process's
  start time (`process-age.ts`); the slot ledger does not (`slot-ledger.ts`).
- **L318 · A window of up to 2 seconds between a sweep and the orphan's end.**
  When `ork` is killed, a waiter's sweep sees the dead pid within one poll (500
  ms), while the node's watcher gives the group 2 seconds of SIGTERM before
  SIGKILL. A push in flight may land in that window. The shipped pushes are
  fast-forward only, so the next holder's is rejected and nothing is lost; a
  workflow that force-pushes could lose work.
- **L319 · Native Windows nodes outlive a killed `ork`.** The guard needs `sh`
  and POSIX process groups. WSL 2 is the supported path; native Windows would
  need Job Objects, a native dependency and its own ADR.
- **L320 · Claude Code's own children may escape the group.** A session's group
  is ended with `ork`, and a fake-driver test shows its children go too. What
  Claude Code does with its own background Bash children is unchecked; it needs
  a real session (a paid run).
- **L321 · A stop's SIGTERM also kills the watcher.** The group's SIGTERM from a
  stop reaches the `sh` watcher too, so a program that ignores SIGTERM survives
  if `ork` is SIGKILLed before its own SIGKILL follows.
- **L322 · The guard's spawn errors read oddly.** A missing `cwd` reads
  `spawn /bin/sh ENOENT`, and a driver that is not executable exits 126 and
  fails as `driver_crashed`, not as a missing program.
- **L323 · Ctrl-Z no longer pauses running sessions.** A session is `detached`,
  in its own process group, so the terminal's SIGTSTP does not reach it. Use
  `ork pause`.
