# Decisions and stopping

_Part of [The ork CLI](../cli.md)._

([control.ts](../../packages/cli/src/commands/control.ts),
[tests](../../packages/cli/test/control.test.ts),
[documents](../../packages/cli/test/decide-document.test.ts))

- **`ork decide`** lists the open decisions of this project's live runs (`<run>`
  for one run, `--project all` or a project id), oldest first, and asks each in
  turn with the same picker as the terminal; the recommended option is the
  default. The answer goes to the store, first one wins, and the run is woken on
  its socket. `--list` (or no terminal) only lists them, with `--json`, `--ids`,
  `--limit` ([filters](./list-filters.md#the-lists));
  `--id <decision> --choose <option>` answers one without a prompt. A decision
  id given where the run goes (`ork decide <decision-id> accept`) is refused
  with
  `<id> is a decision id, not a run: answer it with ork decide --id <id> --choose <option>`
  when it matches a pending decision, and says `No run …` otherwise.
  `--say <text>` gives that answer its [note](../messaging.md#decisions), which
  goes to the run, and asking in turn offers the note line after each choice.
  `--note` and `--rating` keep their meaning: feedback on the decision's node
  ([feedback](../feedback/capture.md)), not words for the run. An option that is
  not one of the decision's, or a decision already answered or withdrawn, is
  refused with the reason. Decisions of crashed runs are not listed. A program
  or an agent in a run (`ORK_RUN` or `ORK_SESSION` is set) may list them but not
  answer in a guarded store (it speaks as the user); `ork continue` refuses
  there too, and `ork ui` withholds its sign-in link
  ([L80](../messaging/scripts-limits.md)). `--workflow <name>` keeps only the
  decisions of that workflow's live runs, ANDed with `<run>` (or the project, or
  `--project all`), for `--list`, `--json` and asking in turn; a workflow with
  none lists none and says so. `--list` marks a decision with a document
  `+document`. Asking in turn (and the run's own terminal) prints a
  [document](../messaging.md#decisions) of 40 lines or fewer before the question
  and otherwise says `Document: N lines. Type d to read it.`; `d` at the choose
  prompt prints it and asks again, and an option whose id is `d` wins. Output is
  the Markdown source. `--id <decision> --document` prints that decision's
  document, open or settled, and exits 0, or says it has none and exits 1; it
  only reads, so a run's process may use it.
- **`ork decide --follow`** (alias `--watch`;
  [code](../../packages/cli/src/runs/follow-decisions.ts),
  [tests](../../packages/cli/test/decide-follow.test.ts),
  [many-runs test](../../packages/cli/test/decide-follow-many.test.ts), on a
  pty) asks the decisions open now, then each one as it opens, one card at a
  time, on one terminal, for every live run in scope, a called run and a run
  that starts later included ([following many runs](../scheduler/calls.md)). The
  card names the run and its workflow (`run <id> · <workflow>`), also on plain
  output. Each run is followed apart, so decisions reach it in poll order: one
  that arrives while a card is up is held, and when the card settles the
  earliest opened (the store's order) of those held and still open is asked
  next; with no card up, the first to arrive is asked at once. A decision
  answered elsewhere (`ork ui`, `ork attach`, another `ork decide`) withdraws
  its card, or leaves the held ones at once, and prints
  `<id> answered elsewhere: <answer> (<by>)`, as `ork attach` does, before the
  next card starts. The held queue is in
  [prompts.ts](../../packages/cli/src/runs/prompts.ts), so `ork attach` orders
  the decisions of the runs it called the same way; a held decision that is no
  longer open is dropped unasked. The answer is `by: "decide"`. `q` ("later")
  leaves a decision open and not asked again until the next `--follow`. `<run>`,
  `--workflow` and `--project` narrow what is watched as they narrow the list.
  Ctrl-C ends it with exit 0 and closes no decision, saying
  `stopped following; N decision(s) still open`; `--until-idle` ends it with
  exit 0 and `no live runs` once no live run is left in scope and no card or
  held decision is in flight. Refused, one line each: no terminal
  (`--follow needs a terminal to answer on; ork decide --list shows what is open.`;
  [`decideRefusal`](../../packages/cli/src/commands/in-a-run.ts) in a run);
  `--list`, `--json`, `--ids`, `--limit`, `--id`, `--choose`, `--document`,
  `--say`, `--note` or `--rating` with it
  (`--follow asks decisions as they open; it can't go with --list, ….`); and
  `--until-idle` without `--follow` (`--until-idle goes with --follow.`). Its
  stop aborts the prompts at once: the `parked(signal)` helper of
  [human.ts](../../packages/cli/src/human.ts) rejects on a signal already
  aborted, so a prompt that parks after the Ctrl-C ends too. Ctrl-C on a real
  terminal ends it, and `logs -f --all`, with exit 0
  ([test](../../packages/cli/test/follow-ctrl-c.test.ts), run on a pty with
  `script`). And `pendingDecisions` drops the decisions of finished runs, so the
  `still open` count also includes decisions asked here that the store still
  holds open.
- **`ork chat <run> <node>`**
  ([chat.ts](../../packages/cli/src/commands/chat.ts),
  [tests](../../packages/cli/test/chat.test.ts)) talks to a leader or worker;
  any other node is refused, and so is a program or an agent in a run (`ORK_RUN`
  or `ORK_SESSION` is set) in a guarded store, since it speaks as the user
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
  running is refused with its status. It then prints the end as the run's own
  summary does: `✓` succeeded, `✗` failed or crashed, a yellow `!` for any other
  end (`interrupted`). **`--node <n>`** stops one running node instead: it
  fails, `stopped by the user`, and the run goes on. A stop reaches the runs a
  [`workflow.call`](../scheduler/calls.md) started.
- **`ork pause [<run>] [--node <n>]`** and
  **`ork continue [<run>] [--node <n>]`**
  ([pause.ts](../../packages/cli/src/commands/pause.ts)) pause a live run, or
  one node, and let it go on: nothing new starts, and a running session waits
  before its next tool call; nothing is cut short
  ([run control](../run-control.md)). `ork ps` shows `paused`, and `ork tree`
  marks each held node. A run whose command waits for a machine-wide slot reads
  `waiting for slot` in `ork ps` ([machine](../machine.md#a-wait-is-shown)); a
  run whose node waits for a `lock:` reads
  `waiting for <lock>, held by <run>/<node>`, in `ork tree`'s header too, where
  each waiting node's row reads `waiting for <lock>`
  ([listedStatus](../../packages/cli/src/runs/format.ts),
  [integration](../integration.md#a-wait-is-shown)).
