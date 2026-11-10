# Running and runs

_Part of [The ork CLI](../cli.md)._

Status: **Built.** For nodes with `forEach`
([RFC-013](../../rfcs/archived/RFC-013-for-each.md)) the transcript, `ork logs`
and `ork tree` show items
([tests](../../packages/cli/test/for-each-runs.test.ts)); `ork run --node` on a
node with `from:` is refused ([below](#running-one-node)).

## Running a workflow

`ork run <wf>` runs the whole workflow through the [scheduler](../scheduler.md)
with the built-in node types
([workflow.ts](../../packages/cli/src/run/workflow.ts)):

- **Ork's own workflows:** `<wf>` can be `ork:<name>`, one of the workflows Ork
  ships ([sources](../../packages/core/workflows/),
  [ADR-059](../../decisions/ADR-059-closing-the-feedback-loop.md)), such as
  `ork:feedback-apply`. Ork writes it into the project's gitignored run folder,
  `.ork/runs/.builtin/<hash of its text>/<name>.ork.yaml`, and runs that file,
  so the run belongs to the project and resumes from the text it started with.
  `validate` and `context explain` take the name too; an unknown one is refused,
  naming the built-ins.
- The workflow and its inputs are checked as for `--node`; nothing starts on an
  error, and warnings print before it starts, with what
  [walking it](../scheduler/walking.md) found. `ork resume` doesn't walk.
- `worktree` Claude nodes get their own worktree beside the clone, and the run
  first checks the project ([worktrees](../worktrees.md#before-the-run)):
  uncommitted instructions or skills stop it unless `--allow-dirty`.
  `--in-place` runs every node in this checkout instead.
- stdout gets one transcript line per event, prefixed with the node id
  (`builder │ …`): each start (with its round), session text and tool calls,
  each result (`✓ pass: …`, `✓ exit 0`, `✓ merge (user)`; a node that failed
  reads `✗ fail` whatever its report said, and a child that did not merge reads
  `! pass, merge conflict`), skips and exhausted loops, worktree changes
  (`⎇ created …`, `merged`, `removed worktree of <branch> (branch kept)`), the
  line for a question (`decision <id>; answer here or with ork decide` when this
  terminal answers, `ork decide` when none does; a detached run prints one line
  saying its terminal is off), and a fanned node's list in plain words
  (`build │ 5 items`, or `! 12 items, over maxItems 10`; an item's lines carry
  its id, `build.2`); then the run summary: status, total cost, how many nodes
  ran and were skipped, how many failures an edge handled
  (`2 ran, 1 skipped, 1 failure handled`), the worktrees left for you (branch,
  path, why), the reasons it did not succeed, and a warning for each node that
  never ran with messages nobody read. `--json` prints the
  [run events](../scheduler/resuming-and-events.md#run-events) as JSON lines.
- Integrations are optional: before anything starts, Ork checks only the
  programs the workflow's tool nodes run (`gh` for `tool.gh`, `aws` for
  `tool.aws`, `git` for `tool.git`, a `tool.shell` command's first word unless
  it is a template) and refuses to start, naming the nodes, when one is not
  installed. A relative path isn't checked
  ([L98](../messaging/scripts-limits.md)).
- **The driver:** a session node that names no driver, when `--driver` isn't
  given, takes the one ready on this machine, from `ork doctor`'s own checks
  (today `claude-code`, the only one built). The run says so in one line on
  stderr before it starts, records it for `ork resume`, and doesn't start when
  none is ready, with `ork doctor`'s hints
  ([which driver](../runtime.md#which-driver-a-session-uses)).
- **The machine's Claude setup:** sessions start clean of the machine's MCP
  servers and Claude Code's auto-memory; `--machine-claude` loads them for this
  run, which records it for `ork resume`, `ork chat` and the runs it calls
  ([what a session loads](../runtime.md#what-a-session-loads)).
- Every event is recorded in the [event store](../event-store.md) before it is
  printed; `ork ps`, `ork logs` and `ork tree` read it back.
- Tool nodes run as declared (their `allow` list is checked first); gates and
  questions use the terminal channel below.
- Exit code 0 when the run succeeded, 1 otherwise. Ctrl-C interrupts the run, at
  a question's prompt too.
- `--detach` starts the same run in the background with no terminal and prints
  its id once it is recorded; its output goes to `.ork/runs/<run>/output.log`
  and its questions wait for `ork decide`. Follow it with `ork logs <run> -f`.
  Works with `--node` too.
- A [`workflow.call`](../scheduler/calls.md) starts its run this way, with three
  internal flags: `--called-by`, `--budget-cap` and `--base-ref`, and
  `--machine-claude` when the caller has it. The caller's transcript shows
  `↳ started <workflow> as run <id>`.

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
- A node with `forEach` runs once, with no item, and says so on stderr: a run of
  one node does not fan out. With `forEach.from` it fails instead, naming the
  list's source, since the node that reports the list is not run; give the node
  `items` of its own, or run the whole workflow.
- `--driver` overrides the node's and the workflow's driver. A node that names
  none takes the one ready here, said in one line, and none ready stops it
  before the session starts
  ([which driver](../runtime.md#which-driver-a-session-uses)). The drivers load
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
  asks again. Then `Note for the run (optional, Enter to skip):` takes one line,
  the answer's [note](../messaging.md#decisions); while it waits the decision is
  still open, so `ork decide`, the UI or a gate's timeout can still answer it.
- A permission prompt shows the tool and a one-line preview of its input and
  asks `Allow? [y/N]`; anything but `y` denies it, and a denial takes the same
  optional note line, which the session reads with the denial.
- Without a terminal (stdin is not a TTY), tools are denied and a question gets
  the recommended option, or tells the node to use its judgment and say so in
  its report.

## Runs

`ork ps`, `ork logs` and `ork tree` read the runs every project recorded; see
[Event store: reading runs](../event-store.md#reading-runs). A run of one node
(`--node`) is recorded too, as a run with that one node.

For a node with `forEach`, `ork tree` lists its items under it, in list order,
each with its state, time and cost, and `--json` carries them as the node's
children (with `template` and `startedAt`), and the node's `listed`.
`ork logs --node` on a node or item the run never named and never declared is an
error, unless `--follow` is on a live run, which may still start it.
`ork logs --node build` keeps the node's events and its items'; `--node build.2`
keeps one item's. The same filter serves `GET /api/runs/<id>/events?node=` in
`ork ui`, and `GET /api/runs/<id>/tree` is this same nested tree.

## Decisions and stopping

([control.ts](../../packages/cli/src/commands/control.ts),
[tests](../../packages/cli/test/control.test.ts),
[documents](../../packages/cli/test/decide-document.test.ts))

- **`ork decide`** lists the open decisions of this project's live runs (`<run>`
  for one run, `--all` for every project), oldest first, and asks each in turn
  with the same picker as the terminal; the recommended option is the default.
  The answer goes to the store, first one wins, and the run is woken on its
  socket. `--list` (or no terminal) only lists them, `--json` prints them, and
  `--id <decision> --choose <option>` answers one without a prompt;
  `--say <text>` gives that answer its [note](../messaging.md#decisions), which
  goes to the run, and asking in turn offers the note line after each choice.
  `--note` and `--rating` keep their meaning: feedback on the decision's node
  ([feedback](../feedback/capture.md)), not words for the run. An option that is
  not one of the decision's, or a decision already answered or withdrawn, is
  refused with the reason. Decisions of crashed runs are not listed. A program
  or an agent in a run (`ORK_RUN` or `ORK_SESSION` is set) may list them but not
  answer, since an answer speaks as the user, and `ork continue` refuses there
  too, and `ork ui` withholds its sign-in link
  ([L80](../messaging/scripts-limits.md)). `--workflow <name>` keeps only the
  decisions of that workflow's live runs, ANDed with `<run>` (or the project, or
  `--all`), for `--list`, `--json` and asking in turn; a workflow with none
  lists none and says so. `--list` marks a decision with a document `+document`.
  Asking in turn (and the run's own terminal) prints a
  [document](../messaging.md#decisions) of 40 lines or fewer before the question
  and otherwise says `Document: N lines. Type d to read it.`; `d` at the choose
  prompt prints it and asks again, and an option whose id is `d` wins. Output is
  plain text, the Markdown source. `--id <decision> --document` prints that
  decision's document, open or settled, and exits 0, or says it has none and
  exits 1; it only reads, so a process in a run may use it.
- **`ork chat <run> <node>`**
  ([chat.ts](../../packages/cli/src/commands/chat.ts),
  [tests](../../packages/cli/test/chat.test.ts)) talks to a leader or worker;
  any other node is refused, and so is a program or an agent in a run (`ORK_RUN`
  or `ORK_SESSION` is set), since it speaks as the user
  ([L80](../messaging/scripts-limits.md)). Each line typed is a message
  (`-m <text>` sends one and exits; Ctrl-D leaves):
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
- **`ork send <to> -m <body>`** or **`--stdin`**, from a program in a tool node,
  writes to a session on its run's bus, up to 64 KiB. It prints nothing when it
  works, and exits 1 with the reason on stderr when refused
  ([scripts and rules](../messaging/scripts.md#ork-send)).
- **`ork stop [<run>]`** asks a live run to stop (this project's newest without
  `<run>`), wakes it, and waits up to 15 s for it to end; a run that is not
  running is refused with its status. **`--node <n>`** stops one running node
  instead: it fails, `stopped by the user`, and the run goes on. A stop reaches
  the runs a [`workflow.call`](../scheduler/calls.md) started.
- **`ork pause [<run>] [--node <n>]`** and
  **`ork continue [<run>] [--node <n>]`**
  ([pause.ts](../../packages/cli/src/commands/pause.ts)) pause a live run, or
  one node, and let it go on: nothing new starts, and a running session waits
  before its next tool call; nothing is cut short
  ([run control](../run-control.md)). `ork ps` shows `paused`, and `ork tree`
  marks each held node.

## Resuming a run

`ork resume [<run>]` ([control.ts](../../packages/cli/src/commands/control.ts),
[tests](../../packages/cli/test/resume.test.ts)) continues a run that is not
running and did not succeed (stopped, failed, out of budget, or crashed), under
the same id and in its own project, from wherever it is called:

- Nodes that finished keep their results; the rest run again, with what they
  feed ([scheduler](../scheduler/resuming-and-events.md#resuming-a-run)). The
  transcript starts with `▸ resumed: … keep their results`.
- A `workflow.call` takes back the runs it started rather than starting them
  again ([calling workflows](../scheduler/calls.md)).
- It starts with the run's inputs and flags; `--input`, `--driver` and
  `--in-place` change them. `--machine-claude` is kept as the run recorded it,
  with no flag to change it. The project checks of `ork run` apply
  (`--allow-dirty`).
- A running run, a succeeded one, and a run of one node (`ork run --node`) are
  refused with the reason.
- `--detach` resumes it in the background, as `ork run --detach` does
  ([detach.ts](../../packages/core/src/remote/detach.ts)): it returns once the
  background process has the run, its output goes to the run's `output.log`, and
  its questions wait for `ork decide`.
