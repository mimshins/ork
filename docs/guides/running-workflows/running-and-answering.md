# Running a workflow and answering it

_Part of [Running workflows](../running-workflows.md)._

## A whole workflow

```sh
ork run software-factory --input feature="export to CSV"
ork run path/to/review.ork.yaml --driver claude-code
```

The workflow is a path, the name of a file in `.ork/workflows/`, or one of Ork's
own, such as `ork:feedback-apply` ([feedback](../feedback.md#asking-for-a-fix)).
Before anything starts, Ork checks the workflow, its inputs, and (when it has
`worktree` nodes) your checkout. Any error stops it there.

| Option             | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `--input k=v`      | a workflow input; repeat it for each one                        |
| `--driver <id>`    | overrides the workflow's and each node's driver                 |
| `--in-place`       | runs every node in your checkout, without worktrees             |
| `--allow-dirty`    | runs although instructions or skills have uncommitted changes   |
| `--machine-claude` | sessions load your MCP servers and Claude's memory (see below)  |
| `--json`           | prints every run event as a JSON line instead of the transcript |

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

When an agent needs an MCP server (a browser, say), define it in your project's
`.mcp.json` and name it on the node, or on `defaults`, with no credential in the
file (use `${VAR}`):

```yaml
design:
  type: agent.worker
  prompt: Check the page in a browser.
  mcp: [chrome-devtools]
```

Only the servers a node names load, beside Ork's, and their tools need no
approval (a `deny` rule still wins). `mcp: []` turns the defaults off for a
node. `ork validate` reports a name `.mcp.json` doesn't have.

When a run needs all of your machine's setup, start it with `--machine-claude`:
its sessions load your MCP servers and Claude's memory as `claude` would. The
run remembers it: `ork resume`, `ork chat` and the runs it calls with
`workflow.call` load them too, and `ork resume` has no flag for it. In the
browser view it is the "Use this machine's Claude setup" box.

## Reading the transcript

On a terminal each event starts with a chip for its node, a different color per
node and the same on every line; a tool call is one short line,
`Bash  first line`, with `+N lines` when it had more (add `--verbose` for each
call whole). A path inside the node's worktree shows relative to it, and the
agent's words wrap under a hanging indent. A shortened example, as you see it
with `--plain`, in a pipe or with `NO_COLOR`, where each line starts with the
node's id instead of a chip ([the terminal](../terminal.md)):

```
▸ run 5e0c9b2a of csv-export (starts at builder)
builder │ agent.leader
builder │ ⎇ created ork/5e0c9b2a/builder
builder │ opus, session 3f1c9a…
builder │ Splitting this into the exporter and its tests.
builder │ · mcp__ork__delegate {"tasks":[{"child":"tests","brief":"…"}]}
tests   │ agent.worker, for builder
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

The summary starts with an `OK`, `FAIL` or `WAIT` chip (`WAIT` is a run that
stopped short; its status says why).

The exit code is 0 when the run succeeded and 1 otherwise, so `ork run` works in
scripts. Ctrl-C stops the run and its sessions.

## Answering questions

Four things can ask you something during a run:

- A **gate** (`human.gate`) in the workflow.
- An agent calling **`ask_user`** when it needs a decision.
- A **permission** prompt when an agent wants a tool that is not pre-approved.
- A **loop** that used all its rounds: stop, one more round, or go on (asked of
  the leader that owns the loop instead, while it is working).

A question shows a card: an `ASK` chip, the node's chip, the question, and its
context dimmed. The options are a list with the recommended one marked and
chosen: press Enter to take it, move with ↑/↓ (or `j`/`k`, `1`–`9`, `Home`,
`End`) and press Enter to take another, `n` to add a note, `d` to read the whole
context. Once answered, the card collapses to one line. For a permission, the
prompt shows the tool and a preview of its input; press `y` to allow it, `n` or
Esc to deny it. The full key list is in [the terminal](../terminal.md). With
`--plain`, `NO_COLOR` or no terminal, a question is numbered instead: Enter
takes the recommended option, or type a number or an option's id, and a
permission asks `Allow? [y/N]`.

You can add a **note**: one line that goes to the run with your answer, such as
what to change when you answer `revise`. Press `n` before you choose (after,
with `--plain`, where Enter skips it); after a denial the note line comes up by
itself. A gate passes the note on to the next nodes as
`{{nodes.<gate>.output.note}}`, and an agent that called `ask_user` reads it
with your choice. While the note line waits, the question is still open, so
another terminal or a gate's timeout can still answer it.

You can also answer from **any other terminal** with `ork decide`: it lists the
open questions of this project's running runs and asks them in turn, each as the
card above (`n of m` says where you are). `q` or Esc leaves a question for
later, and `--verbose` shows each question's whole context. Whichever answers
first wins; the other prompt goes away, and the transcript says who answered.
`ork attach <run>` asks them for one run and the runs it called
([attaching to a run](./attaching-to-a-run.md)).

```sh
ork decide                          # answer them one by one
ork decide --list                   # just look
ork decide --list --workflow feature  # only that workflow's runs
ork decide --ids                    # just the ids, one line (lists, never answers)
ork decide --id 3f2a91c0-1 --document # read the document of a gate
ork decide --id 3f2a91c0-1 --choose ship
ork decide --id 3f2a91c0-1 --choose revise --say "Split the API section in two"
ork decide --id 3f2a91c0-1 --choose ship --note "Missed a test" --rating bad
```

`--say` gives the answer its note, which goes to the run. `--note` is different:
with `--rating`, it notes how that node went, as [feedback](../feedback.md), and
the run never sees it.

A gate can give a **document** to read beside its question, such as a whole
spec. On a terminal, press `d` to read it, then answer. With `--plain` or no
terminal, a document of 40 lines or fewer is printed before the question, and a
longer one is offered instead: `Document: 120 lines. Type d to read it.` Type
`d` at the prompt to read it, then answer. It stays plain text in a terminal,
and `--list` marks these decisions `+document`.

`--workflow <name>` keeps only that workflow's decisions, with a run id too if
you give one. A permission's command shows as you would run it, up to 4,000
characters.

In the **Decisions panel** of `ork ui`, a decision reads as Markdown: headings,
lists, code blocks with a copy button, and links. Text past about 20 lines folds
behind **Show all**, with your choices and the note box still in view. A gate's
document opens from **Read document** in its own dialog; `Escape` closes it. The
panel can filter by workflow and by run, with a count on each choice, and
remembers your choice in this browser. A run in the Monitor with open decisions
has a control that opens them, filtered to that run. See
[the browser view](../browser-view/panels-and-workspace.md).

When nobody is at the terminal (stdin is not a TTY, as in CI), tools are denied,
questions take their recommended option, and a gate with a `timeout` takes its
`default`.

## In the background

```sh
ork run release --detach        # prints the run id and returns
ork attach 3f2a                 # follow it here and answer its questions
ork logs 3f2a -f                # or only watch it live
ork decide                      # its questions wait here too
ork stop 3f2a                   # stop it from anywhere
```

A detached run has no terminal, so its questions wait for `ork attach` or
`ork decide` (a gate with a `timeout` still takes its `default`).
[`ork attach`](./attaching-to-a-run.md) also follows the runs it called. Its own
output goes to `.ork/runs/<run>/output.log`. `ork stop` works on any running
run, detached or not, as Ctrl-C does in its terminal.
