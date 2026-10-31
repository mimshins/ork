# Running and runs

_Part of [The ork CLI](../cli.md)._

## Running a workflow

`ork run <wf>` runs the whole workflow through the [scheduler](../scheduler.md)
with the built-in node types
([workflow.ts](../../packages/cli/src/run/workflow.ts)):

- The workflow and its inputs are checked as for `--node`; nothing starts on an
  error.
- `worktree` Claude nodes get their own worktree beside the clone, and the run
  first checks the project ([worktrees](../worktrees.md#before-the-run)):
  uncommitted instructions or skills stop it unless `--allow-dirty`.
  `--in-place` runs every node in this checkout instead.
- stdout gets one transcript line per event, prefixed with the node id
  (`builder │ …`): each start (with its round), session text and tool calls,
  each result (`✓ pass: …`, `✓ exit 0`, `✓ merge (user)`), skips and exhausted
  loops, and worktree changes (`⎇ created …`, `merged`, `removed`); then the run
  summary: status, total cost, how many nodes ran and were skipped, the
  worktrees left for you (branch, path, why), and the reasons it did not
  succeed. `--json` prints the [run events](../scheduler.md#run-events) as JSON
  lines.
- Integrations are optional: before anything starts, Ork checks only the
  programs the workflow's tool nodes run (`gh` for `tool.gh`, `aws` for
  `tool.aws`, a `tool.shell` command's first word unless it is a template) and
  refuses to start, naming the nodes, when one is not installed.
- Every event is recorded in the [event store](../event-store.md) before it is
  printed; `ork ps`, `ork logs` and `ork tree` read it back.
- Tool nodes run as declared (their `allow` list is checked first); gates and
  questions use the terminal channel below.
- Exit code 0 when the run succeeded, 1 otherwise. Ctrl-C interrupts the run.
- `--detach` starts the same run in the background with no terminal and prints
  its id once it is recorded; its output goes to `.ork/runs/<run>/output.log`
  and its questions wait for `ork decide`. Follow it with `ork logs <run> -f`.
  Works with `--node` too.

## Running one node

`ork run <wf> --node <id>` runs one Claude node on its own
([run.ts](../../packages/cli/src/commands/run.ts)):

- `<wf>` is a path, or the name of a workflow in `.ork/workflows/` (`hello` is
  `.ork/workflows/hello.ork.yaml`).
- The workflow must validate, `--input name=value` (repeatable) must satisfy its
  inputs, and the node must be a `claude.leader` or `claude.worker`. Nothing
  starts otherwise; the errors go to stderr and the exit code is 1.
- The session spec comes from `planNodeSession`
  ([plan.ts](../../packages/core/src/run/plan.ts)). A brief that reads
  `{{nodes.*}}` renders empty and prints a warning. A run of one node sets up no
  worktree, so a `worktree` node needs `--in-place`; `readonly` denies the write
  tools.
- `--driver` overrides the node's and the workflow's driver. The drivers load
  only when a run starts.
- stdout gets the transcript (session start, assistant text, one line per tool
  call, failed tool results) and then the report: status, summary, branch,
  artifacts, the `output.schema` fields, and usage (cost, tokens, turns, time).
  `--json` prints the runtime events as JSON lines instead.
- Exit code 0 when the node reports `pass`, `done` or `changes_requested`; 1 on
  `fail` or no valid report. Ctrl-C interrupts the session.

### Questions and permissions on the terminal

Every question is a decision in the store ([messaging](../messaging.md)); the
run's terminal ([human.ts](../../packages/cli/src/human.ts)) answers it on
stderr, one prompt at a time, unless `ork decide` in another terminal answers
first (then the prompt is withdrawn and the transcript shows
`→ <answer> (ork decide)`):

- `ask_user` lists the options with the recommended one marked; Enter takes the
  recommended option, and a number or an option id picks one. An invalid answer
  asks again.
- A permission prompt shows the tool and a one-line preview of its input and
  asks `Allow? [y/N]`; anything but `y` denies it.
- Without a terminal (stdin is not a TTY), tools are denied and a question gets
  the recommended option, or tells the node to use its judgment and say so in
  its report.

## Runs

`ork ps`, `ork logs` and `ork tree` read the runs every project recorded; see
[Event store: reading runs](../event-store.md#reading-runs). A run of one node
(`--node`) is recorded too, as a run with that one node.

## Decisions and stopping

([control.ts](../../packages/cli/src/commands/control.ts),
[tests](../../packages/cli/test/control.test.ts))

- **`ork decide`** lists the open decisions of this project's live runs (`<run>`
  for one run, `--all` for every project), oldest first, and asks each in turn
  with the same picker as the terminal; the recommended option is the default.
  The answer goes to the store, first one wins, and the run is woken on its
  socket. `--list` (or no terminal) only lists them, `--json` prints them, and
  `--id <decision> --choose <option>` answers one without a prompt. An option
  that is not one of the decision's, or a decision already answered or
  withdrawn, is refused with the reason. Decisions of crashed runs are not
  listed.
- **`ork chat <run> <node>`**
  ([chat.ts](../../packages/cli/src/commands/chat.ts),
  [tests](../../packages/cli/test/chat.test.ts)) talks to a leader or worker;
  any other node is refused. Each line typed is a message (`-m <text>` sends one
  and exits; Ctrl-D leaves):
  - **In a live run**, the message goes to the store and the run is woken; the
    run's bus pushes it in full into the node's session at its next step, or
    keeps it for the node's next session if it is not running
    ([messaging](../messaging.md#chat)). The node's events stream back until the
    run ends.
  - **In a finished run** (or a crashed one), its last session is resumed where
    it ran, with the run's skills and instructions, the driver it ran with
    (`--driver` to change it), and the terminal for questions and permissions.
    The exchange is added to the run's record after `run.finished`, so
    `ork logs` shows it. A session whose folder is gone (a merged worktree is
    removed) cannot be resumed, and says so.
- **`ork stop [<run>]`** asks a live run to stop (this project's newest without
  `<run>`), wakes it, and waits up to 15 s for it to end; a run that is not
  running is refused with its status.

## Resuming a run

`ork resume [<run>]` ([control.ts](../../packages/cli/src/commands/control.ts),
[tests](../../packages/cli/test/resume.test.ts)) continues a run that is not
running and did not succeed (stopped, failed, out of budget, or crashed), under
the same id and in its own project, from wherever it is called:

- Nodes that finished keep their results; the rest run again, with what they
  feed ([scheduler](../scheduler.md#resuming-a-run)). The transcript starts with
  `▸ resumed: … keep their results`.
- It starts with the run's inputs and flags; `--input`, `--driver` and
  `--in-place` change them. The project checks of `ork run` apply
  (`--allow-dirty`).
- A running run, a succeeded one, and a run of one node (`ork run --node`) are
  refused with the reason.
