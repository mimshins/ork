# @krapht/ork

## 0.1.0

### Minor Changes

- [`9a5e215`](https://github.com/mimshins/ork/commit/9a5e215e0827cf7354049198d6db308e5c090e63) Thanks [@mimshins](https://github.com/mimshins)! - New: agents. Define who does the work once and give it to any Claude node with
  `agent: <name>`; the node's `prompt` is its task, and anything set on the node
  wins. Agents come from `~/.ork/agents`, your project's `.claude/agents`,
  `.opencode/agents`, `.ai/agents` and `.ork/agents` (linked folders counted
  once), or a workflow's own `agents:` section. An agent is a portable `<name>.md`
  plus an optional `<name>.agent.yaml` with Ork's settings.
  `ork agents list | show | add | rm` manages them, `ork context explain` names
  the agent that fills a node, and both examples now use agents.

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
