# Running workflows

`ork run` runs a workflow on your machine and streams what happens to your
terminal. The command contract is the
[CLI spec](../../specs/cli.md#running-a-workflow).

## A whole workflow

```sh
ork run software-factory --input feature="export to CSV"
ork run path/to/review.ork.yaml --driver cli
```

The workflow is a path, or the name of a file in `.ork/workflows/`. Before
anything starts, Ork checks the workflow, its inputs, and (when it has
`worktree` nodes) your checkout. Any error stops it there.

| Option              | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `--input k=v`       | a workflow input; repeat it for each one                        |
| `--driver sdk\|cli` | overrides the workflow's and each node's driver                 |
| `--in-place`        | runs every node in your checkout, without worktrees             |
| `--allow-dirty`     | runs although instructions or skills have uncommitted changes   |
| `--json`            | prints every run event as a JSON line instead of the transcript |

## Reading the transcript

Each line starts with the node's id. A shortened example:

```
▸ run 5e0c9b2a of csv-export (starts at builder)
builder │ claude.leader
builder │ ⎇ created ork/5e0c9b2a/builder
builder │ opus, session 3f1c9a…
builder │ Splitting this into the exporter and its tests.
builder │ · mcp__ork__delegate {"tasks":[{"child":"tests","brief":"…"}]}
tests   │ claude.worker, for builder
tests   │ ⎇ created ork/5e0c9b2a/tests
tests   │ · Write file_path: test/csv.test.ts
tests   │ ✓ pass: 6 tests for the CSV exporter · $0.4120
tests   │ ⎇ merged ork/5e0c9b2a/tests (into ork/5e0c9b2a/builder)
builder │ ✓ pass: CSV export added, tests pass · $1.2034

✓ run 5e0c9b2a succeeded · $1.6154 · 2 ran, 0 skipped
  builder: ork/5e0c9b2a/builder at ../my-app-worktrees/ork-5e0c9b2a-builder (the run's result)
```

You see when each node starts (with its round in a loop, and its owner when it
was delegated to), what its session says, every tool call, worktree changes, and
each result. At the end comes the run summary: the status, the total cost, how
many nodes ran and were skipped, the worktrees left for you, and the reasons it
did not succeed.

The exit code is 0 when the run succeeded and 1 otherwise, so `ork run` works in
scripts. Ctrl-C stops the run and its sessions.

## Answering questions

Four things can ask you something during a run:

- A **gate** (`human.gate`) in the workflow.
- An agent calling **`ask_user`** when it needs a decision.
- A **permission** prompt when an agent wants a tool that is not pre-approved.
- A **loop** that used all its rounds: stop, one more round, or go on (asked of
  the leader that owns the loop instead, while it is working).

For a question, the options are listed with the recommended one marked: press
Enter to take it, or type a number or an option's id. For a permission, the
prompt shows the tool and a preview of its input; type `y` to allow it, anything
else denies it.

You can also answer from **any other terminal** with `ork decide`: it lists the
open questions of this project's running runs and asks them in turn. Whichever
answers first wins; the other prompt goes away, and the transcript says who
answered.

```sh
ork decide                          # answer them one by one
ork decide --list                   # just look
ork decide --id 3f2a91c0-1 --choose ship
```

When nobody is at the terminal (stdin is not a TTY, as in CI), tools are denied,
questions take their recommended option, and a gate with a `timeout` takes its
`default`.

## In the background

```sh
ork run release --detach        # prints the run id and returns
ork logs 3f2a -f                # watch it live
ork decide                      # its questions wait here
ork stop 3f2a                   # stop it from anywhere
```

A detached run has no terminal, so its questions wait for `ork decide` (a gate
with a `timeout` still takes its `default`). Its own output goes to
`.ork/runs/<run>/output.log`. `ork stop` works on any running run, detached or
not, as Ctrl-C does in its terminal.

## One node on its own

```sh
ork run software-factory --node spec --input feature="export to CSV" --in-place
```

`--node` runs a single `claude.leader` or `claude.worker` session and prints its
report: status, summary, branch, artifacts, its `output.schema` fields and
usage. It is handy for working on one node's prompt.

- It sets up no worktrees, so a `worktree` node needs `--in-place`.
- Templates that read other nodes (`{{nodes.*}}`) render empty, with a warning.
- The exit code is 0 for `pass`, `done` or `changes_requested`, and 1 for `fail`
  or no valid report.

## What a run leaves behind

- Branches `ork/<run>/<node>`, and worktrees beside your clone for the results
  ([Worktrees](./worktrees.md)).
- Run state under `.ork/runs/<run>/`, gitignored: long tool output, the per-node
  plugins Ork builds for skills, and `events.jsonl`, a copy of the run's events.
- The run's record in `~/.ork/state.db`, with secrets masked.

## Look back at runs

```sh
ork ps                 # this project's runs, newest first (--all: every project)
ork logs               # the newest run's transcript; or ork logs <run-id>
ork logs 3f2a -f       # follow a run that is still going, by an id prefix
ork logs --node review # one node's events
ork tree               # the ownership tree: each node's state, tokens and cost
```

A run whose process died without finishing shows as `crashed`. Details:
[Event store](../../specs/event-store.md).

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

Coming later in M1d: `ork resume`.
