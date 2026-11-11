# Steps around a session

_Part of [Scripts in a workflow](../scripts.md)._

## Check a session's work

`verify:` on a leader or worker runs a program before its report is accepted, so
a session can't report success past a failing check:

```yaml
builder:
  type: agent.worker
  prompt: Add the retry logic the issue describes.
  verify:
    command: pnpm test
    timeout: 10m
    attempts: 2
```

- **It runs when a session reports anything but `fail` or `changes_requested`,**
  in the session's own checkout, before Ork commits its work. It takes what a
  tool node takes: `command` or `script`, `env:`, `plainEnv`, and a `timeout`.
- **A failure goes back to the same session.** It's told what failed, up to
  `attempts` times (1 by default, 0 to fail at once), and then the node fails.
  Each try is another turn, and stays within what's left of the budgets and the
  node's `maxTurns`. The session gets the last 8 KiB of what it printed and the
  path of a file with all of it.
- **A message that comes during a check that passes** gets one more turn, and
  the check then runs again.
- **What it writes counts.** A check runs in the node's checkout, and a file it
  leaves there that git doesn't ignore, such as a coverage report, is committed
  with the work.
- **The session knows.** Its instructions name the check, so it can run it first
  and often save the extra turn.
- **Read the result** as `{{nodes.builder.output.verify.exitCode}}`, or
  `verify.resumes` for how many tries it took.
- **Skip it when it already passed.** `once: true` on a `verify:` skips the
  command when the same check (the command, Node's version) already passed on
  identical files, and the run logs a `verify.skipped` line naming the earlier
  pass. A failure records nothing. `once` is also a tool node's field; see
  [`ork once`](../running-workflows/several-runs.md#run-a-check-once-ork-once).
- **`ork run --node`** doesn't run it, and says so.

A check also reaches a delegated child, which follows no edges, and a worker's
worktree, which a tool node can't.

## Set a node up

`before:` runs a program in a node's checkout before its session starts:

```yaml
builder:
  type: agent.worker
  before:
    command: pnpm install --frozen-lockfile
  prompt: Add the retry logic the issue describes.
```

- **If it fails, the node fails** and no model turn is spent.
- **It isn't held to the node's `isolation`.** On a `readonly` or `shared` node
  it runs in the shared checkout and can write there, so keep a default such as
  an install to nodes that have their own.
- **It runs each time the node runs,** and for each spawned instance.
- **Its prompt can read what it gave,** as `{{before.stdout}}`,
  `{{before.exitCode}}`, or `{{before.json.id}}` with
  `output: { format: json }`. So a program can gather what a session would spend
  turns finding. What you put in a prompt, the session pays for, so keep it
  short.
- **For every node in a project,** set it under `defaults:` in the workflow or
  in `.ork/project.yaml`. A node's own `before:` replaces the default, and a
  default can't read another node's output.
- **`ork run --node`** doesn't run it, and says so.
