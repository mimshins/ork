# Limits found closing the blind spots of QA run c9c908b9

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found closing the blind spots of QA run c9c908b9 (the QA kit in `tools/qa/`, the
guarded stores in a run's identity, and the `qa-pass` clean-up step). What was
built is in the specs and guides it touches; what follows is what was left
simpler, or could not be checked.

- **L342 · The kit's `commit` is a bounded way past the commit deny.** The
  project denies `Bash(git commit *)` to every node, and a node cannot lift a
  project deny. `node tools/qa/kit.ts commit <repo>` (`tools/qa/commit.ts`)
  commits from a child process, which the deny does not reach. It refuses a repo
  whose top level, or whose `git rev-parse --git-common-dir`, is not inside a
  folder under `os.tmpdir()` that holds `.ork-qa-root`, and it refuses this
  project's checkout and its worktrees. Pushes stay denied, so a clone of this
  repo put in such a folder can be committed to but not pushed. The
  `git -c … commit` and `git -C … commit` forms are denied too since this change
  (see G14). Revisit if a workflow gains a way for a node to lift a project
  deny, or if a second tool needs to commit.
- **L343 · A `qa-pass` stopped before `sweep` leaves its temp folders, and may
  leave processes.** The kit's clean-up runs when a tester calls
  `kit.ts stop <root>` and when `sweep` runs. A run stopped or crashed before
  either skips it, and the folders under pack's temp folder stay. Since
  [ADR-087](../../decisions/ADR-087-node-processes-end-with-ork.md) a killed
  `ork` ends the processes it started, but whether that reaches what a tester's
  own Bash started (a detached inner run, a backgrounded `ork ui`) is unchecked
  (follow-up c2964b89). Revisit when that follow-up is checked.
- **L344 · `stop` finds processes by their argv.** It ends every process whose
  argv contains `<root>/`, a unique `mktemp` path, so a process that rewrites
  its argv escapes it. None of Ork's do.
- **L345 · The kit's `gh` stand-in answers nothing.** It logs its argv to
  `<root>/gh.log` and exits 1, so `ork doctor` reports `gh` as `warn`/`skip` and
  a flow that needs GitHub (opening a pull request, `ork init --issues` against
  a real repository, `github` follow-up stores) stays untested by a QA pass.
  Revisit if a QA pass needs to cover those flows.
- **L346 · The guard on guarded stores is still not a boundary.** It adds to
  [L80](../messaging/scripts-limits.md): an agent can unset the variable that
  names the guarded stores, as it could unset `ORK_SESSION`. A store is compared
  by its realpath, but a store folder that does not exist yet is resolved
  without following symlinks (`realStore` in `packages/nodes/src/run-marker.ts`
  falls back to `path.resolve`), so a symlinked path to a store not yet created
  could read as not guarded. Revisit with L80.
- **L347 · `qa-pass` ends `succeeded` when every tester fails.** The `sweep`
  edge is `ok || !ok`, so it is always taken, and `decide` is skipped when no
  tester passed (count 0). The run then ends `succeeded` where it ended `failed`
  before. Revisit with a `!ok` path that still fails the run.
- **L348 · `stop` finds processes with `ps -axo`, checked only on macOS.** Its
  output format on Linux (procps) is unchecked, so on Linux `stop` may miss a
  process or match the wrong column. Revisit when a QA pass runs on Linux.
- **L349 · The kit assumes one `TMPDIR`.** `setup` puts the root beside the
  tarball inside pack's `mktemp` folder, and `commit` and `stop` compare it to
  `os.tmpdir()`. If pack and the tester's session have different `TMPDIR`s,
  `commit` and `stop` refuse. Revisit if a QA pass runs with them different.
