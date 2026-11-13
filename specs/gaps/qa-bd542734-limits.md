# Limits found fixing QA run bd542734

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found fixing what QA run bd542734 left (heavy slots for scripts, a follow-up
taken twice, a run's outputs, runs after a crash or with no terminal). What was
built is in [the machine](../machine.md), [follow-ups](../follow-ups.md) and
[the CLI](../cli/running-and-runs.md); what follows was left simpler. The limit
of a script's heavy command is [L363](./machine-limits.md).

- **L364 · A recycled pid keeps a dead run "live".** A follow-up whose `takenBy`
  run is "live" is refused or skipped, and a run is live by the check `ork ps`
  uses: a process with its pid. When the system gives a crashed run's pid to
  another process, the run reads as live, as it does in `ork ps`, and its
  follow-ups stay taken until that process ends. Revisit with the same fix as
  `ork ps` (a start-time check).
- **L365 · A run that fails before its first record holds its follow-ups for two
  minutes.** A run marks a follow-up as its own before it stores its first
  record, so core counts a run the store does not know as live while the mark is
  under two minutes old (otherwise a second `--follow-ups due` takes the same
  ones). A run whose preflight fails leaves its follow-ups held until the window
  ends, for an id too. The window is a fixed constant, and a start slower than
  two minutes (a detached child on a loaded machine) is not held.
- **L366 · A waiter that makes `queue/` between doctor's sweep and its removal
  fails once.** `ork doctor` removes the empty `queue/` folders a sweep leaves
  (`~/.ork/slots`, `~/.ork/locks/<name>`). A run that starts waiting at that
  instant finds its folder gone, and its wait fails once with an error to run
  again. Taking the ledger's lock around the removal would close it.
- **L367 · A crashed run reads `cut off` only in `ork tree`.** `ork tree --json`
  and the browser view show the stored states (a started node still `running`),
  and the run page's header does not show the `kept` count of a resumed run;
  only `ork run`, `ork logs` and `ork attach` print it. Revisit with the next
  change to the tree payload.
