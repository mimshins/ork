# During and after a run

_Part of [Troubleshooting](../troubleshooting.md)._

## During a run

**A run shows as `crashed`.** Its process ended without finishing (a closed
terminal, a reboot), even if another process has since been given its id.
Continue it; what finished keeps its result, and the rest runs again:

```sh
ork resume <run>
```

**Answers and commands take a second to land.** `ork doctor` warns when your
home folder's path is so long that a run's socket can't fit (103 bytes on macOS,
107 on Linux). Runs still work, reading the store once a second; a shorter home
folder path makes them instant again.

**A run seems stuck.** It may be waiting on a question. Look at the open ones,
and at where the run stopped (`? asks: …`); stop it if you want it to end:

```sh
ork decide --list
ork logs <run>
ork attach <run>
ork stop <run>
```

A detached run always waits for `ork attach`, `ork decide` or the Decisions
panel in `ork ui`. So does a run that a detached run called. A foreground run
asks the questions of the runs it calls on its own terminal, unless stdin is not
a terminal. `ork attach` shows the whole tree and asks all of it; Ctrl-C there
leaves the run going.

**`ork chat`, `ork continue`, `ork attach` or `ork decide --choose` is refused
"inside a run", in your own terminal.** That shell inherited a run's variables
from a program the run started, such as a tmux server. Open a new shell
([scripts](../scripts.md#know-where-it-is-running)).

**A loop used all its rounds.** Ork asks whether to stop (recommended), allow
one more round, or carry on along the other edges
([loops](../writing-workflows.md#loops)). Raise `maxRounds` if it happens often,
or tighten what the reviewers ask for.

**A message was not sent.** `send_message` reaches only a node's owner, the
nodes it owns, and its channels; the refusal lists whom it can reach. Add a
`messages` channel to the workflow to connect two others.

**A node fails and I don't know why.** Its line says a kind and a message, for
example `✗ Turn limit: reached its turn limit (8)`. Every kind, who acts on it
and what to do is in [why a node stopped](../why-a-node-stopped.md). The raw
tool or provider text is behind `ork run --verbose`, or
`ork logs <run> --node <id>`.

**A node fails as `Turn limit` or `Budget limit`.** It used all of its
`maxTurns` or `budgetUsd`. Raise the limit, or narrow the node's brief
([turn limit](../why-a-node-stopped.md#turn-limit),
[budget limit](../why-a-node-stopped.md#budget-limit)).

**The run ends `budget_exhausted`.** `limits.budgetUsd` is spent; no new session
starts. Raise it, or use cheaper models for checks
([models, effort and budgets](../models-and-budgets.md)).

**A node fails as `Timed out`, or the run ends `timed_out`.** It used all of its
`timeout`; time waiting on you doesn't count. Raise it, or handle it with
`when: timedOut` ([timeouts](../models-and-budgets.md#timeouts)). `ork resume`
continues a run that timed out.

**A node fails because a git hook refused its commit.** Ork commits each node's
work with your repository's hooks. The node's message shows the hook's output,
and its worktree keeps the changes so you can fix them by hand.

**A merge conflict.** A child's branch conflicted with its owner's. The merge is
aborted, the owner is told, and the child's worktree stays: merge it yourself,
or let the owner redo the work.

**Tools are denied, or questions answer themselves.** Nobody is at the terminal
(for example in CI): tools that need permission are denied, questions take their
recommended option. Pre-approve tools with the node's `tools.allow`, or run in a
terminal.

**An agent can't use an MCP server you use with `claude`, or doesn't know what
Claude remembers about the project.** A run's sessions start clean of your
machine's MCP servers and Claude's memory. Start the run with
`ork run --machine-claude` to load them
([what a session loads](../running-workflows/running-and-answering.md#what-a-session-loads)).

## After a run

**Lots of `ork/` branches and worktrees.** List them, then remove the merged
ones; `--all` takes the rest too, and `--branches` deletes the branches
([cleaning up](../worktrees.md#cleaning-up)):

```sh
ork worktrees
ork worktrees clean
```

**`ork worktrees clean` skips a worktree.** "its run is still going": stop the
run first. "checked out in <path>": you have that branch checked out in a
worktree of your own; switch it to another branch there.

**`ork feedback publish` fails.** It posts with your own `gh`. Log in first:

```sh
gh auth login
```

**I can't find the result.** It is on the root node's branch,
`ork/<run>/<node>`, in a worktree beside your clone; the run summary prints the
path. Ork never merges into your branch and never pushes.
