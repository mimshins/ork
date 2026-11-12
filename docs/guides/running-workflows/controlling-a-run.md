# Controlling a run

_Part of [Running workflows](../running-workflows.md)._

## Pause, continue, stop one node

```sh
ork pause 3f2a                  # nothing new starts; sessions wait before their next tool call
ork continue 3f2a               # it goes on from where it waited
ork pause 3f2a --node review    # just one node; the rest keeps going
ork stop 3f2a --node review     # that node fails, "stopped by the user"; the run goes on
```

A pause never cuts work short: a session finishes the step it is on and waits
before its next tool call, a shell, `gh` or `aws` command runs to its end, and a
gate keeps its question open (you can still answer it) while its timeout waits
with it. A long pause is fine: the session picks up where it waited. `ork ps`
shows the run as `paused`; `ork tree` marks the nodes that are waiting.

## Follow a run, and leave it going

```sh
ork attach 3f2a                 # follow a run (and the runs it called), answer here
```

Ctrl-C in `ork attach` **detaches**: the run keeps going, its questions stay
open, and the terminal prints
`detached; run 3f2a keeps going · ork attach 3f2a · ork stop 3f2a`. Stop it with
`ork stop`. In a foreground `ork run`, Ctrl-C stops the run, and the runs it
called ([attaching to a run](./attaching-to-a-run.md#leaving-ctrl-c)).

## Talk to a node

```sh
ork chat 3f2a builder                      # type messages; Ctrl-D leaves
ork chat 3f2a builder -m "Skip the docs"   # one message
```

While the run is going, your message reaches the node at its next step, even
mid-task, and its replies stream to your chat; a node that is not running gets
it when it next starts. After the run, `ork chat` resumes the node's own
session, so it remembers what it did, and `ork logs` shows the exchange. Only
leaders and workers have sessions to talk to, and a session whose worktree was
merged and removed cannot be resumed.

## Pick a run up again

```sh
ork resume 3f2a                    # continue a run that didn't succeed
ork resume 3f2a --input pr=128     # with one input changed
ork resume 3f2a --detach           # in the background; answer with ork attach or ork decide
```

Nodes that finished keep their results and do not run again, even when they
finished in an earlier resume, so you do not pay for them twice; the node that
failed or was cut off runs again, and so does everything after it. A node cut
off mid-session (you stopped the run, it crashed, or the budget ran out)
continues the session it had, so its earlier turns are not paid for again. A
question left open when the run stopped is asked again. The run keeps its id,
its inputs and its flags, and picks up the worktrees it left. It reads the
workflow file again, so you can fix a step before resuming. A run that ran out
of budget counts what it already spent: raise `limits.budgetUsd` (or
`limits.budgetTokens`) first.

## One node on its own

```sh
ork run software-factory --node spec --input feature="export to CSV" --in-place
```

`--node` runs a single `agent.leader` or `agent.worker` session and prints its
report: status, summary, branch, artifacts, its `output.schema` fields and
usage. It is handy for working on one node's prompt.

- It sets up no worktrees, so a `worktree` node needs `--in-place`.
- Templates that read other nodes (`{{nodes.*}}`) render empty, with a warning.
- The exit code is 0 for `pass`, `done` or `changes_requested`, and 1 for `fail`
  or no valid report.
- `ork stop` stops it; `ork pause`, `ork continue` and `ork stop --node` don't
  apply to it.
