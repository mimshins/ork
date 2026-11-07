/**
 * @file The roadmap: Ork's milestones and what each holds, with the commits
 *   that shipped it. A milestone's progress is worked out from its items, never
 *   stored. `pnpm map:check` checks every commit, date and doc link, and lists
 *   commits on `main` that no item names. Keep it true in the same change that
 *   ships an item ([roadmap.md](../../../roadmap.md)).
 */

/**
 * - `done`: shipped on `main`, with the commits that did it.
 * - `active`: being built now.
 * - `next`: the next thing to build.
 * - `planned`: specified or designed, not started.
 * - `waiting`: ready, held for a decision.
 *
 * @typedef {"done" | "active" | "next" | "planned" | "waiting"} Progress
 */

/**
 * @typedef {object} RoadmapItem
 * @property {string} id Unique on the roadmap.
 * @property {string} title What it is, in a few words.
 * @property {Progress} status
 * @property {string} [detail] One or two sentences; backticks for code.
 * @property {string[]} [commits] Short hashes on `main`, oldest first.
 * @property {string} [date] `YYYY-MM-DD` it shipped: its newest commit's date.
 * @property {string[]} [docs] Repository paths, optionally with `#anchor`.
 */

/**
 * @typedef {object} Milestone
 * @property {string} id E.g. `m1c`.
 * @property {string} title E.g. `M1c · Engine`.
 * @property {string} goal What it delivers, in one sentence.
 * @property {RoadmapItem[]} items In build order.
 */

/** @type {Milestone[]} */
export const MILESTONES = [
  {
    id: "m0",
    title: "M0 · Bootstrap",
    goal: "A public monorepo with CI, the house rules, and the process for building the rest.",
    items: [
      {
        id: "monorepo",
        title: "Monorepo, CI and licence",
        status: "done",
        detail:
          "pnpm workspaces running TypeScript from source, oxlint and oxfmt, vitest, GitHub Actions pinned by SHA, MIT.",
        commits: ["e94370f"],
        date: "2026-10-30",
        docs: ["README.md", "AGENTS.md"],
      },
      {
        id: "spec-driven",
        title: "Spec-driven development and releases",
        status: "done",
        detail:
          "Task specs, RFCs and ADRs for design changes; the design split into specs; changesets and one bundled CLI.",
        commits: ["122e306"],
        date: "2026-10-30",
        docs: [
          "decisions/ADR-001-spec-driven-development.md",
          "runbook/development/release.md",
        ],
      },
      {
        id: "interaction-map",
        title: "Interaction map",
        status: "done",
        detail:
          "An interactive map of how Ork works, with an honest status on every card, checked against the code.",
        commits: ["8f1ddd3", "81b9d83", "5f50dca", "5652c4d"],
        date: "2026-10-30",
        docs: ["docs/interaction-map/README.md"],
      },
      {
        id: "feedback-design",
        title: "Feedback loop, designed",
        status: "done",
        detail:
          "How runs capture friction and turn it into fixes and lessons, and the Discussions forms for sharing it. Building it is M1d and M2.",
        commits: ["2108936", "34f873a"],
        date: "2026-10-30",
        docs: ["specs/feedback.md"],
      },
    ],
  },
  {
    id: "m1a",
    title: "M1a · Schema",
    goal: "Workflows as git-friendly YAML, validated before anything runs.",
    items: [
      {
        id: "format",
        title: "Workflow file format",
        status: "done",
        detail:
          "The Zod model, canonical YAML that round-trips byte for byte, and a JSON Schema for editor autocomplete.",
        commits: ["e94370f"],
        date: "2026-10-30",
        docs: ["specs/workflow-format.md"],
      },
      {
        id: "compiler",
        title: "Graph compiler, `ork init`, `ork validate`",
        status: "done",
        detail:
          "Ownership rules, loops that need `maxRounds`, safe expressions, and errors with YAML line numbers.",
        commits: ["8f1ddd3"],
        date: "2026-10-30",
        docs: ["specs/graph-compiler.md", "specs/expressions.md"],
      },
    ],
  },
  {
    id: "m1b",
    title: "M1b · Runtime",
    goal: "One Claude node runs end to end on the user's own account.",
    items: [
      {
        id: "doctor",
        title: "`ork doctor`",
        status: "done",
        detail:
          "Checks node, git, `claude`, `gh` and `aws` logins, and reports them; Ork never handles credentials.",
        commits: ["8f1ddd3"],
        date: "2026-10-30",
        docs: ["specs/cli/worktrees-agents-context-and-doctor.md#doctor"],
      },
      {
        id: "drivers",
        title: "Runtime port and both drivers",
        status: "done",
        detail:
          "The Agent SDK and the headless `claude` CLI behind one port, with Ork's MCP tools and the report as structured output.",
        commits: ["924b06b"],
        date: "2026-10-30",
        docs: ["specs/runtime.md"],
      },
      {
        id: "run-node",
        title: "`ork run --node`",
        status: "done",
        detail:
          "Runs one Claude node with a live transcript, questions and permission prompts on the terminal.",
        commits: ["a4fb707"],
        date: "2026-10-30",
        docs: ["specs/cli/running-and-runs.md#running-one-node"],
      },
    ],
  },
  {
    id: "m1c",
    title: "M1c · Engine",
    goal: "`ork run` runs a whole workflow: edges, loops, worktrees, delegation, compiled context.",
    items: [
      {
        id: "scheduler",
        title: "Scheduler and built-in node types",
        status: "done",
        detail:
          "Edges, joins, routers, bounded loops, tool nodes, human gates, the run budget and concurrency.",
        commits: ["c5dcaa4"],
        date: "2026-10-30",
        docs: ["specs/scheduler.md"],
      },
      {
        id: "worktrees",
        title: "Worktrees and `ork worktrees`",
        status: "done",
        detail:
          "A worktree per writing node beside the clone, merges into the owner, and a command to list and clean them.",
        commits: ["e748034"],
        date: "2026-10-30",
        docs: ["specs/worktrees.md"],
      },
      {
        id: "practices",
        title: "Built-in practices",
        status: "done",
        detail:
          "Caveman and ponytail on by default, with a `practices:` block to turn them off for a node or a subtree.",
        commits: ["57c8faf"],
        date: "2026-10-30",
        docs: ["specs/context.md#built-in-practices"],
      },
      {
        id: "registries",
        title: "Integrations behind registries",
        status: "done",
        detail:
          "One adapter per CLI tool and Claude driver, so adding GitLab or GCP is one file and one line.",
        commits: ["858293a"],
        date: "2026-10-30",
        docs: ["decisions/ADR-022-integration-registry.md"],
      },
      {
        id: "delegation",
        title: "Delegation and leader resume",
        status: "done",
        detail:
          "`delegate` and `spawn_worker` run a leader's children in parallel and merge them back; a re-entered leader resumes its session.",
        commits: ["515ad36"],
        date: "2026-10-30",
        docs: ["specs/scheduler.md#delegation"],
      },
      {
        id: "effort",
        title: "Per-node effort",
        status: "done",
        detail:
          "`effort:` next to `model:` on each Claude node and in `defaults`.",
        commits: ["d178455"],
        date: "2026-10-30",
        docs: ["specs/workflow-format.md"],
      },
      {
        id: "context-compiler",
        title: "Context compiler",
        status: "done",
        detail:
          "The layers and their precedence, Ork's skills as an `ork` plugin per node, project skills switched off when shadowed, and `ref.skill` diagnostics.",
        commits: ["8e990c2"],
        date: "2026-10-30",
        docs: ["specs/context.md", "decisions/ADR-023-context-compiler.md"],
      },
      {
        id: "context-explain",
        title: "`ork context explain`",
        status: "done",
        detail:
          "Prints a node's resolved layer stack: where each item came from, what was shadowed, and estimated tokens.",
        commits: ["8e990c2"],
        date: "2026-10-30",
        docs: ["specs/cli/worktrees-agents-context-and-doctor.md#context"],
      },
    ],
  },
  {
    id: "release",
    title: "Release · 0.1.0",
    goal: "`@krapht/ork` on npm.",
    items: [
      {
        id: "docs-center",
        title: "User docs center",
        status: "done",
        detail:
          "A short README that links everything; `docs/` with installation (macOS, Linux, Windows via WSL), a quickstart and guides; contributor docs in CONTRIBUTING.md.",
        commits: ["573749c"],
        date: "2026-10-30",
        docs: [
          "docs/README.md",
          "docs/getting-started/installation.md",
          "CONTRIBUTING.md",
        ],
      },
      {
        id: "logo",
        title: "Logo",
        status: "done",
        detail:
          "A phosphor fan mark: an amber owner node handing work down three fading green beams, then the final prompt mark on the logotype's pixel grid, with the favicon and device icons.",
        commits: ["61bcdd9", "25435a9", "902a563"],
        date: "2026-10-30",
        docs: ["assets/logo/README.md"],
      },
      {
        id: "gaps-closed",
        title: "Close the gaps register",
        status: "done",
        detail:
          "Every gap built: sub-agents run in their owner's session, messages survive a resume, a late message gets one more turn, built-in `ork:*` skills and `ork-*` agents, `ork resume --detach`, feedback notes and restore. Limits fixed: readonly nodes read git, agents' Claude Code `tools`, cut-off sessions resume, `ork projects move`; CI pinned. The other limits wait for the M2 review.",
        commits: [
          "c8cafe9",
          "8db91a2",
          "73cc4d2",
          "06a6370",
          "0dc3c5c",
          "bf31afe",
        ],
        date: "2026-11-02",
        docs: ["specs/gaps.md"],
      },
      {
        id: "first-release",
        title: "First npm release",
        status: "done",
        detail:
          "`@krapht/ork` 0.1.0 is on npm, published by the release workflow with provenance once the gaps register was closed; `npm install --global @krapht/ork` installs it.",
        commits: ["378fa98"],
        date: "2026-11-01",
        docs: [
          "runbook/development/release.md",
          "docs/getting-started/installation.md",
        ],
      },
      {
        id: "update-notice",
        title: "New-version notice and `ork upgrade`",
        status: "done",
        detail:
          "A daily background check of the npm registry ends a later command with a one-line notice; `ork upgrade` upgrades through the package manager that installed Ork, after asking. Off in CI, without a terminal, or with `ORK_NO_UPDATE_CHECK=1`.",
        commits: ["25c965a"],
        date: "2026-11-02",
        docs: [
          "decisions/ADR-038-update-notice-and-upgrade.md",
          "specs/cli/updates.md",
        ],
      },
    ],
  },
  {
    id: "m1d",
    title: "M1d · Human loop",
    goal: "Watch, steer and answer a run while it works, and keep everything it did.",
    items: [
      {
        id: "event-store",
        title: "Event store, `ork logs`, `ps`, `tree`",
        status: "done",
        detail:
          "Every run event in `~/.ork/state.db` (built-in SQLite) and a JSONL file per run, secrets masked, and the commands that replay them; tool programs a workflow needs are checked before it starts.",
        commits: ["41c35c9"],
        date: "2026-10-30",
        docs: ["specs/event-store.md", "decisions/ADR-024-event-store.md"],
      },
      {
        id: "bus",
        title: "Message bus",
        status: "done",
        detail:
          "`send_message` and `read_inbox` along the ownership tree and declared channels: a one-line notice at the recipient's next step, mid-turn, and the body pulled when it reads.",
        commits: ["7715239"],
        date: "2026-10-30",
        docs: ["specs/messaging.md", "decisions/ADR-025-message-bus.md"],
      },
      {
        id: "owner-escalation",
        title: "Escalation to a live owner",
        status: "done",
        detail:
          "A loop out of rounds asks the leader that owns its nodes while that leader's session is live (it replies with `answer`), and you only when it cannot.",
        commits: ["7715239"],
        date: "2026-10-30",
        docs: ["specs/scheduler.md#loops"],
      },
      {
        id: "decisions",
        title: "Decision queue, `ork decide`, `stop`, `--detach`",
        status: "done",
        detail:
          "Every question, permission prompt and gate in one inbox, answered from the run's terminal or `ork decide` in any other (first wins); `ork stop` and background runs, woken on a per-run socket.",
        commits: ["393e7e3"],
        date: "2026-10-30",
        docs: ["specs/messaging.md", "specs/cli.md"],
      },
      {
        id: "chat",
        title: "`ork chat`",
        status: "done",
        detail:
          "Talk to a node while it runs (your message reaches it at its next step) or after, by resuming its own session; the exchange goes in the run's log.",
        commits: ["8491499"],
        date: "2026-10-30",
        docs: ["specs/cli.md", "specs/messaging.md#chat"],
      },
      {
        id: "resume",
        title: "`ork resume`",
        status: "done",
        detail:
          "Continue a stopped, failed or crashed run under its own id: finished nodes keep their results (replayed from its events), the rest run again, in the worktrees it left.",
        commits: ["bf1ab4f"],
        date: "2026-10-30",
        docs: [
          "specs/cli/running-and-runs.md#resuming-a-run",
          "decisions/ADR-026-resume-by-replay.md",
        ],
      },
      {
        id: "claims",
        title: "`claim` and `release`",
        status: "done",
        detail:
          "Parallel writers claim files, folders or names before they edit; an overlapping claim is refused with who holds it, and released claims are announced.",
        commits: ["06c557b"],
        date: "2026-10-31",
        docs: [
          "specs/messaging.md#claims",
          "decisions/ADR-027-advisory-claims.md",
        ],
      },
      {
        id: "feedback-capture",
        title: "Feedback capture",
        status: "done",
        detail:
          "The `feedback` tool, six system signals from a run's events, fingerprints grouping records into items, and `ork feedback list | show | dismiss`.",
        commits: ["60dc067"],
        date: "2026-10-31",
        docs: [
          "specs/feedback.md",
          "decisions/ADR-028-feedback-capture.md",
          "docs/guides/feedback.md",
        ],
      },
      {
        id: "examples",
        title: "`software-factory` and `pr-review` examples",
        status: "done",
        detail:
          "Both ran end to end on the CLI driver, locally, with every gate kept; the run showed readonly nodes after a leader need its worktree, now theirs.",
        commits: ["ca3542a"],
        date: "2026-10-31",
        docs: [
          "docs/guides/examples.md",
          "examples/pr-review.ork.yaml",
          "decisions/ADR-029-readonly-follows-its-input.md",
        ],
      },
      {
        id: "examples-sdk",
        title: "The examples on the SDK driver",
        status: "waiting",
        detail:
          "Needs `ANTHROPIC_API_KEY` (or Bedrock or Vertex) on the machine that runs it.",
        docs: ["specs/gaps.md"],
      },
    ],
  },
  {
    id: "m1e",
    title: "M1e · Projects",
    goal: "Ork as mechanism, the project as policy: agents registered once and assigned to nodes, project rules for everything Ork does on its own, and a project's whole process movable into `.ork/`.",
    items: [
      {
        id: "agents",
        title: "Agents, registered and assigned to nodes",
        status: "done",
        detail:
          "An agent is a portable `<name>.md` plus an optional `<name>.agent.yaml`; a Claude node takes `agent:` and its prompt is the task. Sources are layered: built-in, `~/.ork/agents`, the project's (and its tool folders'), the workflow's own.",
        commits: ["9a5e215"],
        date: "2026-10-31",
        docs: [
          "specs/workflow-format.md#agents",
          "specs/context.md#agents",
          "decisions/ADR-030-agents-fill-nodes.md",
          "docs/guides/agents.md",
        ],
      },
      {
        id: "link",
        title: "`.ork/` as the origin, tool folders linked",
        status: "done",
        detail:
          "`ork link` points `.claude/`, `.opencode/`, `.agents/` and `.ai/` folders at `.ork/agents` and `.ork/skills`, one adapter per tool; it only creates, `ork init` links the tools in use, and `ork doctor` reports the links.",
        commits: ["5c67061"],
        date: "2026-10-31",
        docs: [
          "specs/cli/worktrees-agents-context-and-doctor.md#linking-tool-folders",
          "decisions/ADR-031-ork-is-the-origin.md",
          "docs/guides/agents.md#linking-your-tools-to-ork",
        ],
      },
      {
        id: "rules",
        title: "Project rules",
        status: "done",
        detail:
          "`.ork/project.yaml` and a workflow's `rules:`: `commit: never` (detached worktrees, work handed over as patches), `merge: patch | never`, branch, worktree and base templates, permissions, defaults and context; `ork worktrees` reads what runs recorded. `session: resume` on any Claude node.",
        commits: ["00a2597"],
        date: "2026-10-31",
        docs: [
          "specs/project-rules.md",
          "decisions/ADR-032-project-rules.md",
          "decisions/ADR-033-session-resume-on-any-node.md",
          "docs/guides/project-rules.md",
        ],
      },
      {
        id: "tool-git",
        title: "`tool.git` node",
        status: "done",
        detail:
          "The user's own `git` as a node, so a commit is an explicit step after the gates: `add` and `commit` without an `allow`, `push` only when listed; its output has the staged changes and `head` for a gate to show. Clean keeps a commit on no branch.",
        commits: ["aff72f8"],
        date: "2026-10-31",
        docs: [
          "specs/workflow-format.md",
          "decisions/ADR-034-tool-git.md",
          "docs/guides/project-rules.md#committing-as-a-step",
        ],
      },
      {
        id: "register",
        title: "Register a project from outside the repo",
        status: "done",
        detail:
          "`ork register` and `ork projects`: workflows, rules, runs, lessons and agents in `~/.ork/projects/<id>/`, nothing written into the repository; an attached workflow reads the repository as if it were in `.ork/workflows/`. `ork init` records the in-repo project.",
        commits: ["41e2167"],
        date: "2026-10-31",
        docs: [
          "specs/projects.md",
          "decisions/ADR-035-projects-in-repo-or-attached.md",
          "docs/guides/projects.md",
        ],
      },
      {
        id: "migrate",
        title: "`ork migrate`",
        status: "done",
        detail:
          "Moves an attached project into `.ork/` with its runs; `--agents` moves the agents and skills (se-backend's `.ai/`) into `.ork/` and relinks every tool folder; a checked plan, asked first, nothing committed. `--from-agents` drafts a gated workflow: the agents in order, a reviewer loop, a gated commit under `commit: never`.",
        commits: ["be69fb8"],
        date: "2026-10-31",
        docs: [
          "specs/projects.md#migrating",
          "decisions/ADR-036-ork-migrate.md",
          "docs/guides/projects.md#moving-into-the-repository",
        ],
      },
      {
        id: "se-backend",
        title: "A real project end to end",
        status: "done",
        detail:
          "se-backend (a local clone) registered from outside with `commit: never`, its `<type>/<slug>` worktrees and `origin/main`; its process drafted from its agents and run on haiku with every gate answered through `ork decide`, committing on the new branch for $0.03. It showed a workflow's branch missing from `ork worktrees` (fixed) and agents diverging in separate worktrees (L21).",
        commits: ["79147f2"],
        date: "2026-10-31",
        docs: [
          "docs/guides/projects.md#a-worked-example-a-project-with-its-own-process",
          "specs/gaps.md",
        ],
      },
    ],
  },
  {
    id: "m2",
    title: "M2 · UI",
    goal: "`ork ui`: design, run and watch workflows in the browser, on the same engine.",
    items: [
      {
        id: "server",
        title: "Local server",
        status: "done",
        detail:
          "`ork ui` and `@krapht/ork-server`: a JSON API with live event streams on 127.0.0.1, on `node:http` with a typed contract and client. One more client of the store and the sockets: it runs nothing, starts runs detached, and sits behind a per-start token that becomes a cookie. A placeholder page lists runs and decisions live.",
        commits: ["53e1826"],
        date: "2026-11-02",
        docs: [
          "specs/server.md",
          "decisions/ADR-039-local-server.md",
          "docs/getting-started/installation.md#the-browser-view",
        ],
      },
      {
        id: "monitor",
        title: "Monitor, logs, decisions, chats",
        status: "done",
        date: "2026-11-03",
        detail:
          "The UI app and its design system, a dockable workspace, the live graph and ownership tree with status and cost, the event log, the decisions inbox, a chat per node, notifications, and pause, continue and stop for a run or a node.",
        docs: [
          "specs/ui.md",
          "decisions/ADR-040-ui-stack.md",
          "specs/run-control.md",
          "docs/guides/browser-view.md",
        ],
        commits: [
          "08d40b8",
          "e3998b2",
          "f077fd2",
          "e509782",
          "97fec6c",
          "060c6be",
          "be3e2f8",
          "445bf7c",
          "01fd0d4",
          "e26fb35",
          "0f0b3f0",
          "dead65e",
          "b737814",
          "2f9cbd5",
        ],
      },
      {
        id: "timeouts",
        title: "Timeouts on nodes and runs",
        status: "done",
        date: "2026-11-03",
        commits: ["c7a7e8f"],
        detail:
          "A `timeout` on tool nodes, Claude nodes and the whole run, whose clock stands still while waiting on the user. An expired node fails with `timedOut`, and a run ends `timed_out`. Tools run in their own process groups, so a stop or a timeout ends what they started.",
        docs: [
          "decisions/ADR-043-timeouts.md",
          "specs/scheduler.md#timeouts",
          "docs/guides/models-and-budgets.md#timeouts",
        ],
      },
      {
        id: "relay",
        title: "A relay between runs",
        status: "done",
        date: "2026-11-03",
        commits: ["74fd6bb", "bf37ee7"],
        detail:
          "`ork relay` introduces nodes of runs in different repositories, so they work in parallel and message each other through the store and the runs' sockets. Proven on real sessions in two repositories on the CLI driver; the SDK driver is tracked in C5.",
        docs: [
          "decisions/ADR-044-relay-between-runs.md",
          "specs/messaging/links.md",
          "docs/guides/working-across-projects.md",
        ],
      },
      {
        id: "workflow-call",
        title: "Workflows that call workflows",
        status: "done",
        date: "2026-11-03",
        commits: ["5e3411d"],
        detail:
          "A `workflow.call` node starts a workflow in this project or another, waits on it if asked, and uses its output in later conditions. A `messages` channel to it lets agents talk during the work. Comes before the Monitor, which shows calls.",
        docs: [
          "decisions/ADR-045-workflows-calling-workflows.md",
          "specs/scheduler/calls.md",
          "docs/guides/working-across-projects.md#calling-a-workflow",
          "rfcs/archived/RFC-004-workflows-calling-workflows.md",
        ],
      },
      {
        id: "usage-reports",
        title: "Usage reports and pruning",
        status: "done",
        detail:
          "`ork usage` and a Usage panel add up what sessions spent over time, from a ledger the events fill, with hints from thresholds; no model is involved. `ork prune` forgets old runs and keeps the ledger. Corrects a resumed session's cost, which was counted again.",
        commits: ["aea062e", "1c28826"],
        date: "2026-11-04",
        docs: [
          "decisions/ADR-046-usage-ledger-and-prune.md",
          "specs/usage.md",
          "docs/guides/models-and-budgets.md#what-you-spent",
        ],
      },
      {
        id: "script-access",
        title: "Scripts that reach the run",
        status: "done",
        date: "2026-11-04",
        detail:
          "Tool nodes know their run and node, take an `env:`, and return JSON a `when:` can read. They can send a message with `ork send`, and a workflow can declare one with `notify:`, so deterministic work takes no model turn (built, RFC-005). A node can check a report with `verify:`, set itself up with `before:`, hold a short `script:`, and call an MCP tool with `mcp.call` (built, RFC-006).",
        commits: [
          "c4cdefe",
          "ef82721",
          "eeceaf2",
          "b98d841",
          "515b9eb",
          "b86ebfc",
        ],
        docs: [
          "decisions/ADR-047-script-identity-env-json.md",
          "decisions/ADR-048-scripts-and-rules-on-the-bus.md",
          "specs/messaging/scripts.md",
          "decisions/ADR-049-steps-mcp-calls-and-scripts.md",
          "specs/scheduler/steps.md",
          "specs/workflow-format.md",
        ],
      },
      {
        id: "quotas",
        title: "Quotas across runs",
        status: "done",
        date: "2026-11-04",
        detail:
          "Caps per day, week or month, for all projects or one, on top of each run's budget, from the ledger. A plan's rate limit stops runs too, on a subscription. At a limit a run stops, and `ork resume` goes on in the same session.",
        commits: ["636fcd6"],
        docs: [
          "decisions/ADR-050-limits-across-runs.md",
          "specs/usage.md#limits-across-runs",
          "docs/guides/models-and-budgets.md#limits-across-runs",
        ],
      },
      {
        id: "workflow-builder",
        title: "Workflow builder",
        status: "done",
        date: "2026-11-04",
        detail:
          "Create a workflow from scratch in the UI, or edit one, on a canvas that saves the same YAML with its comments, with no file to write by hand. Forms cover the whole format, positions follow from the nodes and edges, and drafts wait in the store until they pass the checks (RFC-008).",
        commits: ["c4ccda9", "ef213ef"],
        docs: [
          "decisions/ADR-051-workflow-builder.md",
          "rfcs/archived/RFC-008-workflow-builder.md",
          "specs/ui.md#workflow-builder",
          "docs/guides/browser-view/panels-and-workspace.md#builder",
        ],
      },
      {
        id: "declared-outputs",
        title: "Conditions from choices",
        status: "done",
        date: "2026-11-04",
        detail:
          "Prevent typos instead of reporting them. Tools and MCP calls can declare their output, a run holds every node to what it declared, and the builder's conditions become dropdowns over those values. RFC-010.",
        docs: [
          "decisions/ADR-052-conditions-from-declared-outputs.md",
          "rfcs/archived/RFC-010-conditions-from-declared-outputs.md",
        ],
        commits: ["bd80e12", "3df572f"],
      },
      {
        id: "watching",
        title: "Watch a source",
        status: "done",
        detail:
          "Wait on something outside a run, or start a run when it happens, with no model turn until it does: a `watch:` block on tool and MCP nodes, and `ork watch` with declared triggers. RFC-011, which also answers what Schedules and webhooks waited on.",
        docs: [
          "decisions/ADR-053-watching-a-source.md",
          "rfcs/archived/RFC-011-watching-a-source.md",
          "specs/scheduler/watching.md",
        ],
        commits: ["dfed497", "1ea63a7", "aadf43a"],
        date: "2026-11-04",
      },
      {
        id: "workflow-walk",
        title: "Check every way through",
        status: "done",
        date: "2026-11-06",
        commits: [
          "3cb93db",
          "7b82d08",
          "613e91d",
          "8100584",
          "9071e39",
          "5d080bc",
          "fb6009d",
          "39f8062",
          "49b1e74",
          "c70d82f",
          "e15d478",
          "9389c79",
          "49b3681",
          "3947f51",
          "b5a2bee",
        ],
        detail:
          "Before a run, find what can't work: a condition that's never true, a node no path reaches, a loop that can only run out of rounds. The stricter compiler checks are in: a value a condition can never see stops the run, and loops without an exit or a budget warn. The walk of every outcome on the real scheduler is built too, with no sessions and no scripts, and `ork validate`, `ork run` and the builder show what it finds. Reviews found false warnings, so its warnings say only what it tried, held to a fuzz against the real scheduler and to each case found. The guide says what it can't tell, and the limits are in the register. RFC-009, after RFC-010.",
        docs: [
          "decisions/ADR-056-walking-a-workflow.md",
          "rfcs/archived/RFC-009-walking-a-workflow.md",
        ],
      },
      {
        id: "worktrees-panel",
        title: "Worktrees panel",
        status: "done",
        date: "2026-11-07",
        detail:
          "What `ork worktrees` lists, in the browser, for every project Ork knows, with cleanup a click away: Remove… for one item, with a second, explicit confirm listing what's lost when it needs force, and Clean merged…, merged only and never forced, each read, then confirmed against a digest of the plan shown. `ork worktrees remove` is its twin in a terminal, and both plan in core, so neither removes what the other would keep. Building it found that a clean could take a live run's worktree, which it now always keeps. Its accessibility review set the focus, the names and the failures right, and found the panels' headings skip a level (G10).",
        docs: [
          "specs/worktrees.md",
          "specs/ui/panels-worktrees.md",
          "docs/guides/worktrees.md",
          "specs/gaps/limits-worktrees.md",
        ],
        commits: ["9b568c9", "52dc034", "4be0fe3"],
      },
      {
        id: "console-language",
        title: "A new look for the console",
        status: "done",
        detail:
          "Nested surfaces, two type voices, block meters and a pixel touch, at console density, from a prototype the maintainer approved. Each component now owns its tokens, and a state only sets tokens, so the look changes by changing values. Frames, status glyphs, block meters, tighter panels, the rebuilt Monitor, shorter Notifications rows and the Builder's cards are all in, with new screenshots in the browser guide. Since then, every command the page shows is a code block with its copy button in the corner, never inline code, and a copy button sits only on a block; a test reads the UI's source for a command in backticks.",
        docs: [
          "decisions/ADR-054-component-tokens.md",
          "decisions/ADR-055-console-language.md",
          "specs/ui/design-system.md",
          "specs/ui/design-components-and-copy.md#copy",
        ],
        commits: [
          "b296577",
          "b5943d7",
          "1ad00e4",
          "ba45ab6",
          "b84951e",
          "f1f5123",
          "41621da",
          "41dab31",
          "58133bb",
          "9d49d01",
          "db5c52c",
          "06a6627",
          "52dc034",
        ],
        date: "2026-11-07",
      },
      {
        id: "ui-upgrade",
        title: "New-version banner and upgrade",
        status: "done",
        date: "2026-11-07",
        detail:
          "The CLI's new-version notice as a banner in `ork ui`, from the same record, which the server keeps fresh itself while it stays open. Upgrade… runs `ork upgrade`'s plan once you confirm and streams the package manager's output, and Restart brings `ork ui` back on the new install, on the same port and still signed in: `ork ui` now supervises its server as a child to do it (ADR-060). A clone or an `npx` copy gets the steps instead, each command as a block. Its accessibility review gave each step's heading the focus as it opens, and the banner's button the focus on close.",
        docs: [
          "decisions/ADR-060-ork-ui-supervises-its-server.md",
          "specs/cli/updates.md",
          "docs/guides/browser-view/new-versions.md",
          "specs/gaps/limits-upgrade.md",
        ],
        commits: ["0cb18a2", "52dc034", "4be0fe3"],
      },
      {
        id: "context-inspector",
        title: "Context inspector",
        status: "done",
        date: "2026-11-06",
        detail:
          "A read-only Context panel with the latest chosen node's layer stack, as `ork context explain` prints it: what it is told, where each piece comes from, its size, and its words a click away. It follows the Monitor's node and the Builder's draft, and names the files that changed after a run started. Its review dropped side stripes from the whole UI.",
        docs: [
          "specs/ui/panels-context-and-feedback.md#context",
          "docs/guides/browser-view.md",
          "specs/gaps/limits-context-inspector.md",
        ],
        commits: ["284a23b", "37090bb", "354c8b3"],
      },
      {
        id: "feedback-loop",
        title: "Feedback loop",
        status: "done",
        date: "2026-11-07",
        commits: [
          "2a0882a",
          "74cb402",
          "e1e2814",
          "6421a50",
          "38ea1dc",
          "a2b41c3",
          "9532e22",
          "32add24",
        ],
        detail:
          "Feedback now changes something. An item becomes a lesson its workflow reads under a 1,500-token cap, or `ork feedback apply` runs Ork's own `ork:feedback-apply` to propose a fix on a branch, behind a keep-or-discard gate, never merged. Triage merges near-duplicates by rules, asking each time, and `split` undoes it; notes come from `ork decide` and the Monitor too. An item about Ork is published to its Discussions after a preview, with your own `gh`, and feedback moves as JSON lines with `export` and `import`. The Feedback panel does all but merging, and one rule says what an item allows, in a terminal or the browser (ADR-059).",
        docs: [
          "specs/feedback.md",
          "docs/guides/feedback.md",
          "decisions/ADR-059-closing-the-feedback-loop.md",
          "specs/gaps/limits-feedback.md",
        ],
      },
      {
        id: "for-each",
        title: "A node once per item",
        status: "planned",
        detail:
          "Running a node for each item of a list from the workflow file, as `matrix` does elsewhere, rather than leaving it to a leader's `spawn_worker`. Needs its own RFC, after workflow calls.",
        docs: ["specs/scheduler.md"],
      },
      {
        id: "triggers",
        title: "Schedules and webhooks",
        status: "done",
        detail:
          "Starting a run on a schedule or an event, with `ork watch` and `.ork/triggers.yaml` (RFC-011). Webhooks are left out, because a local tool has no always-on process and its server binds loopback only.",
        docs: [
          "decisions/ADR-053-watching-a-source.md",
          "rfcs/archived/RFC-011-watching-a-source.md",
          "specs/scheduler/watching.md",
          "docs/guides/watching.md",
          "specs/server.md",
        ],
        commits: ["dfed497", "1ea63a7"],
        date: "2026-11-04",
      },
      {
        id: "claude-code",
        title: "Ork for Claude Code",
        status: "done",
        date: "2026-11-06",
        detail:
          "Claude Code, outside a run, learns to write, check and run workflows the way Ork is built to save: an `ork mcp` server on the same code as the CLI, skills for writing, running and Ork's principles, a plugin with both, and the skills through `ork init`. It reads, checks and starts runs, and never answers a decision (RFC-012, ADR-057). A review's fixes: the hook stops an answer whatever else is on the line, unknown arguments are refused, a newer Ork's skills aren't downgraded, and the plugin expects the oldest Ork it works with (ADR-058).",
        docs: [
          "decisions/ADR-057-ork-for-claude-code.md",
          "decisions/ADR-058-plugin-expects-oldest-ork.md",
          "rfcs/archived/RFC-012-teaching-claude-code-ork.md",
          "specs/claude-code.md",
          "docs/guides/claude-code.md",
        ],
        commits: [
          "ee4a55e",
          "3a289d5",
          "00ec407",
          "36ac878",
          "b15911c",
          "f84dc9e",
          "9751231",
          "0ffc984",
          "c492d91",
          "a883583",
          "673ed4e",
          "b39cb28",
          "c624bbd",
          "49bbd0d",
          "b717604",
          "f956dc2",
          "28b5e51",
          "87c7e8f",
          "02c90de",
          "46be492",
        ],
      },
      {
        id: "benchmark",
        title: "Prove it costs less",
        status: "planned",
        detail:
          "Once the core features above are in, run the same real jobs by hand and through Ork, and compare cost per completed task and the quality of the result. First record what a run lacks today: each session's peak context, compaction, and cache rewrites after idle time. The results decide what to build for hours-long runs, such as skipping unchanged work, or disposable sessions with a capped memory on the node, and whether Ork can claim to cost less.",
        docs: ["specs/usage.md"],
      },
      {
        id: "gaps-review",
        title: "Decide the known gaps",
        status: "planned",
        detail:
          "Close, keep or carry each open gap, limit and chore in the register.",
        docs: ["specs/gaps.md"],
      },
    ],
  },
];

/**
 * Commits on `main` that are deliberately not on the roadmap (dependency bumps,
 * merges of them, map syncs), so the check does not list them.
 *
 * @type {string[]}
 */
export const OFF_ROADMAP = [
  "71c09e7",
  "d6c8d68",
  "2a0a15f",
  "879c00a",
  "e61aade",
  "fcf9d40",
  "e97d75c",
  "57bdb6f",
  "dc89e77",
  "61f7edb",
  "e93dd79",
  "47546e0",
  "94e472a",
  "f45ced7",
  "e79e608",
  "54f5e81",
  "5854081",
  "ac63fc2",
  "eb664c7",
  "63f28d8",
  "8f3d063",
  "da4cc49",
  "60420b0",
  "50ee914",
  "6a12cf8",
  "14b64af",
  "94cc3d0",
  "9785a0b",
  "84bad82",
  "0fccdc7",
  "5e045ab",
  "ce72ab7",
  "a1bf031",
  "e922c51",
  "455bf70",
  "64e1c4b",
  "7f03734",
  "250b30e",
  "a19864a",
  "4df0480",
  "95169dc",
  "94a1c6e",
  "6b08b98",
  "dd9cf4c",
  "cc85808",
  "60fff55",
  "af99086",
  "fd4b187",
  "e5ad0fb",
  "a0cd60e",
  "bad987b",
  "713f18b",
  "9ac26f2",
  "a70514f",
  "1212977",
  "3a7374c",
  "9f781ba",
  "3d967d4",
];

/** The day the roadmap was last brought up to date. */
export const ROADMAP_UPDATED = "2026-11-07";
