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
        id: "installer",
        title: "Standalone binaries and installer",
        status: "waiting",
        detail:
          "macOS binaries on each release, `curl -fsSL …/install.sh | sh` to install them with no Node, and `ork upgrade`. Waits on RFC-002's acceptance.",
        commits: ["eb664c7"],
        docs: ["rfcs/active/RFC-002-standalone-binaries-and-installer.md"],
      },
      {
        id: "first-release",
        title: "First npm release",
        status: "waiting",
        detail:
          "The release pull request collects the changesets; it waits for the go-ahead.",
        docs: ["runbook/development/release.md"],
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
        status: "planned",
        detail: "Hono with REST and SSE on 127.0.0.1, behind a token.",
        docs: ["specs/ui.md"],
      },
      {
        id: "monitor",
        title: "Monitor, logs, decisions, chats",
        status: "planned",
        detail:
          "The live graph and ownership tree with status and cost, the event log, the decisions inbox, and a chat per node.",
        docs: ["specs/ui.md"],
      },
      {
        id: "worktrees-panel",
        title: "Worktrees panel",
        status: "planned",
        detail: "What `ork worktrees` shows, with cleanup a click away.",
        docs: ["specs/worktrees.md"],
      },
      {
        id: "designer",
        title: "Designer and context inspector",
        status: "planned",
        detail:
          "A canvas that saves the same YAML, and each node's resolved layer stack.",
        docs: ["specs/ui.md"],
      },
      {
        id: "feedback-loop",
        title: "Feedback loop",
        status: "planned",
        detail:
          "Triage, `ork feedback apply`, lessons, sharing to Discussions, and the Feedback panel.",
        docs: ["specs/feedback.md"],
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
];

/** The day the roadmap was last brought up to date. */
export const ROADMAP_UPDATED = "2026-10-31";
