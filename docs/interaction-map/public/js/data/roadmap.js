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
        docs: ["specs/cli.md#doctor"],
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
        docs: ["specs/cli.md#running-one-node"],
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
        docs: ["specs/cli.md#context"],
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
          "specs/cli.md#resuming-a-run",
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
        status: "next",
        detail:
          "The `feedback` tool, system signals, fingerprints, and `ork feedback list | show | dismiss`.",
        docs: ["specs/feedback.md"],
      },
      {
        id: "examples",
        title: "`software-factory` and `pr-review` examples",
        status: "planned",
        detail: "Both run end to end on both drivers.",
        docs: ["examples/software-factory.ork.yaml"],
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
];

/** The day the roadmap was last brought up to date. */
export const ROADMAP_UPDATED = "2026-10-31";
