# @krapht/ork

## 1.0.0-alpha.12

### Minor Changes

- [`b639efe`](https://github.com/mimshins/ork/commit/b639efe1b09e50d40c9376e4d9be1b7314599373) Thanks [@mimshins](https://github.com/mimshins)! - `ork attach <run>` follows a run and every run it called, at any depth, and asks
  their open questions on your terminal; Ctrl-C detaches and leaves the run going.
  A foreground `ork run` that calls workflows now does the same for the runs it
  calls, so a called run's gate (such as `start`'s plan) is answered in the
  terminal that started it. `ork run --detach` points to `ork attach` first.

- [`5f2cd36`](https://github.com/mimshins/ork/commit/5f2cd3648c652bcfa392be5beb4fcd1cd896e150) Thanks [@mimshins](https://github.com/mimshins)! - A Claude node's `model` and `effort` can be `{{item.<field>}}` on a `forEach`
  node, so each item runs on its own model. `ork validate` checks written items,
  an item from `from:` is checked when it runs, and the builder shows a templated
  `effort` as text, and `ork chat` resumes an item on its own model. `build`'s
  review now runs one Opus and two Sonnet reviewers.

### Patch Changes

- [`d6f71ce`](https://github.com/mimshins/ork/commit/d6f71ceeb2cbdef55c6623d12f5302e7233a4bb0) Thanks [@mimshins](https://github.com/mimshins)! - A `low`-priority session or tool command is lowered once, by `nice`, not twice:
  it could land at the lowest priority instead of below Ork's.

## 1.0.0-alpha.11

### Minor Changes

- [`546d0b0`](https://github.com/mimshins/ork/commit/546d0b023300934e5dfbc60af8ba5731e294f8fe) Thanks [@mimshins](https://github.com/mimshins)! - The `open-code` and `command-code` drivers are proven on real sessions and no
  longer refused; `open-code` now takes `maxTurns`. Their gate runs found and
  fixed four bugs: OpenCode worked in the main checkout instead of the node's
  worktree (it reads `PWD`, which every session now gets), and its path rules
  never matched, so every read was refused; Command Code's own print-mode gate
  refused every shell call, and Ork's mod refused reads in the worktree and the
  tool loader a session needs for Ork's `report`. `ork doctor` lists a driver
  whose tool is missing as `skip` with how to install it.

- [`537fa44`](https://github.com/mimshins/ork/commit/537fa44c7d675fdeb80f43f238bb26e1d7b599f2) Thanks [@mimshins](https://github.com/mimshins)! - Runs are lighter on your machine. A project's new `heavy` rule names its
  full-suite commands (`pnpm check`, `pnpm test`, `vitest run`): a node with
  `verify:` may no longer run them in its session, since Ork runs that check, and
  each takes one of 2 machine-wide slots (`ORK_HEAVY_SLOTS` changes the count), so
  three checks at once no longer heat the machine. A wait shows in `ork ps`, the
  logs and the browser view, and doesn't count towards a timeout. A new `priority`
  rule starts sessions and tool commands at a lower OS priority by default
  (`priority: normal` turns it off). `ork usage --by node` shows the CPU each
  node's tool commands used, and the browser view's overview no longer re-reads
  every event of every running run each second.

- [`9463d8f`](https://github.com/mimshins/ork/commit/9463d8f0d5b3c038cf2505817ab3767ba5d51140) Thanks [@mimshins](https://github.com/mimshins)! - `ork decide`, permission prompts and every yes-or-no question (`init`,
  `migrate`, `upgrade`, `worktrees`, `watch`, `feedback`, `usage`) use the
  terminal kit: `ork decide` shows a card with an ASK chip and the node's chip,
  the run and "n of m", the question wrapped, the context dimmed (`--verbose` or
  `d` shows it all), and options moved with ↑/↓, `j`/`k` or `1`–`9`, with the
  recommended one chosen; `q` leaves a question for later and the answered card
  collapses to one line. `ork decide --list` shows chips and columns, and
  `ork chat` takes its message on a line editor. Plain output (not a terminal,
  `NO_COLOR`, `--plain`) keeps the numbered prompts.

- [`9463d8f`](https://github.com/mimshins/ork/commit/9463d8f0d5b3c038cf2505817ab3767ba5d51140) Thanks [@mimshins](https://github.com/mimshins)! - A terminal kit for the CLI's output and prompts: one theme (colored chips,
  stable per-node colors), width-aware wrap and cut, and three prompts (select
  with ↑/↓, `j`/`k`, `1`–`9`, a note and a details toggle; text; yes or no) that
  redraw only their own lines and collapse to one line once answered. Every
  command takes a new global `--plain` flag (or `ORK_PLAIN=1`), like `NO_COLOR` or
  a non-terminal, for output with no color or redraw and line prompts, for screen
  readers and logs. `ork run`'s transcript and summary are the first on it: node
  chips, short tool lines (`--verbose` shows each call whole), wrapped agent text
  and `RUN`, `OK`, `FAIL` and `WAIT` chips. Other commands move onto the kit in
  the following changes.

- [`9463d8f`](https://github.com/mimshins/ork/commit/9463d8f0d5b3c038cf2505817ab3767ba5d51140) Thanks [@mimshins](https://github.com/mimshins)! - `ork ps`, `usage`, `feedback list`, `projects`, `worktrees`, `watch --status`,
  `doctor` and `validate` print on a terminal with chips for status (`OK`, `FAIL`,
  `WARN`, `SKIP`, a run's state, a project's mode), aligned columns, lines cut or
  wrapped to the screen, and dimmed, indented hints. Not a terminal, `NO_COLOR`,
  `--plain`, `ORK_PLAIN=1` and `--json` print what they always did.

### Patch Changes

- [`9ceef42`](https://github.com/mimshins/ork/commit/9ceef422e7f06f9fb95c8adcefa35b0c7e78b22a) Thanks [@mimshins](https://github.com/mimshins)! - `priority: low` now starts sessions and tool commands under `nice` (and, on
  macOS, utility QoS), so they run lower from their first instruction instead of
  being lowered just after they start.

- [`4d2be85`](https://github.com/mimshins/ork/commit/4d2be851c97df253c5c4d012284e3e2c65391128) Thanks [@mimshins](https://github.com/mimshins)! - Every node now ends as one known kind (turn limit, budget limit, timed out,
  command failed, not signed in, and so on), with Ork's own message as its error
  and the raw tool or provider text kept, scrubbed, as the end's detail. Tool,
  MCP, call and Claude nodes all set it; a transient kind marks the result
  transient. Feedback files a node's end by who should act: Ork's bugs, the
  workflow's, or the agent's context, and a report the `report` tool refuses is
  the agent's, not an Ork bug.
  
  `ork run` and `ork logs` print a failed node as `✗ <Label>: <message>`, with
  `(may pass; ork resume retries)` for a kind that may pass; `--verbose` (and
  `ork logs --node <id>`) adds the hint and the scrubbed details. The browser view
  shows the same as a badge with the message, the hint and a Details button.

## 1.0.0-alpha.10

### Minor Changes

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - The Agent SDK driver is gone; Ork runs agents through their CLIs (RFC-014). The
  driver ids are now `claude-code`, `open-code` and `command-code`. `claude-code`
  runs your own `claude` and is ready when it is logged in, or when
  `ANTHROPIC_API_KEY` or `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1` is set;
  `ork doctor` says which. `open-code` and `command-code` are listed, and refused
  until a real session has proven them. A workflow, `.ork/project.yaml` or
  `--driver` naming `sdk` or `cli` is refused with a message naming `claude-code`;
  runs recorded with them still resume, read as `claude-code`. The published
  package no longer depends on `@anthropic-ai/claude-agent-sdk` or
  `@anthropic-ai/sdk`.

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - `ork validate` and `ork run` now refuse a node its driver can't serve, before
  anything is spent, in words that name both: `maxTurns` on a driver with no turn
  limit, `budgetUsd` on one that reports no dollars (a token budget is planned), a
  leader that delegates on a driver that can't reach Ork's tools, and any node on
  a driver not yet proven on a real session. `ork validate --driver <id>` checks
  against that driver; without it, against the one a run would take.

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - `ork validate` now warns when a workflow could queue on a driver that holds one
  session per checkout (Command Code): session nodes that share a checkout and can
  run at once. The warning names the driver and the nodes, and says to give them
  separate worktrees or use another driver.

### Patch Changes

- [`0198304`](https://github.com/mimshins/ork/commit/0198304ceed0c3d0db343ff323b7f39f9b1e03a6) Thanks [@mimshins](https://github.com/mimshins)! - Messages, `ork doctor` and the setup skill say "agent driver" rather than
  "Claude driver", since a driver can run OpenCode or Command Code

- [`36de123`](https://github.com/mimshins/ork/commit/36de123e3cfdf293e9ceefe426bc09dac488c9be) Thanks [@mimshins](https://github.com/mimshins)! - `ork validate` now refuses a Claude node's output field written as `list:` with
  anything but a map of each item's fields (such as `list: string`), with the same
  message tool nodes get, instead of the session failing when it starts.

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - Add the `command-code` adapter: a session runs the user's own `cmd -p` in JSON
  mode, reaches Ork's tools through the checkout's leased `ork` MCP entry, hands
  its report in through Ork's `report` tool, and is held to its node's tool rules
  by a session mod that refuses everything the node did not allow. The driver
  stays unproven, and refused, until a real session proves it.

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - Add the Command Code MCP lease: a session's Ork endpoint is an `ork` entry in
  its checkout's Command Code local scope, held one session per checkout (a second
  waits, shown as a `session.waiting` event), and `ork doctor` removes an entry a
  crashed session left, leaving the user's other entries as they were.

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - Each driver now declares what it does itself (`capabilities`) and whether it is
  `proven`. `ork doctor` finds the `opencode` and `cmd` binaries and lists
  `open-code` and `command-code` as unproven; neither is taken as the ready driver
  until a real session has proven it.

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - Driver fit is stricter, and Command Code and OpenCode sessions are safer:
  
  - `ork validate` and `ork run` refuse a leader and a node it owns that share a
    checkout on a driver holding one session per checkout (Command Code): they
    would wait for each other forever. Siblings still only get a warning.
  - They also refuse a workflow's `limits.budgetUsd`, and a node's `mcp` servers,
    on a driver that can't keep them (Command Code), naming the node and driver.
  - `ork validate` checks every node that names no driver against the one a run
    would take, so an unproven ready driver is reported before `ork run`.
  - An interrupt while a session is still being wired up now stops it before it
    starts; a session that ends in an error is no longer continued to deliver a
    queued message; an OpenCode message starting with `-` is no longer read as a
    flag; a corrupt Command Code lease record no longer makes sessions wait
    forever.

- [`36de123`](https://github.com/mimshins/ork/commit/36de123e3cfdf293e9ceefe426bc09dac488c9be) Thanks [@mimshins](https://github.com/mimshins)! - A node fed by two edges no longer starts its second round while its first is
  still running; the second waits for the first to finish.

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - Add the `open-code` driver's adapter: sessions run the user's own
  `opencode run --standalone --format json` in the node's worktree, with Ork's
  tools, the permission rules (deny by default) and a dedicated agent in a config
  file written at mode 0600 outside the checkout and removed after the session.
  The machine's and the project's OpenCode config stay out. The driver stays
  unproven, so `ork validate` and `ork run` still refuse it until a real session
  proves it.

- [`2741011`](https://github.com/mimshins/ork/commit/27410118fbd30415e919d2085d26cd224a71aa31) Thanks [@mimshins](https://github.com/mimshins)! - A node sent back by a loop with more than its message holds (8 KiB) reads the
  whole with the new `read_input` tool, so the end of a long review is no longer
  lost

- [`9c48562`](https://github.com/mimshins/ork/commit/9c485624a630b0da97938eabd0f51871e947add2) Thanks [@mimshins](https://github.com/mimshins)! - A run records the Ork version that started it in `run.started`, and the version
  that resumed it in `run.resumed`

- [`1bbaab0`](https://github.com/mimshins/ork/commit/1bbaab075124baaac06fbb1dd29291eb6f099327) Thanks [@mimshins](https://github.com/mimshins)! - Sessions running together are no longer offered the same part of a run's
  `limits.budgetUsd`: each sets its cap aside as it starts, so a run passes its
  budget by at most the turn that crosses a session's cap

- [`2a02daa`](https://github.com/mimshins/ork/commit/2a02daa4a3389a894f73e2ae5ffe91b5fbe447d6) Thanks [@mimshins](https://github.com/mimshins)! - A resumed run's `readonly` or `continue` node works in the worktree of the node
  before it, even when the resume replays that node, instead of the project root

- [`692df82`](https://github.com/mimshins/ork/commit/692df8263a976815f500a7c7a98eb75c8947098d) Thanks [@mimshins](https://github.com/mimshins)! - Ork's MCP endpoint has a `report` tool for drivers that cannot hold a final
  answer to a JSON Schema themselves (`open-code`, `command-code`). It checks the
  report against the node's report schema and returns each violation to the model
  so it can fix the report and call again; the session ends with the last report
  it accepted. `claude-code` keeps its structured output and does not get the
  tool.

## 1.0.0-alpha.9

### Patch Changes

- [`2a563a4`](https://github.com/mimshins/ork/commit/2a563a40199e3a229aa747d0ee2154cafea79564) Thanks [@mimshins](https://github.com/mimshins)! - Turn the Decisions panel's answer buttons off when `ork ui` cannot be reached,
  say so once, and show each option's `ork decide` command.

- [`2a563a4`](https://github.com/mimshins/ork/commit/2a563a40199e3a229aa747d0ee2154cafea79564) Thanks [@mimshins](https://github.com/mimshins)! - `ork doctor` warns when the repository has no commit (worktree runs branch from
  `HEAD`), and `ork init` says so after writing the starter, still exiting 0. The
  update line says why the daily check is off here, `ork validate` in a folder
  with no `.ork/` says to run `ork init`, and its walk line points to
  `ork validate --paths`. A wrong `forEach` (a string, `from` without `maxItems`,
  an empty `items`, `maxItems: 0`) or a tool's `list: string` rule now says what
  to write. The `fan-out` example's gate still runs when some tasks passed and
  others failed.

- [`51af341`](https://github.com/mimshins/ork/commit/51af3410da28316a81bed81b4740d3ffb1f5553a) Thanks [@mimshins](https://github.com/mimshins)! - Fix a `continue` or `readonly` node after a `forEach` node losing the worktree
  its items worked in.

- [`1c20f2a`](https://github.com/mimshins/ork/commit/1c20f2a17ba8ed30c68985d64c3d205633a8819d) Thanks [@mimshins](https://github.com/mimshins)! - Add `output.gather` to keep a report's list fields across a node's rounds
  instead of replacing them, so a gate reading a leader's decisions after a fix
  loop sees every round's.

- [`2a563a4`](https://github.com/mimshins/ork/commit/2a563a40199e3a229aa747d0ee2154cafea79564) Thanks [@mimshins](https://github.com/mimshins)! - Show why `claude` really died instead of the `Node.js v24` banner, say
  `interrupted` after a signal or a stop, keep a failed program item's `exitCode`
  and `error` in `results`, name `output.json.<field>` when a `forEach` reads a
  tool's list elsewhere, count only started items as ran, refuse `ork logs --node`
  for a node the run never had, and start a new paragraph after a list in a gate's
  text.

- [`2a563a4`](https://github.com/mimshins/ork/commit/2a563a40199e3a229aa747d0ee2154cafea79564) Thanks [@mimshins](https://github.com/mimshins)! - Fix three resume and budget faults. A resumed run no longer reuses a stored
  decision id, which handed the store's error to a session instead of its
  question; what the last process left open is withdrawn and asked again. Results
  kept across more than one resume now hold: a source that finished in an earlier
  resume is not rerun, and items are never given results from an older list. The
  run's budget now also counts what running sessions last reported, so nothing new
  starts once that reaches the cap.

- [`2a563a4`](https://github.com/mimshins/ork/commit/2a563a40199e3a229aa747d0ee2154cafea79564) Thanks [@mimshins](https://github.com/mimshins)! - Keep the worktree of a fanned item that failed (reason
  `item failed; kept for inspection`), label a node that failed or did not merge
  `✗ fail` or `! pass, merge conflict` instead of `pass`, say
  `removed worktree of <branch> (branch kept)`, say a terminal answers a question,
  and say why a detached run has none.

- [`2a563a4`](https://github.com/mimshins/ork/commit/2a563a40199e3a229aa747d0ee2154cafea79564) Thanks [@mimshins](https://github.com/mimshins)! - Make a stop reach what waits for an answer. `ork stop`, `ork stop --node`,
  Ctrl-C and SIGTERM now end the wait on a list over `maxItems`, in a detached run
  too. Stopping a node or one item withdraws the question or permission prompt it
  left open, instead of leaving it in `ork decide`. Ctrl-C at a question's prompt
  now interrupts the run; readline used to swallow it.

- [`2a563a4`](https://github.com/mimshins/ork/commit/2a563a40199e3a229aa747d0ee2154cafea79564) Thanks [@mimshins](https://github.com/mimshins)! - `ork worktrees clean` and `remove` no longer delete an `ork/` branch no run
  recorded creating; it is listed as "not created by Ork" and kept.
  `clean --force` now lists the uncommitted files and unmerged commits it would
  lose before asking. An unknown `--run` is an error, "Nothing to clean." is not
  printed after kept items, declining prints `Cancelled.`, `remove` resolves a
  symlinked path, and `ork worktrees` in a repository with no commit prints an
  empty list.

## 1.0.0-alpha.8

### Minor Changes

- [`fc36cec`](https://github.com/mimshins/ork/commit/fc36cec389d4dedfec3520c1269840fd1e73bd8b) Thanks [@mimshins](https://github.com/mimshins)! - Show a node run once per item (`forEach`) in the Monitor as one card with its
  progress and its items as rows, add the `forEach` group and a `from` list
  dropdown to the Builder, keep a node's items with it in the Logs filter, and add
  the guides, the plugin's `write` skill and `examples/fan-out.ork.yaml`.

### Patch Changes

- [`f93117d`](https://github.com/mimshins/ork/commit/f93117d6fbf936b75399e02cf34e179070d17819) Thanks [@mimshins](https://github.com/mimshins)! - Show a graph edge's whole condition, wrapped instead of cut, and keep a
  self-loop's condition clear of the card above it and of the labels beside it.

## 1.0.0-alpha.7

### Patch Changes

- [`5eff7cd`](https://github.com/mimshins/ork/commit/5eff7cd1b8505e3936f0bf53efd18ca829f2d828) Thanks [@mimshins](https://github.com/mimshins)! - A `forEach` item whose work can't be merged into its owner now fails the node
  instead of passing, and `ork validate` refuses fanned nodes that would share one
  worktree at once, could never run, or merge into an owner yet to run. Under
  `commit: auto` with `merge: patch`, a child that runs again hands over only what
  is new.

- [`d7a2b97`](https://github.com/mimshins/ork/commit/d7a2b97e8251cd8d5628a8489b43abc37fb56318) Thanks [@mimshins](https://github.com/mimshins)! - A `watch` on a `forEach` node tests what each item says, a walk stops claiming a
  condition on `statuses` can never hold, and `ork validate` refuses a `from` list
  that is not there on the first activation, `{{item}}` in `outputs`, and a
  `notify` rule to a fanned node.

- [`ed453d6`](https://github.com/mimshins/ork/commit/ed453d6f568f11b6d843cf6e122451413c58fdf8) Thanks [@mimshins](https://github.com/mimshins)! - A node can now run once per item of a list with `forEach`: a `claude.worker`, a
  tool node, an `mcp.call` or a `workflow.call` takes a list written in the file
  (`items`) or one an earlier node reports (`from`, with `maxItems`), runs each
  item in its own session and worktree, up to `maxParallel` at a time, and
  finishes once with the results in order. `{{item}}`, `{{index}}`, `ORK_ITEM` and
  `ORK_INDEX` read the item, a run resumes per item, a list over `maxItems` asks
  whether to stop or go on, and `ork tree`, `ork logs --node` and `ork validate`
  show and check items. The Monitor and the workflow builder don't draw them yet.

## 1.0.0-alpha.6

### Patch Changes

- [`6332204`](https://github.com/mimshins/ork/commit/6332204050b2ee2af131f77f73833c0eb83bf0bc) Thanks [@mimshins](https://github.com/mimshins)! - `delegate` and `spawn_worker` now offer a leader's own child ids as an enum, and
  a wrong field or id is an error that names the field and the valid ids.

- [`c517c25`](https://github.com/mimshins/ork/commit/c517c25ac07c22a59122a6401a512613cf415de7) Thanks [@mimshins](https://github.com/mimshins)! - The Feedback panel no longer shows an empty card instead of its list when the
  item you had open left the list and the panel then became narrow.

- [`6332204`](https://github.com/mimshins/ork/commit/6332204050b2ee2af131f77f73833c0eb83bf0bc) Thanks [@mimshins](https://github.com/mimshins)! - A leader's claims no longer block its own children. When `delegate` or
  `spawn_worker` starts work, Ork releases what the leader holds, so a child can
  claim those paths, and the result tells the leader to claim again before it
  edits. Children still contend with each other and with nodes outside the team.

- [`c517c25`](https://github.com/mimshins/ork/commit/c517c25ac07c22a59122a6401a512613cf415de7) Thanks [@mimshins](https://github.com/mimshins)! - An expanded event in the Logs panel shows in full and scrolls with the list,
  instead of trapping the wheel in a box of its own.

- [`6332204`](https://github.com/mimshins/ork/commit/6332204050b2ee2af131f77f73833c0eb83bf0bc) Thanks [@mimshins](https://github.com/mimshins)! - `ork worktrees clean <name>` now stops with an error that points to
  `ork worktrees remove <name>`, instead of ignoring the name and saying "Nothing
  to clean."

## 1.0.0-alpha.5

### Minor Changes

- [`aa3b231`](https://github.com/mimshins/ork/commit/aa3b231f3da4b87d81f508ea5e5bcbb4892ae703) Thanks [@mimshins](https://github.com/mimshins)! - A `human.gate` can give a `document` to read beside a short `question`. The
  Decisions panel renders decision text as Markdown, folds long text, opens the
  document in a dialog, filters by workflow and run, and a run in the Monitor with
  open decisions opens them. `ork decide` takes `--workflow` and `--document`, and
  prints or offers a gate's document in the terminal. A gate's text shows lists
  and objects as readable lines, never raw JSON, and a permission's command shows
  as written.

## 1.0.0-alpha.4

### Minor Changes

- [`0485790`](https://github.com/mimshins/ork/commit/04857904cc3edf50f13be53d4474ffd2bdb10a04) Thanks [@mimshins](https://github.com/mimshins)! - A Claude node, or `defaults`, can name the MCP servers its sessions load with
  `mcp: [name]`, from the project's `.mcp.json`, beside Ork's own and still under
  strict MCP. `ork validate` reports a name the file doesn't have.

## 1.0.0-alpha.3

### Minor Changes

- [`742efac`](https://github.com/mimshins/ork/commit/742efacfe7e7d8d51af3739480b9479d1f7123ac) Thanks [@mimshins](https://github.com/mimshins)! - Experimental features can ship on `main` turned off. `experimental: [<name>]` in
  `project.yaml` or `ORK_EXPERIMENTAL=<name>[,<name>…]` turns one on, `ork doctor`
  lists what is on and who turned it on, and a name Ork doesn't know fails
  `ork validate`, `ork run` and that doctor check. No experiment ships yet.

### Patch Changes

- [`a995575`](https://github.com/mimshins/ork/commit/a995575b437c4207e913ef85f69b1520ec794dc0) Thanks [@mimshins](https://github.com/mimshins)! - `ork worktrees remove` takes a detached worktree by the `<run>/<node>` name
  `ork worktrees list` shows, not only by its path.

- [`e55448a`](https://github.com/mimshins/ork/commit/e55448a3a0648a8c3932a5b78ae61897b1de1cfe) Thanks [@mimshins](https://github.com/mimshins)! - A child whose worktree was removed outside Ork while the run went on (an agent
  ran `git worktree remove`) gets it opened again from its owner's work the next
  time it runs, instead of failing with "spawn git ENOENT"; git run in a missing
  folder now says which folder.

## 1.0.0-alpha.2

### Patch Changes

- [`d1457d6`](https://github.com/mimshins/ork/commit/d1457d679e25f85db447f1b508bc05a3315769a3) Thanks [@mimshins](https://github.com/mimshins)! - Two children a leader starts at once no longer fail with "git add failed: remove
  the file manually to continue". Ork runs its git commands in one worktree one at
  a time, so their hand-offs from the leader's worktree don't collide on its
  index.

## 1.0.0-alpha.1

### Minor Changes

- [`953d990`](https://github.com/mimshins/ork/commit/953d990a65b2294e476faa52744c05f4a1a0a756) Thanks [@mimshins](https://github.com/mimshins)! - A run's Claude sessions start clean of the machine's Claude setup, on both
  drivers: no MCP server but Ork's (`--strict-mcp-config`), Claude Code's
  auto-memory off (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), and the per-machine
  system prompt sections out of the cached prefix
  (`--exclude-dynamic-system-prompt-sections`). The repository's `CLAUDE.md`,
  `AGENTS.md` and `.claude/` still load. A machine's MCP servers changing
  mid-session made Claude rewrite its prompt cache: a measured 4-turn task cost
  $0.113 before and $0.032 after. `ork run --machine-claude`, or "Use this
  machine's Claude setup" in the Run workflow form, loads the machine's MCP
  servers and memory for a run; the run records it, and `ork resume`, `ork chat`
  and the runs it calls keep it.

### Patch Changes

- [`c465552`](https://github.com/mimshins/ork/commit/c4655520654afcef196ff28fa2a1215a4cd9e968) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui`: scrolling a panel past its end no longer carries the whole panel, its
  header included, up the window. Every scroll area keeps its scrolling, and the
  text only a screen reader reads, to itself.

## 1.0.0-alpha.0

### Major Changes

- [`68129b3`](https://github.com/mimshins/ork/commit/68129b383d5509a6f3ff71c2bfc3f56402c33253) Thanks [@mimshins](https://github.com/mimshins)! - Ork 1.0.0 begins with this alpha. From here every release is `1.0.0-alpha.N`
  until the beta, and a plain `npm install --global @krapht/ork` or
  `pnpm add --global @krapht/ork` installs it. Workflow files need no changes. One
  behavior to know: a Claude node that names no driver takes the one ready on your
  machine (the `claude` CLI when both are) instead of the Agent SDK, and `ork run`
  says which; name `driver: sdk` or pass `ork run --driver sdk` to keep the old
  behavior. To stay on 0.4, install `@krapht/ork@0.4` and set
  `ORK_NO_UPDATE_CHECK=1`.

### Minor Changes

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - Answer any decision with an optional note. A `human.gate` outputs it as `note`
  (`{{nodes.<gate>.output.note}}`, empty when none), so a `revise` answer can say
  what to change; `ask_user` returns it with the choice; a denied tool's message
  ends with it. Give it with `ork decide --id … --choose … --say "…"`, in the
  Decisions panel's "Note for the run" box, or on the run's terminal as an
  optional line after the choice (Enter skips it). It is stored masked with the
  decision and shows in `ork logs` and the panel's Settled list. `--note` and
  `--rating` keep recording feedback about the node, as before.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - A leader can answer its children's questions: with `questions: owner` on a
  `claude.leader`, a child's `ask_user` goes first to a read-only fork of the
  leader's session, which answers when its task already settles the question, or
  passes it on to you with a note. The fork can only read files, and has 3 turns
  and 5 minutes. You're asked as before when the leader has no session yet or the
  fork fails or runs out. The fork's cost is the run's, against the leader, and
  its lines in the logs say `fork`. Every answer records who gave it:
  `ork decide --list`, the transcript and the Decisions panel show the leader that
  answered or passed a question on. The default, `questions: user`, changes
  nothing. The `answer` tool takes an optional note.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - Ask your agent to set Ork up for you. A new skill, `/ork:setup` in Ork's Claude
  Code plugin and `/ork-setup` through `ork init --skills`, checks `ork` and
  `ork doctor`, sets the project up with `ork init` or `ork register`, makes Ork's
  tools available to the agent, and offers a first workflow, asking before it
  installs anything, edits a config or starts a run. It never asks for a
  credential and never answers a decision. `ork doctor` says when a project's copy
  is older than Ork, as for the other skills. A new getting-started page, With
  your agent, shows how with Claude Code, any MCP client through `ork mcp`, and an
  agent that only has a shell.

- [`8308e0e`](https://github.com/mimshins/ork/commit/8308e0e05f098660526269df76344e62a1876dd7) Thanks [@mimshins](https://github.com/mimshins)! - Tab completion for zsh, bash and fish: `ork completion <shell>` prints a script
  that completes commands, flags, workflow names (with `ork:` ones), run ids
  newest first with their workflow and status, node ids after `--node`, open
  decision ids after `ork decide --id`, and `--driver` values. The script asks the
  hidden `ork __complete`, which reads the project and the store read-only and
  prints nothing when it can't. `ork --help` now lists the commands in groups (Get
  started, Workflows, Runs, Steer a running run, After runs, Projects, Ork itself)
  with a short line each, `wt` shown as `worktrees`' alias, and a command with
  subcommands shows `<command> [flags]` in its usage line.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - `triggers.yaml` has a JSON Schema, `triggers.schema.json`, for autocomplete in
  your editor: add
  `# yaml-language-server: $schema=https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/triggers.schema.json`
  at the top.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - Resume a run from the browser view. A run that stopped, failed or crashed has a
  **Resume…** button among its controls in the Monitor: it asks first, says it's a
  paid run and what runs again, shows the `ork resume <run> --detach` command it
  stands for, and picks the run up in the background with the inputs and flags it
  started with. The Feedback panel's **Propose fix…** now offers a choice of
  driver, as `ork feedback apply --driver` does, and its command follows it.

### Patch Changes

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - `ork feedback publish` pages through the Agent feedback category (up to 1,000
  threads) for the item's thread, instead of reading only the 100 most recently
  updated, so a quiet thread gets a "+1" rather than a duplicate.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - The npm page no longer says the web UI is coming: it shows `ork ui`, how to have
  your agent set Ork up, and where to read what's new. The documentation was
  rewritten for people who use Ork: a choice of setting it up yourself or with
  your agent, a Quickstart that names no driver, downloadable examples, and new
  pages on how Ork works, where it keeps things and what's new.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - `ork doctor` warns when your home folder's path is too long for a run's socket
  (103 bytes on macOS, 107 on Linux), which made answers and commands wait up to a
  second without a word.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - Ork run from a git hook acts on its own repositories, not the hook's: `ork`
  clears git's local variables (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE` and
  the rest of `git rev-parse --local-env-vars`) as it starts, so its sessions,
  tool nodes and detached runs start clean, and its own git runner leaves them out
  too. An outer `git -c key=value` no longer reaches Ork's git.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - Clearer `--help`: `ork validate` shows it takes files, `ork link` the tools to
  link, `ork resume` that it takes any run that didn't succeed, and `ork feedback`
  names all its subcommands. `ork run` no longer lists the flags only Ork passes
  to itself, and `ork doctor`'s SDK hint names Foundry.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - A workflow no longer needs to name a Claude driver, and `ork init`'s starter
  names none, since `.ork/workflows/` is committed and one person's login doesn't
  belong in it. When nothing names a driver (the node, its agent, the workflow,
  `.ork/project.yaml`'s `defaults.driver`, or `--driver`), `ork run` uses the one
  `ork doctor` finds ready on the machine running it, `cli` when both are, and
  says so in one line; with neither ready it stops before any session starts, with
  `ork doctor`'s hints. The run records the driver, and `ork resume` keeps it.
  `ork init` says which driver runs would use here. Before, such a workflow ran on
  the SDK driver.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - A run no longer ends succeeded when a join waited on a node that could never
  run. In a later round of a loop, an edge whose source can't run any more (a
  second builder the loop didn't go back to) counts as not taken, so the node it
  fed is skipped and the join behind it fires, for `all` and `any` joins alike;
  the run reaches its gate, or asks when the loop is out of rounds. A run that
  still ends with a node waiting fails with an `ork engine error:` reason instead
  of succeeding, and `ork validate` reports such a path as a bug in Ork rather
  than as a way to succeed.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - A `before:` or `verify:` step's long output is kept in a file named for the step
  and its try (`review.1.verify-2.stdout.txt`, `review.1.verify-2.txt`), so a
  later try no longer overwrites the file a session was pointed at.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - Leaders run with the one-hour prompt cache (`ENABLE_PROMPT_CACHING_1H=1`) on
  both drivers, as the context spec says, so a leader waiting on its children
  keeps its cached prefix.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - A workflow, `project.yaml`, `triggers.yaml` or settings file written by a newer
  Ork now says so, with `ork upgrade` as the fix, instead of
  `Invalid input: expected 1` and a list of unknown keys. `ork feedback import`
  says the same of a line with a newer `feedbackVersion`.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - `ork upgrade` and the browser view's Upgrade recognise a global install by pnpm
  11, which keeps global packages in its store, instead of offering the npm
  command.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - A run that skipped nodes or handled a failure still reads `succeeded`, and now
  says so: the run result, `ork run`'s last line
  (`2 ran, 1 skipped, 1 failure handled`), `ork ps --json` (`skipped`,
  `failuresHandled`) and the Monitor's stat strip count both. `ork run` also warns
  about each node that never ran but had messages nobody read. `ork ps` shows a
  called run's cost dimmed as `in <caller>`, since its caller's cost already
  counts it.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - `ork pause`, `ork continue` and `ork stop --node` (and the same routes of
  `ork ui`) refuse a run of one node (`node-…`) with "stop the whole run instead",
  where they used to say they had worked and do nothing. `ork stop` still stops
  it.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - The browser view keeps more of what you were doing, and reads better. The
  Builder keeps its open workflow, selected card and undo when its panel is moved,
  closed and reopened, or stacked in a narrow window. On a light system the page
  is light from its first paint, with no dark flash. Each docked panel has a
  heading for screen readers, so its cards no longer skip a level. The graph's
  **Keys on the graph** button lists every key it takes, a card's too. Starting a
  run with no Monitor showing puts the focus on the Runs panel, not the page.

- [`2388727`](https://github.com/mimshins/ork/commit/2388727ffcfbb815d05debee3377b41b2d38df71) Thanks [@mimshins](https://github.com/mimshins)! - The new-version check, `ork upgrade` and `ork ui`'s banner now offer the newest
  version across npm's `latest`, `alpha`, `beta` and `rc` tags, so a pre-release
  of 1.0.0 reaches you as soon as it's out. A `canary` build is offered only to
  someone already running one.

## 0.4.0

### Minor Changes

- [`2a0882a`](https://github.com/mimshins/ork/commit/2a0882ae36fbcc045934d6c73cf8d5d3da04dfa1) Thanks [@mimshins](https://github.com/mimshins)! - `ork run`, `ork validate` and `ork context explain` take Ork's own workflows by
  an `ork:` name. The first is `ork:feedback-apply`, which proposes a fix for a
  feedback item on a branch and asks whether to keep it. Ork writes a built-in
  into the project's run folder (`.ork/runs/.builtin/`), so its runs belong to the
  project and resume from the text they started with.

- [`2a0882a`](https://github.com/mimshins/ork/commit/2a0882ae36fbcc045934d6c73cf8d5d3da04dfa1) Thanks [@mimshins](https://github.com/mimshins)! - `ork feedback apply <item>` has Ork propose a fix for a feedback item: it runs
  Ork's own `ork:feedback-apply` workflow in the project the item came from, whose
  worker can read and edit files but run no command, and Ork commits its change on
  its own branch. Before you keep or discard it, you see what the branch changes
  (`git diff --stat`) and how to read the whole of it. Ork never merges it.

- [`2a0882a`](https://github.com/mimshins/ork/commit/2a0882ae36fbcc045934d6c73cf8d5d3da04dfa1) Thanks [@mimshins](https://github.com/mimshins)! - `ork feedback accept <item> --lesson` turns a feedback item into a lesson: one
  line in `.ork/lessons/<workflow>.md` of the project it came from, which every
  later session of that workflow reads. `-m` gives its words. A workflow's lessons
  are held to 1,500 tokens: accepting past that is refused, and a longer file is
  cut, which `ork context explain` and the Context panel say.

- [`2a0882a`](https://github.com/mimshins/ork/commit/2a0882ae36fbcc045934d6c73cf8d5d3da04dfa1) Thanks [@mimshins](https://github.com/mimshins)! - `ork decide --id <d> --choose <option>` takes `--note <text>` and
  `--rating good|bad`, and notes how the decision's node went, as the run's
  feedback. The `ork ui` server takes the same note at `POST /api/runs/:id/notes`.

- [`e1e2814`](https://github.com/mimshins/ork/commit/e1e281496edeed583fed82b73e874039d51fa0cd) Thanks [@mimshins](https://github.com/mimshins)! - `ork feedback publish <item>` shares feedback about Ork itself with its
  maintainers, in the "Agent feedback" category of its GitHub Discussions, with
  your own `gh`. Ork redacts it (secrets, your projects' paths, home folder,
  emails, hosts and IPs; `--hide-names` for names), shows exactly what it will
  post, a new thread or a "+1" on the one there, and sends nothing unless you say
  yes. `ork feedback export` and `import` move feedback as JSON lines.

- [`2a0882a`](https://github.com/mimshins/ork/commit/2a0882ae36fbcc045934d6c73cf8d5d3da04dfa1) Thanks [@mimshins](https://github.com/mimshins)! - `ork feedback triage` merges feedback items about the same problem, with the
  same target and kind and titles that share at least 80% of their words, after
  asking about each merge. No model runs. A merged item lists under the one seen
  first, and `ork feedback split <item>` takes a merge apart.

- [`284a23b`](https://github.com/mimshins/ork/commit/284a23ba430b504324e636ceda521541dd5027c3) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` has a Context panel: what the node you chose last is told, and where
  each piece comes from, as `ork context explain` prints it, with each piece's
  words a click away. It follows a node chosen in the Monitor, Logs or Chats, and
  the card selected in the Builder, whose draft it plans again after each edit. A
  run's node is planned from the project's files as they are now, naming each one
  that changed after the run started. `ork context explain` says when it plans a
  spawned worker as the node it came from, and names each practice by its own
  words when one is switched off.

- [`0cb18a2`](https://github.com/mimshins/ork/commit/0cb18a2b6f1fdc97209a68f121b6172bcd35ee73) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` tells you when a newer Ork is out, with a banner above the panels from
  the same record as the CLI's notice; it keeps that record fresh itself while it
  stays open, at most once a day, and `ORK_NO_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER`
  and `CI` turn it off. **Upgrade…** (or **Upgrade Ork…** in the palette) does
  what `ork upgrade` does once you confirm: it shows the exact command, streams
  its output, and offers **Restart**, which brings `ork ui` back on the new
  version on the same port, still signed in, and reloads the page. A clone or an
  `npx` copy gets the steps to run instead, each command as a block. The dialog
  works by keyboard and screen reader: each step's heading takes the focus and is
  heard, the plan and the outcome are said aloud, and closing it returns the focus
  to the banner's button, or to the panels. `ork ui` now runs its server as a
  child process it supervises; Ctrl-C still stops both. Stopped while an upgrade
  runs, it waits for the package manager to finish, so Ork isn't left
  half-installed, and says so; a second Ctrl-C stops it at once. A mirror's URL in
  `ORK_UPDATE_REGISTRY` shows on the page without its user name and password.

- [`9b568c9`](https://github.com/mimshins/ork/commit/9b568c992ba78ad8a94ccee1b0d649c8f56aafbe) Thanks [@mimshins](https://github.com/mimshins)! - The browser view has a **Worktrees** panel: what `ork worktrees` lists, for
  every project at once, with **Remove…** for one worktree or branch and **Clean
  merged…** for what's merged into each project's current branch. Each shows its
  plan and its command (run from the project's folder, quoted to paste as is), and
  asks; removing work that would be lost (uncommitted changes, unmerged or
  unreachable commits) shows exactly what first and needs a second, explicit
  confirm. A plan that changed after you read it removes nothing.
  
  `ork worktrees remove <branch|path> [--branch] [--force] [--yes]` removes one,
  the panel's twin: it prints the plan, and what's lost when it needs `--force`.
  It changes only that item: a worktree whose folder is gone is dropped by its own
  path, never by pruning every missing one.

### Patch Changes

- [`71c09e7`](https://github.com/mimshins/ork/commit/71c09e78f9ea5177aabe7a635af9e3317d6ae767) Thanks [@mimshins](https://github.com/mimshins)! - Ork uses `@anthropic-ai/sdk` 1.3.0, and builds with `tsdown` 0.23.4.

- [`38ea1dc`](https://github.com/mimshins/ork/commit/38ea1dc1804da4cdf960a35e618a56bc8a8b0277) Thanks [@mimshins](https://github.com/mimshins)! - `ork feedback` and the browser view now follow one rule for what an item allows:
  nothing on a dismissed item until you restore it, `accept` only on a new or
  triaged one, `publish` only once, and no second `apply` while one is proposing a
  fix for the item. A lesson added to an item that's resolved already leaves it
  resolved.

- [`4be0fe3`](https://github.com/mimshins/ork/commit/4be0fe3fd359597c417daaf37200bd56790c79a7) Thanks [@mimshins](https://github.com/mimshins)! - A run that crashed is no longer shown as running after its process id is reused,
  by a process started after a reboot or by another user. Ork now records when a
  run's process started, beside its id, and a live process with that id but
  another start reads as `crashed`, so `ork ps`, `ork stop`, `ork prune`,
  `ork worktrees` and the browser view see it as crashed, and an upgrade no longer
  waits on it. Runs recorded before this change are judged as they were.

- [`52dc034`](https://github.com/mimshins/ork/commit/52dc0348569f5a63973b6f3b1672adcd62b54c11) Thanks [@mimshins](https://github.com/mimshins)! - The browser view shows every command as a code block, never as inline code: a
  full-width block with its copy button in the top-right corner, under a sentence
  that ends in a colon. Empty states, a confirm dialog's command, the triggers'
  next step and the Upgrade dialog's command all take one, and a control's tooltip
  shows its command as a block line under its words. A copy button now sits only
  in a block or a well, always in its corner, so "Copied." no longer pushes it
  aside, and a feedback item's id is no longer copied from beside it.

- [`38ea1dc`](https://github.com/mimshins/ork/commit/38ea1dc1804da4cdf960a35e618a56bc8a8b0277) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` has a Feedback panel: every item from your runs, filtered by status and
  by what it's about, with its records newest first. Dismiss or restore an item,
  accept it, add it as a lesson for its workflow, have Ork propose a fix
  (confirmed first, then followed in the Monitor), split what triage merged, or
  preview exactly what would be shared about Ork and post it. In the Monitor,
  **Note…** on a node, or the note button among a run's controls, adds your own
  feedback on how it went.

- [`52dc034`](https://github.com/mimshins/ork/commit/52dc0348569f5a63973b6f3b1672adcd62b54c11) Thanks [@mimshins](https://github.com/mimshins)! - The browser view keeps the focus and the announcements where a keyboard or
  screen reader user expects them. A dialog opened from the command palette keeps
  the focus, rather than the palette taking it back behind the dialog. Dialogs are
  marked modal. The same message twice in a row is now heard twice. Output wells
  and command blocks have a visible edge in the light theme.

- [`37090bb`](https://github.com/mimshins/ork/commit/37090bb761b20bf48d54c70b0be4897c777e2454) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` no longer marks anything with a colored stripe down one side. An unread
  notification is tinted, with a heavier title and the word "unread"; a chat
  message is its speaker's line, then the words; and a Builder field with a
  problem shows the failed glyph beside the problem's words.

- [`9b568c9`](https://github.com/mimshins/ork/commit/9b568c992ba78ad8a94ccee1b0d649c8f56aafbe) Thanks [@mimshins](https://github.com/mimshins)! - `ork worktrees clean` no longer removes the worktree of a run that's still
  going, even with `--force`: a node that hadn't committed yet looked merged, so a
  plain clean could take its worktree from under it. The plan says "its run is
  still going"; stop the run first. A worktree whose folder is gone now shows as
  `prune worktree` in the plan, and is dropped by its own path: clean no longer
  runs `git worktree prune`, which dropped git's record of every missing worktree
  in the repository, your own included. A branch a run created that you've since
  checked out in a worktree of your own is left alone ("checked out in <path>"),
  and that worktree is no longer taken for Ork's. The list's words read "2 commits
  not merged" and "checked out in the main checkout".

## 0.3.0

### Minor Changes

- [`515b9eb`](https://github.com/mimshins/ork/commit/515b9ebd7075a334e47b0331b4fed4029dd34cff) Thanks [@mimshins](https://github.com/mimshins)! - A leader or worker can now run `before:`, a program in its own checkout before
  its session starts. If it fails, no model turn is spent, and its prompt can read
  what it gave as `{{before.*}}`. `defaults:` can set one for every node in a
  workflow or project.

- [`3df572f`](https://github.com/mimshins/ork/commit/3df572f30fadddcd651c369fc2478e169803ce2a) Thanks [@mimshins](https://github.com/mimshins)! - Tools and MCP calls can declare their output with `output.schema`, and a run
  holds every node to what it declared: a value that doesn't fit fails the node
  and says why. An edge can now read `ok`, so `when: "!ok"` handles any failure.
  In the builder, conditions are picked from what a node can say, new edges start
  valid, and renaming a value follows into the conditions that read it.

- [`515b9eb`](https://github.com/mimshins/ork/commit/515b9ebd7075a334e47b0331b4fed4029dd34cff) Thanks [@mimshins](https://github.com/mimshins)! - A `tool.shell` node can now hold a short program as `script:`, instead of
  `command:`. It takes no templates, so a value can't become code: values arrive
  through `env:`. It runs under `sh -eu` by default, or the `interpreter:` it
  names.

- [`53e1826`](https://github.com/mimshins/ork/commit/53e18266c9d682a11b9da6bbd32b3bc541f6fa05) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` starts Ork's local server on `127.0.0.1:4417` and opens it in your
  browser, signed in; run it again to open the one that is running. For now its
  page lists your runs and open decisions live; the UI's panels come next. Behind
  it is a JSON API with live event streams: runs, trees, events and decisions to
  read, and starting, resuming, stopping, messaging runs and answering decisions,
  each as the matching `ork` command does. The server runs nothing itself: closing
  it stops no run. It listens on loopback only, behind a per-start token that
  becomes an `HttpOnly` cookie, and refuses other hosts and other sites.
  
  `ork logs -f` now ends as soon as a run's `run.finished` arrives over its
  socket, instead of waiting for the run's process to close it.

- [`515b9eb`](https://github.com/mimshins/ork/commit/515b9ebd7075a334e47b0331b4fed4029dd34cff) Thanks [@mimshins](https://github.com/mimshins)! - `mcp.call` is a new node that calls one named tool on an MCP server, with no
  session and so no model turn. It reads the server from the project's
  `.mcp.json`, keeps secrets in your environment and masks them, and a run won't
  start if a server is missing or a variable it reads isn't set. Stdio servers and
  HTTP servers with static headers work; OAuth and SSE ones are refused.

- [`c624bbd`](https://github.com/mimshins/ork/commit/c624bbd293f91ac9b577892a54a1400c1367c981) Thanks [@mimshins](https://github.com/mimshins)! - `ork init` offers Ork's skills for Claude Code: `--skills` writes them into
  `.ork/skills/` as `/ork-write`, `/ork-run` and `/ork-principles`, linked from
  `.claude/skills`, so everyone who clones the project gets them. On a terminal it
  asks once. `ork doctor` says when the copies are older than your Ork.

- [`9751231`](https://github.com/mimshins/ork/commit/975123169959662e9474d19bbc3a3008e6612b9b) Thanks [@mimshins](https://github.com/mimshins)! - `ork mcp` can now check a workflow as `ork validate` does (a draft's text or a
  file, each problem with its line, then the walk), explain what a node's session
  loads, and start a run in the background, which Claude Code asks you about
  first. Inside a run it starts nothing. `--expects <version>` lets a caller such
  as a plugin say which Ork it needs.

- [`b15911c`](https://github.com/mimshins/ork/commit/b15911ceb8967f85ca8c8d24eafc0e3e2fe15a0b) Thanks [@mimshins](https://github.com/mimshins)! - `ork mcp` serves Ork's tools to Claude Code over stdio: your projects and
  workflows, the workflow format a part at a time, runs and their events, what
  they spent, and the decisions waiting on you. Add it with
  `claude mcp add ork -- ork mcp`. It only reads: no tool answers a decision or
  acts on a run.

- [`e3998b2`](https://github.com/mimshins/ork/commit/e3998b248ba6d72746f1e2a000431c987cffa8f8) Thanks [@mimshins](https://github.com/mimshins)! - Pause, continue, and stop one node. `ork pause [run] [--node n]` pauses a live
  run, or one of its nodes, without cutting anything short: nothing new starts, a
  running session finishes its step and waits before its next tool call, and a
  gate's timeout waits too. `ork continue` lets it go on from where it waited,
  even after a long pause. `ork stop --node n` stops one running node: it fails,
  "stopped by the user", and the rest of the run goes on. `ork ps` shows a paused
  run as `paused`, and `ork tree` marks the nodes that are waiting. The local
  server has the same as `POST /api/runs/:id/pause`, `/continue` and `/stop` (each
  with `{ node? }`), and lists a project's workflows at
  `GET /api/projects/:id/workflows`.

- [`636fcd6`](https://github.com/mimshins/ork/commit/636fcd658cef70f5d41eeedf7956dddef05fd02e) Thanks [@mimshins](https://github.com/mimshins)! - Limits across runs. `quotas` with `dayUsd`, `weekUsd` and `monthUsd`, in
  `~/.ork/settings.yaml` for all your projects and `.ork/project.yaml` for one,
  caps what runs spend together. At a cap, or when your Claude plan refuses a
  session, a run starts nothing new and ends `quota_exhausted`, and `ork resume`
  goes on. `ork usage` and the Usage panel show each cap and when it resets.

- [`e26fb35`](https://github.com/mimshins/ork/commit/e26fb358330dd9acef48a78d43794ee698169c72) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` has its Logs and Decisions panels. Logs shows a run's events live,
  filtered by node, type or text, holds its place when you scroll up, and reads
  older events a page at a time. Decisions lists every open question across runs,
  with the recommended option standing out: answer with a click or the keys `1` to
  `9`, and see who answered one that was settled elsewhere. The server gains
  `GET /api/decisions/:id`.

- [`dead65e`](https://github.com/mimshins/ork/commit/dead65e27303c8b80d99f8cdc4c4a6c5b6060a5c) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` has its notification center: a bell with the unread count, and a panel
  of open decisions and of runs that ended, crashed or paused. Mark items read
  singly or all together, per browser. New items are announced to screen readers,
  and desktop notifications can be turned on from the panel.

- [`c4cdefe`](https://github.com/mimshins/ork/commit/c4cdefe344ba6f4f2589d7d938589e206de0d5f9) Thanks [@mimshins](https://github.com/mimshins)! - Tool nodes can steer a run without a model turn. A program now sees who it is
  (`ORK_RUN`, `ORK_NODE` and more), a node takes an `env:` that can read your own
  variables as `{{env.NAME}}`, and `output: { format: json }` gives `output.json`
  from stdout or `$ORK_OUTPUT`. `ork chat` now refuses when run by a program or an
  agent in a run.

- [`b98d841`](https://github.com/mimshins/ork/commit/b98d8417529e59596878f862baf6bf60c1ec6538) Thanks [@mimshins](https://github.com/mimshins)! - Deterministic steps can now tell a working session what happened with no model
  turn. A program in a tool node writes with `ork send <to> -m <body>` or
  `--stdin`, and a node's `notify:` declares a message to send when it finishes.
  Both land as a notice and `read_inbox`, labelled `via`, and show in `ork logs`
  and the Logs and Chats panels. A channel can now have a tool node on one side,
  one way. The extra turn that reads a late message now stays within what's left
  of the budgets, and can no longer fail a node that already reported.

- [`0f0b3f0`](https://github.com/mimshins/ork/commit/0f0b3f0787ff43fd380369b66e26e7b9297cc8d4) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` has its Chats panel: one thread per leader or worker of a run, built
  from its events and following the node chosen in the Monitor. Write to it while
  the run is live; for a run that has ended it gives the `ork chat` command, ready
  to copy.

- [`08d40b8`](https://github.com/mimshins/ork/commit/08d40b89a6dfd35a2cae7395e6ce655a6c169953) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` now serves Ork's browser app, bundled inside the package and loaded
  only from your machine (no CDNs, no remote fonts). This first cut only shows
  which Ork serves it; the panels follow. The page runs under a strict content
  security policy, and the licenses of the third-party code it bundles are in
  `dist/ui/THIRD_PARTY_LICENSES.txt`.

- [`aea062e`](https://github.com/mimshins/ork/commit/aea062e20f69ebf2e43ae7ba4de5c22d97b436f1) Thanks [@mimshins](https://github.com/mimshins)! - Add `ork usage` and the Usage panel, to see what runs spent over time, and
  `ork prune`, to forget old runs' logs while keeping what they spent. Costs in
  `ork ps`, `ork tree` and run budgets no longer count a resumed session's earlier
  spend again.

- [`515b9eb`](https://github.com/mimshins/ork/commit/515b9ebd7075a334e47b0331b4fed4029dd34cff) Thanks [@mimshins](https://github.com/mimshins)! - A leader or worker can now declare `verify:`, a program that must pass before
  its report is accepted. A failure goes back to the same session, up to
  `attempts` times and within its budgets, with only the end of the output, and
  then the node fails.

- [`fb6009d`](https://github.com/mimshins/ork/commit/fb6009dcccc2164df6a61488ebabc020ec9b9c49) Thanks [@mimshins](https://github.com/mimshins)! - The workflow builder now shows what walking a workflow finds, in Problems and on
  the cards, with how many ways it tried, such as
  `Walked 14 ways through: 8 succeed, 6 fail.` A finding never blocks a save. A
  problem no longer names its node twice.

- [`9071e39`](https://github.com/mimshins/ork/commit/9071e39a1ff80cf19297d7e3357218074cdef430) Thanks [@mimshins](https://github.com/mimshins)! - `ork validate` now tries every way through a workflow, without running a
  session, a tool or a script. It warns about a node no way reaches and a loop
  only its rounds can end, says how many ways it walked, and `--paths` lists how a
  run can end. `ork run` prints the same warnings before it starts.

- [`01fd0d4`](https://github.com/mimshins/ork/commit/01fd0d446b3e77a274bc7d8afcfebd822ae01c0f) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` has its Monitor: the selected run's graph and ownership tree, live,
  with each node's status, model, tokens and cost. Pause, continue and stop the
  run or a node from it; stop asks first, and a control that does not apply says
  why. A `workflow.call` opens the run it started, and a run lists its links to
  other runs. A run now records its edges and channels, so its graph shows what it
  ran even after the workflow file changes.

- [`1ea63a7`](https://github.com/mimshins/ork/commit/1ea63a7c52e5cf7d6d725ea411319d7fd94a3c44) Thanks [@mimshins](https://github.com/mimshins)! - Wait on something outside a run, or start one when it happens, with no model
  turn until it does. A tool or MCP node takes `watch: { every, until, timeout }`,
  looking again until a condition holds: the time between looks doesn't count as
  work, it holds no session slot, and `$ORK_STATE` keeps what a script has seen.
  `ork watch` runs the triggers in a project's `triggers.yaml`, starting a run for
  each new thing a check reports. Its first look starts nothing, each key starts
  once, the workflow must have a budget, and each trigger has a daily cap and
  takes one run at a time. It runs only what you accepted on this machine with
  `ork watch --accept`, in a terminal. See the guide, Watching a source.

- [`3cb93db`](https://github.com/mimshins/ork/commit/3cb93db7a61c17b5dd9acd67bfedfdb082e70ec7) Thanks [@mimshins](https://github.com/mimshins)! - `ork validate` and `ork run` now stop on a condition that compares a field with
  a value it can't have, such as `status == 'failed'` or a gate's `choice` with a
  typo, and warn on a condition that's always false, a loop only its rounds can
  end, a plain edge beside a loop, and a loop of sessions with no budget or
  timeout. `ork run` prints warnings before it starts.

- [`ef213ef`](https://github.com/mimshins/ork/commit/ef213efdcc4d645ca996b073b44af234d9ca7e22) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` has a Builder panel: create or edit a workflow with no YAML to write.
  It saves the same file you could write by hand, keeping its comments, and what
  you change waits as a draft until it passes the same checks as `ork validate`.
  
  Cards now always follow from a workflow's nodes and edges, so
  `<name>.layout.json` is no longer read. A file left behind is ignored and can be
  deleted.

- [`5e3411d`](https://github.com/mimshins/ork/commit/5e3411d4bd79cf3b2e9c33523d28a6d6e5a86a1e) Thanks [@mimshins](https://github.com/mimshins)! - A new node type, `workflow.call`, starts a workflow as a run of its own, in this
  project or another registered one, and waits for it. Workflows can declare
  `outputs:`, which later conditions and prompts read through
  `{{nodes.<call>.output.outputs.*}}`. Name a `node` to wait on its report and
  keep one run as a conversation, and add a `messages` channel for your agents to
  write to it by name. A called run shares its caller's budget, stops when its
  caller stops, and resumes when its caller resumes. A project can limit who calls
  it with `calls.accept` in `.ork/project.yaml`, and `ork validate` checks what a
  call names. See the guide, Working across projects.

### Patch Changes

- [`2a0a15f`](https://github.com/mimshins/ork/commit/2a0a15fd7e97bd037f46ebea8750da0a269b4bb1) Thanks [@mimshins](https://github.com/mimshins)! - The UI shows Ork's wordmark in the top bar, and titles, labels and descriptions
  read as three things. Panels no longer have lines sticking out behind their
  corners, and cards that nearly line up get a straight edge between them. In the
  builder, a message has its own line, so it no longer moves the canvas, and
  focusing a field can no longer slide a panel under the top bar.

- [`41621da`](https://github.com/mimshins/ork/commit/41621dab7a658c9aa8fb515ccda1a5d883075db5) Thanks [@mimshins](https://github.com/mimshins)! - Runs, Logs, Chats, Usage and Notifications in the browser view are tighter: each
  toolbar sits in its own card, run rows are shorter, and a selected row is now a
  neutral outline, so amber in a list always means something needs you. The
  recommended option in a decision says so in a caption.

- [`b296577`](https://github.com/mimshins/ork/commit/b29657775de06ad488fdca2029385df5d22e9580) Thanks [@mimshins](https://github.com/mimshins)! - The browser view now follows your browser's text size throughout: borders,
  corners and spacing scale with the text, not just the text itself. At the
  default size nothing looks different.

- [`db5c52c`](https://github.com/mimshins/ork/commit/db5c52c940cd5962bf6bad67edc577b8e5b17e67) Thanks [@mimshins](https://github.com/mimshins)! - The Builder's tools, palette, canvas and inspector are now cards in a frame,
  like the other panels, and Notifications rows are shorter.

- [`1ad00e4`](https://github.com/mimshins/ork/commit/1ad00e4fe282fac43e7f30ebd45131baacd5f7e7) Thanks [@mimshins](https://github.com/mimshins)! - The browser view has a new frame: each panel is a frame holding a card, on a
  darker canvas, with slimmer bars and tabs. Column heads, stat names and section
  headings are now small monospace captions. The light theme's canvas is darker,
  so panels stand out from it.

- [`9f781ba`](https://github.com/mimshins/ork/commit/9f781baffcde3664aa2cb89134c55159e363a641) Thanks [@mimshins](https://github.com/mimshins)! - The browser UI uses containerized-state 3.4.0, its React package 3.4.0 and its
  persistence plugin 1.4.0.

- [`b737814`](https://github.com/mimshins/ork/commit/b7378146e7f7d78687cc639b3e89ddc7b98ce492) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` reads better and keeps its place. Chats shows what a node reported, and
  tool names in words; a run that has ended no longer shows nodes as queued; and
  the Monitor's header says when a run is waiting on you. For keyboards and screen
  readers: the focus stays in Notifications when an item goes, and goes to a new
  run's heading after starting it; lists stay named while open; filter results and
  the run's changes are said without talking over each other, and a minimized
  panel is no longer called closed. Selected, unread and disabled states now show
  in forced colors.

- [`01fd0d4`](https://github.com/mimshins/ork/commit/01fd0d446b3e77a274bc7d8afcfebd822ae01c0f) Thanks [@mimshins](https://github.com/mimshins)! - In `ork ui`, the Run workflow dialog's Project, Workflow and Driver lists opened
  behind the dialog, so typing seemed to do nothing. They show now, and typing
  highlights the first match for Enter to take. The dialog also says what to type,
  holds Workflow back until there is a project, and says when a project has no
  workflows or they cannot be read.

- [`60fff55`](https://github.com/mimshins/ork/commit/60fff55b7ca2551a03698810b2dea0190d9eb5f1) Thanks [@mimshins](https://github.com/mimshins)! - A workflow's first node can now loop back to itself with `maxRounds`, for a
  simple retry. `ork validate` used to reject this with "no node can start".

- [`58133bb`](https://github.com/mimshins/ork/commit/58133bb94bed48b57450f8d211d283f9555d5365) Thanks [@mimshins](https://github.com/mimshins)! - The Monitor in the browser view is rebuilt for long runs: a stat strip with
  spend against the budget, nodes done and elapsed time; smaller graph cards, with
  dotted edges for what hasn't started and moving packets into what's running; and
  a node table with a Now column saying what each node is doing, with its time and
  cost.

- [`28b5e51`](https://github.com/mimshins/ork/commit/28b5e5101301657f73e0bacdb329c9463b4b6213) Thanks [@mimshins](https://github.com/mimshins)! - `ork mcp` refuses an argument a tool doesn't take, rather than drop it, and
  `ork init --skills` keeps a copy of Ork's skills that a newer Ork wrote. The
  Claude Code plugin's hook stops `ork decide` only when it answers (`--id` or
  `--choose`), whatever else is on the line, and lets listing through; the plugin
  expects the oldest Ork it works with, not the newest release.

- [`e61aade`](https://github.com/mimshins/ork/commit/e61aadece634bf5391a89e9d409c49792fb562ce) Thanks [@mimshins](https://github.com/mimshins)! - A workflow or node that sets one built-in practice no longer undoes the other.
  Before, `defaults: { practices: { ponytail: ultra } }` in a workflow switched
  caveman back on when `.ork/project.yaml` had turned it off, and a node's
  `practices:` did the same to its agent's.

- [`445bf7c`](https://github.com/mimshins/ork/commit/445bf7c7b9376de4cc30dac8058357e6af2d4df4) Thanks [@mimshins](https://github.com/mimshins)! - Toasts in `ork ui` stay in their corner when more arrive than can show. Those
  over the limit were invisible but still took up room, which pushed the ones
  showing up the screen with each new one.

- [`74fd6bb`](https://github.com/mimshins/ork/commit/74fd6bb18b0008c0a2637dcf9e5b28252f440383) Thanks [@mimshins](https://github.com/mimshins)! - Add `ork relay`: introduce two running nodes of different runs, even in
  different repositories, so they can message each other while they work. Sessions
  get `wait_for_messages` to wait for a reply. See the guide, Working across
  projects.

- [`b86ebfc`](https://github.com/mimshins/ork/commit/b86ebfcb81ae86183257d3c0d42b2b94b63523bc) Thanks [@mimshins](https://github.com/mimshins)! - Fixes to checks, setup steps and MCP calls. A failed `verify:` now sends the
  real end of a long output, and a long error line no longer reaches the session
  whole. A resume stays within `maxTurns`, and a re-entered leader no longer loses
  a retry it can afford. A message that arrives during a passing check gets read.
  A node stopped or paused during `before:` starts no session. A run masks what
  `.mcp.json` reads across all its nodes, `plainEnv` works there, and numbers are
  masked in results. A server's slow start no longer fails at 60 seconds. A run no
  longer refuses a relative program it can't yet see, and `when: before.x` is now
  a compile error.

- [`eeceaf2`](https://github.com/mimshins/ork/commit/eeceaf2a9aba962c258040b40590b137cce50e41) Thanks [@mimshins](https://github.com/mimshins)! - Secrets read through `{{env.NAME}}` no longer reach the store in a JSON parse
  error, in JSON keys or numbers, in any form a JSON encoder writes them, line by
  line, as the values of a JSON secret, or from a later node or a called run that
  prints them. A node's new `plainEnv` lists variables that are not secret, so a
  region isn't masked. `$ORK_OUTPUT` and `$ORK_RUN_DIR` now point at the run's
  real folder. `ork decide` and `ork continue` refuse from a program or an agent
  in a run, and `ork ui` withholds its sign-in link there. A variable a called
  workflow needs gets a warning at the start, and the call fails if reached.
  SIGTERM and SIGHUP stop a run as Ctrl-C does.

- [`b84951e`](https://github.com/mimshins/ork/commit/b84951ea540b9d5210c853d6fbaddba563f1a853) Thanks [@mimshins](https://github.com/mimshins)! - Statuses in the browser view have new pixel glyphs and a monospace word, with a
  tinted pill in a run's header, and meters are now rows of blocks that turn red
  at the limit.

- [`879c00a`](https://github.com/mimshins/ork/commit/879c00ac17f383bc86b5e8e8a11b64b991bb3d1c) Thanks [@mimshins](https://github.com/mimshins)! - A run no longer hangs when a loop runs out of rounds and the answer is to stop,
  or when it's interrupted while that question is open, if the node had another
  edge still to follow. It now ends with the reason.

- [`c7a7e8f`](https://github.com/mimshins/ork/commit/c7a7e8f5cf8276183642bd7061109873260af5cb) Thanks [@mimshins](https://github.com/mimshins)! - Add `timeout` to tool and Claude nodes, `defaults` and `limits`, such as
  `timeout: 30m`. Time spent waiting on you doesn't count. A node that runs out
  fails with `timedOut` in its output, and a run ends as `timed_out`.
  
  `ork stop`, Ctrl-C and a timeout now end a tool node's command and whatever it
  started, even if they ignore SIGTERM. Before, they could keep running.

- [`f077fd2`](https://github.com/mimshins/ork/commit/f077fd21b2b8b5c840bf4d1063229c5d523348dd) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` now has Ork's look: a dark theme by default and a light one, each
  following your system's setting, with more contrast when the system asks for it.
  Text and controls meet WCAG 2.2 AA in every theme. The interface uses Geist and
  Geist Mono, served by `ork ui` itself.

- [`be3e2f8`](https://github.com/mimshins/ork/commit/be3e2f8c5486c2d3ffd668c0a866050c4245d1c2) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` now has its first panel: Runs lists your runs live, filtered by
  project, and **Run workflow** starts one, with a form for the workflow's inputs
  and the `ork run` command that does the same.

- [`dd9cf4c`](https://github.com/mimshins/ork/commit/dd9cf4c80fc4fe778cead50f7816189a76da6de7) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` keeps your saved layout and preferences more reliably: a change is
  saved even if something reacting to it fails, and saved data that does not fit
  is ignored.

- [`060c6be`](https://github.com/mimshins/ork/commit/060c6be59f9f467b3680a48be45d971701b3ddcf) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` now follows the server live: its status bar shows the runs and
  decisions in play, says why when it cannot reach the server, and recovers by
  itself when the server returns. The command palette sets the theme and the
  density, and your browser remembers them. The events API takes `?last=` for a
  run's newest events.

- [`97fec6c`](https://github.com/mimshins/ork/commit/97fec6c61102b1c1ce84f887e969b4d0a24f6a18) Thanks [@mimshins](https://github.com/mimshins)! - `ork ui` now opens a workspace: panels you can resize, dock, tab, float,
  maximize and minimize to a rail, by mouse or by keyboard, with a Window menu, a
  command palette (`⌘K` or `Ctrl K`) and a layout your browser remembers. Below
  1024 px wide the panels stack in one column. The panels themselves come next;
  until then each names the `ork` command that shows the same thing.

- [`1c28826`](https://github.com/mimshins/ork/commit/1c2882619e4d4727743d62f27b3f7f5d51b1aa8d) Thanks [@mimshins](https://github.com/mimshins)! - The Usage panel keeps its chart in view in the default dock, labels columns with
  their dates when there is room, marks the day or week still going, lines up its
  costs, lists only days with spend in its table, and offers `ork usage` commands
  and a retry. `ork usage --since 7d` now counts seven whole days, as the panel
  does. The Runs panel and the CLI show no spend as `$0.00`.

- [`3cb93db`](https://github.com/mimshins/ork/commit/3cb93db7a61c17b5dd9acd67bfedfdb082e70ec7) Thanks [@mimshins](https://github.com/mimshins)! - The browser view shows the values it names as inline code: a node, a field, a
  node type or a command, in Problems, notifications, decisions, dialogs and
  errors. Ork's messages mark those values with backticks in the terminal too.

- [`49b1e74`](https://github.com/mimshins/ork/commit/49b1e7406a4e0bccd517a184bee7fff1d32b7c05) Thanks [@mimshins](https://github.com/mimshins)! - A decision's card now shows its question exactly as written, backticks included,
  so a person approves the text they were asked about. Values with backticks of
  their own stay one value in more messages, and more values show as inline code,
  in the terminal too.

- [`e15d478`](https://github.com/mimshins/ork/commit/e15d47823397a03a0aa47948c351fc57571df6fe) Thanks [@mimshins](https://github.com/mimshins)! - Walking a workflow now says only what it tried: "no way the walk tried reaches
  `x`", not that no way does. It holds those warnings back in more places where
  they'd be wrong, such as a join behind a node that can run twice, a wait an
  input can end, or a gate's answer read through a router, and a walk of layered
  routers no longer takes minutes. A tool whose JSON says it failed is tried on
  exit 0 too. A failed Claude node keeps its branch. Logs and Chats show what a
  node said when it finished, and why it failed, exactly as written.

- [`49b1e74`](https://github.com/mimshins/ork/commit/49b1e7406a4e0bccd517a184bee7fff1d32b7c05) Thanks [@mimshins](https://github.com/mimshins)! - Fix what `ork validate` got wrong. `when.value` no longer stops a condition that
  can hold, such as `status == 'fail'` on a node with its own list of statuses, or
  a value a loop brings back to a router. A declared `status` a session can't
  report is now an error. Walking a workflow says a node never runs in fewer cases
  where it can, and stops at its time limit even inside one path. A failed node's
  output no longer holds values it didn't declare.

## 0.2.0

### Minor Changes

- [`25c965a`](https://github.com/mimshins/ork/commit/25c965a1d210a22e8d21c940cd7d3a01fea9c8c7) Thanks [@mimshins](https://github.com/mimshins)! - New: `ork upgrade`, and a notice when a newer Ork is out. Once a day, in the
  background, Ork asks the npm registry for the latest version and, when it is
  newer, ends a later command with one line saying so. `ork upgrade` upgrades Ork
  the way you installed it (npm, pnpm, yarn, bun or Volta), after asking;
  `--check` only reports, and `--yes` skips the question. `ork doctor` shows your
  version against the last check. The check is off in CI, without a terminal and
  with `--json`; `ORK_NO_UPDATE_CHECK=1` turns it off everywhere.

## 0.1.0

### Minor Changes

- [`8db91a2`](https://github.com/mimshins/ork/commit/8db91a26f38d0a5bb6f52a7afebbe04f00aec97f) Thanks [@mimshins](https://github.com/mimshins)! - An agent's Claude Code frontmatter `tools:` and `disallowedTools:` are now read:
  `tools: Read, Grep` leaves the node only those built-in tools (new `tools.only`,
  also settable on a node or in the agent's settings file), and Ork's own tools
  stay available.

- [`9a5e215`](https://github.com/mimshins/ork/commit/9a5e215e0827cf7354049198d6db308e5c090e63) Thanks [@mimshins](https://github.com/mimshins)! - New: agents. Define who does the work once and give it to any Claude node with
  `agent: <name>`; the node's `prompt` is its task, and anything set on the node
  wins. Agents come from `~/.ork/agents`, your project's `.claude/agents`,
  `.opencode/agents`, `.ai/agents` and `.ork/agents` (linked folders counted
  once), or a workflow's own `agents:` section. An agent is a portable `<name>.md`
  plus an optional `<name>.agent.yaml` with Ork's settings.
  `ork agents list | show | add | rm` manages them, `ork context explain` names
  the agent that fills a node, and both examples now use agents.

- [`bf31afe`](https://github.com/mimshins/ork/commit/bf31afe28f837507da9faec15661fffe2ef10305) Thanks [@mimshins](https://github.com/mimshins)! - Ork now ships built-in skills and agents. Skills: `ork:review` (review a change
  with git and report findings), `ork:brief` (write a self-contained brief to
  delegate) and `ork:report` (end with an honest report), named on a workflow or
  node. Agents: `ork-implementer` and `ork-reviewer`, which any agent of the same
  name in your project or `~/.ork/agents` replaces.

- [`8491499`](https://github.com/mimshins/ork/commit/84914999dd41f1dc8e247de7cc9c143c910d8543) Thanks [@mimshins](https://github.com/mimshins)! - New: `ork chat <run> <node>` talks to a leader or worker. While the run is
  going, each message reaches the node at its next step, even mid-task, and its
  replies stream back; a node that is not running gets it when it next starts.
  After the run, `ork chat` resumes the node's own session where it ran, so it
  remembers its work, and the exchange is added to the run's log. `-m` sends one
  message; `--driver` picks the driver for a resumed session. `ork logs` now also
  prints what comes after a run's summary.

- [`06c557b`](https://github.com/mimshins/ork/commit/06c557b6b812eb80b8891715973d0b0b463adfff) Thanks [@mimshins](https://github.com/mimshins)! - New: `claim` and `release` for nodes that write at the same time. A node claims
  a file, folder or other shared resource before it edits it; an overlapping claim
  is refused with who holds it, and the node is told when it is released. Claims
  are released when a node finishes, and `ork logs` shows them.

- [`8e990c2`](https://github.com/mimshins/ork/commit/8e990c2779a5b9928273db80ba1929f931662e03) Thanks [@mimshins](https://github.com/mimshins)! - Each Claude node's session is now compiled from its layers. Skills in
  `~/.ork/skills`, the workflow's `layers.skills` and a node's `skills` load as
  `ork:<name>` through a plugin Ork writes for the node; a project skill they
  shadow, or one `layers.project.skills` leaves out, is switched off; and
  `~/.ork/context`, `layers.context`, `.ork/lessons/<workflow>.md` and a node's
  `context` are added to its system prompt. References are `ork:<name>` or paths
  relative to the workflow file, and `ork validate` reports the ones that resolve
  to nothing. New: `ork context explain <wf> <node>` shows what a node's session
  loads, layer by layer, with estimated tokens. Ork leaves `AGENTS.md` to Claude
  Code, and `ork doctor` warns when `claude` is older than 2.1.281.

- [`393e7e3`](https://github.com/mimshins/ork/commit/393e7e344718707b18b5cf6e12c168cddf75cb2f) Thanks [@mimshins](https://github.com/mimshins)! - Questions now wait in one place. Every `ask_user` call, permission prompt, gate
  and exhausted loop is a decision in the store, answered on the run's own
  terminal or with the new `ork decide` from any other terminal, whichever comes
  first. New: `ork stop` stops a live run from anywhere, and `ork run --detach`
  runs in the background (its questions wait for `ork decide`). Each live run
  listens on a local socket, `~/.ork/sockets/<run>.sock`, so answers and `stop`
  reach it at once and `ork logs --follow` streams its events as they happen.

- [`515ad36`](https://github.com/mimshins/ork/commit/515ad3608dd492228654be5bb85203b8715886da) Thanks [@mimshins](https://github.com/mimshins)! - Leaders can now hand work to the nodes they own. A `claude.leader` in a run gets
  `delegate`, which runs its declared children in parallel and returns their
  reports, and `spawn_worker`, which starts more instances of a child worker up to
  the leader's `maxWorkers`. Ork commits the leader's work first, gives each child
  its own worktree branched from it, and merges each passing child back before the
  call returns. A waiting leader lends its session slot to its children, so
  `limits.concurrency: 1` cannot deadlock. A leader that a loop sends work back to
  now resumes its session instead of starting over. With the CLI driver, Ork's
  tool server allows calls of up to 24 hours, so long delegations are not cut off
  at 60 seconds.

- [`41c35c9`](https://github.com/mimshins/ork/commit/41c35c9fc471455cc7f263c3130e8a1744d0cb4e) Thanks [@mimshins](https://github.com/mimshins)! - Every run is now recorded in `~/.ork/state.db` (Node's built-in SQLite), with a
  copy in the project's `.ork/runs/<run>/events.jsonl`, secrets masked. New:
  `ork ps` lists runs, `ork logs` replays or follows a run's transcript (`--node`,
  `--follow`, `--json`), and `ork tree` shows the ownership tree with each node's
  state, tokens and cost. `ork run` now checks, before anything starts, that the
  programs its tool nodes run are installed, so integrations stay optional: only
  the ones a workflow uses must be there. `ork doctor` says so, and
  `ork context explain` accepts a workflow name like `ork run`.

- [`ca3542a`](https://github.com/mimshins/ork/commit/ca3542a5bc19274e34d4adeb0f1f83b7f7effe85) Thanks [@mimshins](https://github.com/mimshins)! - A `readonly` node with no owner now works in the worktree its input came from,
  so an approver after a leader reads the leader's branch. `ork validate <name>`
  finds a workflow by name, like `ork run`. The `software-factory` example ends
  with your go-ahead to push and open a pull request, and a new `pr-review`
  example reviews a checked-out pull request and posts a comment only if you say
  so.

- [`60dc067`](https://github.com/mimshins/ork/commit/60dc067c21bba714724d8ae6aee92a19930780f7) Thanks [@mimshins](https://github.com/mimshins)! - New: feedback capture. Ork notes what got in the way of a run, on your machine
  only: system signals from the run's own events (a loop out of rounds, a budget
  that ran out, a tool you denied, an Ork tool that failed, a gate that timed out,
  an answer other than the recommended one) and reports from agents through a new
  `feedback` tool (at most 3 per session). Records about the same thing are
  grouped into items: `ork feedback list`, `ork feedback show <item>` and
  `ork feedback dismiss <item>`.

- [`122e306`](https://github.com/mimshins/ork/commit/122e306cf5dc7b84c0d28e6087b100c8b7bd451f) Thanks [@mimshins](https://github.com/mimshins)! - First release: `ork init`, `ork validate` (schema, ownership tree, edges,
  bounded loops and references, with file, line and column), and `ork doctor`
  (your own claude, gh and aws logins; Ork stores no credentials).

- [`c8cafe9`](https://github.com/mimshins/ork/commit/c8cafe92aa28f6e1a56cdbaaa8ba4c8e1ab5b6a8) Thanks [@mimshins](https://github.com/mimshins)! - Readonly nodes now run read-only git (`git diff`, `log`, `show`, `status`, also
  with `-C <path>`) without asking; any other command asks instead of being
  impossible. New: `ork resume --detach` resumes a run in the background;
  `ork projects move <id> <path>` follows a clone you moved or renamed, with its
  runs; `ork feedback note <run> [<node>] -m <text>` records your own note or
  rating as feedback; `ork feedback restore <item>` brings back a dismissed item.

- [`8f3d063`](https://github.com/mimshins/ork/commit/8f3d0634ed2e2ed06eec96807b96b73387b9b33b) Thanks [@mimshins](https://github.com/mimshins)! - New: `isolation: continue`. A Claude node with no owner works in the worktree
  its input came from (found as for a readonly node, through control nodes and
  gates), writes there, and has its work committed on that worktree's branch; with
  no one worktree upstream it gets its own. A `continue` node can neither own
  nodes nor have a parent (`tree.continue`). Workflows drafted with
  `ork migrate --from-agents` now chain their agents in one worktree, so a later
  agent sees an earlier one's edits.

- [`5c67061`](https://github.com/mimshins/ork/commit/5c67061095af822059c249e9d2d26866dd213f6d) Thanks [@mimshins](https://github.com/mimshins)! - New: `ork link`. Make `.ork/agents` and `.ork/skills` the one place your agents
  and skills live, and point `.claude/agents`, `.opencode/skills` and the other
  tools' folders at them. It links the tools your project already uses (or the
  ones you name), never replaces a real folder or a link you made, and `--check`
  shows each folder's state. `ork init` links the same way (`--no-link` to skip),
  and `ork doctor` reports missing or broken links.

- [`7715239`](https://github.com/mimshins/ork/commit/771523930b1027a1eb4737045627832361c46b62) Thanks [@mimshins](https://github.com/mimshins)! - Nodes in a run can now message each other. `send_message` reaches a node's
  owner, the nodes it owns and the nodes it shares a `messages` channel with; the
  recipient gets a one-line notice at its next step, even mid-task, and reads the
  message with `read_inbox`. When a loop runs out of rounds while the leader that
  owns it is still working, Ork asks that leader (it replies with `answer`)
  instead of you; if its session ends first, the question comes to you as before.
  `ork logs` shows messages and these questions.

- [`06a6370`](https://github.com/mimshins/ork/commit/06a6370523684bf8db9771505ccb5faabd032a26) Thanks [@mimshins](https://github.com/mimshins)! - Messages are no longer lost: `ork resume` rebuilds each node's unread messages
  and your queued `ork chat` messages from the run's events, and a node whose
  session ends with an unread message (one that came in as it wrote its report)
  gets one more turn to read it and report again.

- [`d178455`](https://github.com/mimshins/ork/commit/d1784559773d1fc383803f7d4aae3ff6ff11ca9b) Thanks [@mimshins](https://github.com/mimshins)! - Claude nodes and `defaults` take an `effort` (`low`, `medium`, `high`, `xhigh`,
  `max`) next to `model`, so each node can think as hard as its task needs: for
  example opus at `high` for the planner and sonnet at `low` for reviewers. A
  node's own value wins, then `defaults`, then Claude Code's default for the
  model. Both drivers pass it on (`effort` for the Agent SDK, `--effort` for the
  CLI).

- [`be69fb8`](https://github.com/mimshins/ork/commit/be69fb85cbbe12735adc293f54b95c855e10a7ca) Thanks [@mimshins](https://github.com/mimshins)! - New: `ork migrate` moves an attached project into its repository's `.ork/`, with
  its runs, and records it as in-repo. `--agents` also moves the agents and skills
  your tools' folders hold (such as `.ai/agents`) into `.ork/` and points those
  folders at it. It shows the plan first, moves nothing on a clash or while a run
  is live, asks before applying (`--yes`, `--dry-run`), and commits nothing.
  `ork migrate --from-agents a,b --reviewer r` drafts a workflow from your agents:
  each in its worktree, a gate before the reviewer, a review loop, then a gated
  commit on a branch you name, with `git.commit: never`. A readonly node now
  follows its input through human gates too.

- [`57c8faf`](https://github.com/mimshins/ork/commit/57c8faffa5ffc898bcf94220797365c4bb1b5dd3) Thanks [@mimshins](https://github.com/mimshins)! - Built-in practices, on by default for every Claude node: **caveman** (a terse
  voice in chat, reports and messages; adapted from Caveman v4.0.1) and
  **ponytail** (the smallest complete change; adapted from Ponytail v5.3.2). Turn
  them off or set Ponytail's level with `practices:` on `defaults` or on a node;
  the setting cascades down the ownership tree, and a project skill of the same
  name takes precedence. The CLI now ships `THIRD_PARTY_NOTICES.md`.

- [`00a2597`](https://github.com/mimshins/ork/commit/00a2597d08753b7f895f77c19f0cc83499260c42) Thanks [@mimshins](https://github.com/mimshins)! - New: project rules. `.ork/project.yaml` says what Ork may do on its own in your
  project, and a workflow's `rules:` override it. `git.commit: never` runs no
  commit at all: worktrees are detached, work stays uncommitted, and a passing
  child's changes are applied to its owner's worktree (`merge: patch`).
  `merge: never` keeps every child's worktree. `git.base`, `git.branch` and
  `git.worktrees` take templates such as `{inputs.type}/{inputs.slug}`. The file
  also sets `permissions` for every Claude node, `defaults`, and `context` files.
  Ork still never pushes, never takes over a branch it did not create, and
  `ork worktrees` now lists what runs recorded creating, whatever it is called.
  
  New: `session: resume | fresh` on leaders, workers and agents, so a reviewer can
  keep its session across a loop's rounds.

- [`41e2167`](https://github.com/mimshins/ork/commit/41e21671f270eb793fcf4601c3f71e6e985074d3) Thanks [@mimshins](https://github.com/mimshins)! - New: `ork register` attaches a project from outside its repository. Its
  workflows, `project.yaml`, runs, lessons and agents live in
  `~/.ork/projects/<id>/`, and Ork writes nothing into the repository; inside the
  clone, `ork run <name>` finds them. An attached workflow reads the repository as
  if it were in `.ork/workflows/`, so it can move in later unchanged.
  `ork projects` lists registered projects (`forget` drops one, keeping its
  files), and `ork init` now records the in-repo project.

- [`73cc4d2`](https://github.com/mimshins/ork/commit/73cc4d28ce82c29ab396798e7b20bd4961ff5e15) Thanks [@mimshins](https://github.com/mimshins)! - `ork resume` now continues the Claude session of a node that was cut off
  mid-session (the run was stopped, crashed or ran out of budget), instead of
  starting it over; a node that failed in a failed run still starts fresh.

- [`bf1ab4f`](https://github.com/mimshins/ork/commit/bf1ab4fe9a3f923bfade62bd14039abb65e2d563) Thanks [@mimshins](https://github.com/mimshins)! - New: `ork resume <run>` continues a run that was stopped, failed, ran out of
  budget or crashed, under the same id. Nodes that finished keep their results and
  do not run again; the node that failed or was cut off runs again, with
  everything it feeds. The run keeps its inputs and flags (`--input`, `--driver`
  and `--in-place` change them), adopts the worktrees it left, and reuses your
  answers to its loop questions. Runs now record their inputs and flags so they
  can be resumed.

- [`a4fb707`](https://github.com/mimshins/ork/commit/a4fb707f7209905a2bd8f5bfd271b473065dd5aa) Thanks [@mimshins](https://github.com/mimshins)! - Add `ork run <workflow> --node <id>`: run one Claude node through the Agent SDK
  or your own `claude` CLI, with `--input`, `--driver`, `--in-place` and `--json`.
  It streams the transcript, prints the node's report and usage, and asks you on
  the terminal when the node has a question or wants a tool its rules leave open.

- [`c5dcaa4`](https://github.com/mimshins/ork/commit/c5dcaa4df86b90be13d0bd3ce6f94adb0a417145) Thanks [@mimshins](https://github.com/mimshins)! - `ork run <workflow>` now runs the whole workflow: flow edges and `when:`
  conditions, `control.split`, `control.router` and `control.join`, bounded loops
  that ask you when they run out of rounds, `tool.gh` / `tool.aws` / `tool.shell`
  nodes (no shell; checked against their `allow` list), `human.gate` with
  timeouts, and the run's budget and concurrency limits. The transcript prefixes
  each line with its node, and the run ends with a summary.

- [`0dc3c5c`](https://github.com/mimshins/ork/commit/0dc3c5c8cb39c14789cc91c28b5411e9bfd3c9d0) Thanks [@mimshins](https://github.com/mimshins)! - `claude.subagent` nodes now run: each is passed to its parent's session as a
  Claude Code subagent (the SDK's `agents`, the CLI's `--agents`), with its role,
  instructions and prompt as its system prompt, its description saying when to use
  it, and its model, turns and tool limits carried over.

- [`aff72f8`](https://github.com/mimshins/ork/commit/aff72f8c06c3ce8f7f9167b6999acdb7c3da2f85) Thanks [@mimshins](https://github.com/mimshins)! - New: `tool.git` nodes run your own `git`, so a commit can be an explicit step
  after your gates. Without `allow`, a `tool.git` node may run `add` and `commit`;
  `push` and anything else need the node's own `allow`. Its output has `staged`
  (the `git diff --cached --stat` summary), `diff` (the staged patch) and `head`,
  so a gate after an `add` step shows exactly what will be committed.
  `ork worktrees clean` keeps a detached worktree holding a commit no branch has
  unless `--force`, and `ork doctor` says whether your git identity is set.

- [`e748034`](https://github.com/mimshins/ork/commit/e748034dfcfcb08ceeed1df9b6deff6ae172f4f7) Thanks [@mimshins](https://github.com/mimshins)! - Each writing node now runs in its own git worktree, beside the clone in
  `../<clone>-worktrees/` on an `ork/<run>/<node>` branch, with your
  `CLAUDE.local.md`, `.claude/settings.local.json` and `.worktreeinclude` files
  copied in. Reviewers work in their owner's worktree, a passing child is merged
  into its owner's branch, and the run keeps its result's worktree for you. A run
  refuses to start while instructions or skills have uncommitted changes
  (`--allow-dirty` to override). New: `ork worktrees` lists Ork's worktrees and
  branches, and `ork worktrees clean` removes them safely. `ork init` no longer
  adds `.ork/worktrees/` to `.gitignore`.

### Patch Changes

- [`95169dc`](https://github.com/mimshins/ork/commit/95169dcf28d819acaebfb0219ccdb29955695a65) Thanks [@mimshins](https://github.com/mimshins)! - `ork --version` reports the published version, bound from `package.json` at
  release and build time; feedback records carry the same version.

- [`79147f2`](https://github.com/mimshins/ork/commit/79147f209d4ef566684cf2528ba777434ddbec32) Thanks [@mimshins](https://github.com/mimshins)! - `ork worktrees` now shows the branch a workflow made in a worktree Ork created
  detached (`commit: never`, then `tool.git` `switch -c`), with its unmerged
  commits, instead of "detached, nothing committed"; `clean` never deletes that
  branch. A workflow drafted by `ork migrate --from-agents` takes a `message`
  input for its commit instead of using the task.
