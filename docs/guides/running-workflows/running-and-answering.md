# Running a workflow and answering it

_Part of [Running workflows](../running-workflows.md)._

## A whole workflow

```sh
ork run software-factory --input feature="export to CSV"
ork run path/to/review.ork.yaml --driver cli
```

The workflow is a path, the name of a file in `.ork/workflows/`, or one of Ork's
own, such as `ork:feedback-apply` ([feedback](../feedback.md#asking-for-a-fix)).
Before anything starts, Ork checks the workflow, its inputs, and (when it has
`worktree` nodes) your checkout. Any error stops it there.

| Option              | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `--input k=v`       | a workflow input; repeat it for each one                        |
| `--driver sdk\|cli` | overrides the workflow's and each node's driver                 |
| `--in-place`        | runs every node in your checkout, without worktrees             |
| `--allow-dirty`     | runs although instructions or skills have uncommitted changes   |
| `--machine-claude`  | sessions load your MCP servers and Claude's memory (see below)  |
| `--json`            | prints every run event as a JSON line instead of the transcript |

### What a session loads

Each agent's Claude session loads your repository's setup: `CLAUDE.md`,
`AGENTS.md`, and the agents, skills and settings in `.claude/`, with Ork's own
skills and context. It starts clean of the rest of your machine's Claude setup:

- **No MCP servers but Ork's.** The servers in your `~/.claude.json`, those you
  added for the folder, and a project's `.mcp.json` don't load. A server that
  fails or reconnects mid-session makes Claude write its prompt cache again,
  which can cost several times the work itself.
- **No Claude memory.** Claude Code's auto-memory for the folder (your own notes
  in `~/.claude/projects/<folder>/memory/`) stays out of the run.
- Your user-level `~/.claude` settings never load.

When a run needs one of your MCP servers (a browser, say), start it with
`--machine-claude`: its sessions load your MCP servers and Claude's memory as
`claude` would. The run remembers it: `ork resume`, `ork chat` and the runs it
calls with `workflow.call` load them too, and `ork resume` has no flag for it.
In the browser view it is the "Use this machine's Claude setup" box.

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
many nodes ran and were skipped, how many failures an edge handled, the
worktrees left for you, and the reasons it did not succeed. A run that skipped
nodes or handled a failure still `succeeded`; the counts say what it left out. A
warning names each node that never ran but had messages waiting, which nobody
read.

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

After a choice (or a denial), you can add a **note**: one line that goes to the
run with your answer, such as what to change when you answer `revise`. Press
Enter to skip it. A gate passes the note on to the next nodes as
`{{nodes.<gate>.output.note}}`, and an agent that called `ask_user` reads it
with your choice. While the note line waits, the question is still open, so
another terminal or a gate's timeout can still answer it.

You can also answer from **any other terminal** with `ork decide`: it lists the
open questions of this project's running runs and asks them in turn. Whichever
answers first wins; the other prompt goes away, and the transcript says who
answered.

```sh
ork decide                          # answer them one by one
ork decide --list                   # just look
ork decide --id 3f2a91c0-1 --choose ship
ork decide --id 3f2a91c0-1 --choose revise --say "Split the API section in two"
ork decide --id 3f2a91c0-1 --choose ship --note "Missed a test" --rating bad
```

`--say` gives the answer its note, which goes to the run. `--note` is different:
with `--rating`, it notes how that node went, as [feedback](../feedback.md), and
the run never sees it.

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
