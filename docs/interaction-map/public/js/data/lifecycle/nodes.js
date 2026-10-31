/**
 * @file The run lifecycle map's components: you, the engine pieces a run passes
 *   through, the nodes of the `software-factory` example laid out as its run
 *   graph, and the repository it works on. Coordinates are in map units; the
 *   map is {@link SIZE} wide and tall.
 */

import {
  CLI,
  CORE,
  DESIGN,
  ENGINE,
  NODE_TYPES,
  SCHEMA,
  WORKTREES,
  CONTROL,
  STORE,
  RESUME,
} from "../refs.js";

/** @typedef {import("../types.js").MapNode} MapNode */
/** @typedef {import("../types.js").Zone} Zone */
/** @typedef {import("../types.js").Group} Group */

/** The map's extent, in map units. */
export const SIZE = { w: 1660, h: 1010 };

/**
 * The columns, left to right.
 *
 * @type {ReadonlyArray<Zone>}
 */
export const ZONES = [
  { id: "people", label: "You", x: 20, w: 260, tone: "violet" },
  { id: "engine", label: "Ork engine", x: 300, w: 260, tone: "orange" },
  {
    id: "graph",
    label: "software-factory · the run graph",
    x: 580,
    w: 780,
    tone: "teal",
  },
  { id: "repo", label: "Repo and GitHub", x: 1380, w: 260, tone: "slate" },
];

/**
 * Outlined boxes that group components running together.
 *
 * @type {ReadonlyArray<Group>}
 */
export const GROUPS = [
  {
    id: "children",
    label: "builder's children · readonly",
    x: 590,
    y: 390,
    w: 760,
    h: 122,
  },
];

/** The example workflow; every graph node links to it. */
const EXAMPLE = SCHEMA.example;

/** @type {ReadonlyArray<MapNode>} */
export const NODES = [
  // ── You ──────────────────────────────────────────────────────────────────
  {
    id: "you",
    title: "You",
    sub: "start the run · answer",
    zone: "people",
    x: 40,
    y: 420,
    status: "external",
    pkg: null,
    summary:
      "You start a run with its inputs and answer the decisions it raises. Everything else runs on its own.",
    facts: [
      "Inputs are typed in the workflow: `feature` is a required string here.",
    ],
    docs: [DESIGN.cli],
  },

  // ── Engine ───────────────────────────────────────────────────────────────
  {
    id: "cli",
    title: "ork run",
    sub: "with the `feature` input",
    zone: "engine",
    x: 320,
    y: 120,
    status: "partial",
    pkg: "cli",
    src: "packages/cli/src/commands/run.ts",
    summary:
      "Starts a run of a workflow file with its inputs, and follows it until it ends or you detach.",
    facts: [
      "Built: `ork run <wf>` runs the whole workflow, and `--node <id>` one Claude node on its own; `--input`, `--driver`, `--in-place` and `--json` work for both.",
      "Built: `--detach` returns at once; `ork logs --follow`, `ork tree`, `ork decide` and `ork stop` reach it later.",
      "Built: before anything starts, it checks that the programs the tool nodes run are installed; integrations a workflow does not use are never needed.",
      "`--driver sdk|cli` overrides every node's driver for this run.",
    ],
    see: [
      {
        map: "architecture",
        node: "cli",
        label: "The CLI in the architecture",
      },
    ],
    docs: [CLI.run, CLI.runWorkflow, CLI.runTests, DESIGN.cli],
  },
  {
    id: "compiler",
    title: "Graph compiler",
    sub: "validate · expand · plan",
    zone: "engine",
    x: 320,
    y: 250,
    status: "built",
    pkg: "core",
    src: "packages/core/src/graph",
    summary:
      "Parses and checks the workflow, expands edge shorthand into single edges, and finds the entry nodes. A file that does not compile never starts.",
    facts: [
      "Here the only entry node is `spec`: the reviewers have a parent, the rest have incoming edges.",
      "The `reviews -> builder` edge closes a cycle, so it must carry `maxRounds`.",
    ],
    see: [
      {
        map: "architecture",
        node: "compiler",
        label: "The compiler in the architecture",
      },
    ],
    docs: [CORE.compile, CORE.tests, DESIGN.format, SCHEMA.edges],
  },
  {
    id: "scheduler",
    title: "Scheduler",
    sub: "starts · routes · counts rounds",
    zone: "engine",
    x: 320,
    y: 420,
    status: "partial",
    pkg: "core",
    summary:
      "Starts nodes when their inputs are ready, evaluates each outgoing edge's `when:` on the finished node's output, and counts how often a loop edge has been taken.",
    facts: [
      "Runs at most `limits.concurrency` sessions at once (4 here).",
      "Stops the run when spend reaches `limits.budgetUsd` ($20 here).",
      "An edge without `when:` fires only on success; a skipped branch skips everything that only it feeds, so the join never waits on it.",
      "When a loop edge has used its `maxRounds`, you are asked: stop, one more round, or go on. A live leader that owns the loop's nodes is asked first; here the builder's session has ended, so it is you.",
      "Runs the children a leader delegates to, on the slot the waiting leader lends them.",
      "`ork resume` runs the workflow again under the same id: what finished is handed back from the run's events, and only the rest runs.",
    ],
    see: [
      { map: "roles", node: "scheduler", label: "When each node runs" },
      {
        map: "architecture",
        node: "scheduler",
        label: "The scheduler in the architecture",
      },
    ],
    docs: [
      ENGINE.scheduler,
      ENGINE.routing,
      ENGINE.tests,
      RESUME.resume,
      RESUME.tests,
      DESIGN.scheduler,
    ],
  },
  {
    id: "events",
    title: "Run events",
    sub: "`ork logs` · `ork tree`",
    zone: "engine",
    x: 320,
    y: 570,
    status: "built",
    pkg: "core",
    src: "packages/core/src/store/recorder.ts",
    summary:
      "Every step of the run as an event, stored before it is printed, so you can follow it live or replay it afterwards.",
    facts: [
      "`ork logs` replays the transcript `ork run` printed; `--node` keeps one node, `--follow` tails a live run.",
      "`ork tree` shows the ownership tree with status, tokens and cost per node, spawned workers under their leader.",
      "`ork ps` lists this project's runs (`--all`: every project's).",
    ],
    see: [
      { map: "architecture", node: "eventStore", label: "The event store" },
    ],
    docs: [DESIGN.eventStore, STORE.recorder, STORE.commands, STORE.cliTests],
  },
  {
    id: "inbox",
    title: "Decisions",
    sub: "`ork decide` · UI inbox",
    zone: "engine",
    x: 320,
    y: 840,
    status: "partial",
    pkg: "core",
    src: "packages/core/src/control/queue.ts",
    summary:
      "Questions waiting for you, from every node of every run, each with its options and a recommended answer.",
    facts: [
      "Built: answered on the run's terminal or with `ork decide` from any other; the first answer wins.",
      "A gate with `timeout` and `default` answers itself when the time runs out.",
      "Planned: the UI inbox (M2).",
    ],
    see: [
      { map: "messaging", node: "decisions", label: "Decisions in detail" },
    ],
    docs: [DESIGN.messaging, CONTROL.queue, CONTROL.commands],
  },

  // ── The run graph ────────────────────────────────────────────────────────
  {
    id: "spec",
    title: "spec",
    sub: "worker · opus · shared",
    zone: "graph",
    x: 860,
    y: 120,
    status: "built",
    pkg: null,
    summary:
      "Writes a spec for the feature. It is the entry node, so it starts as soon as the run does.",
    facts: [
      "Its prompt is `Write a spec for: {{inputs.feature}}`.",
      "`isolation: shared`: it writes into the project checkout, not a worktree.",
      "Reports the spec as an artifact, which the builder's prompt references.",
    ],
    docs: [EXAMPLE, NODE_TYPES.claude],
  },
  {
    id: "builder",
    title: "builder",
    sub: "leader · opus · worktree",
    zone: "graph",
    x: 860,
    y: 250,
    status: "partial",
    pkg: null,
    summary:
      "Implements the spec on its own branch and owns the three reviewers. As a leader its session lives across review rounds, so it keeps what it learned.",
    facts: [
      "Prompt: `Implement the spec at {{nodes.spec.output.artifacts.spec}}.`",
      "Gets the default `isolation: worktree`: a branch of its own, `ork/<run>/builder`.",
      "Built: on a re-entry it resumes its session, and only the reviews are new.",
      "Owns `security`, `ux` and `code`: it can also `delegate` to them during its session and gets their reports back.",
    ],
    see: [{ map: "roles", node: "leader", label: "A leader's role" }],
    docs: [EXAMPLE, DESIGN.concepts],
  },
  {
    id: "security",
    title: "security",
    sub: "worker · opus · readonly",
    zone: "graph",
    x: 600,
    y: 420,
    status: "partial",
    pkg: null,
    summary:
      "Reviews the builder's branch for security issues, in a fresh session each round.",
    facts: [
      "`parent: builder`.",
      "May message `code` over the declared channel (with the message bus).",
    ],
    see: [{ map: "roles", node: "child", label: "An owned child's role" }],
    docs: [EXAMPLE],
  },
  {
    id: "ux",
    title: "ux",
    sub: "worker · sonnet · readonly",
    zone: "graph",
    x: 860,
    y: 420,
    status: "built",
    pkg: null,
    summary:
      "Reviews the builder's branch for UX issues, on the cheaper default model.",
    facts: ["`parent: builder`; model from `defaults.model`."],
    docs: [EXAMPLE],
  },
  {
    id: "code",
    title: "code",
    sub: "worker · sonnet · readonly",
    zone: "graph",
    x: 1120,
    y: 420,
    status: "partial",
    pkg: null,
    summary: "Reviews the builder's branch for code quality.",
    facts: [
      "`parent: builder`.",
      "May message `security` over the declared channel (with the message bus).",
    ],
    docs: [EXAMPLE],
  },
  {
    id: "reviews",
    title: "reviews",
    sub: "`control.join` · all",
    zone: "graph",
    x: 860,
    y: 570,
    status: "built",
    pkg: null,
    summary:
      "Waits for all three reviews, then outputs their statuses. Its two outgoing edges decide: back to the builder, or on to the approver.",
    facts: [
      "Output `statuses`: one status per review.",
      "`any(statuses, 'changes_requested')` loops back, at most 2 rounds.",
      "`all(statuses, 'pass')` goes on to the approver.",
    ],
    see: [{ map: "roles", node: "join", label: "A join's role" }],
    docs: [EXAMPLE, ENGINE.routing, SCHEMA.nodes],
  },
  {
    id: "approver",
    title: "approver",
    sub: "worker · opus · readonly",
    zone: "graph",
    x: 860,
    y: 700,
    status: "built",
    pkg: null,
    summary:
      "Decides whether the builder's branch is ready to merge, and must say so in a structured field.",
    facts: [
      "`output.schema` requires `verdict`: `approve` or `escalate`.",
      "Its edges route on `verdict`.",
    ],
    docs: [EXAMPLE],
  },
  {
    id: "merge",
    title: "ship · push · pr",
    sub: "gate · `git push` · `gh pr`",
    zone: "graph",
    x: 600,
    y: 840,
    status: "built",
    pkg: "nodes",
    summary:
      "If the approver approved, a gate asks you whether to push the builder's branch and open a pull request; then your `git` and `gh` do it. You review and merge it on GitHub.",
    facts: [
      "`ship`: a `human.gate`, `open` or `keep`, with `open` recommended.",
      "`push`: `git push --set-upstream origin {{nodes.builder.output.branch}}`, `allow: [git push]`; `pr`: `gh pr create --head … --fill`, `allow: [pr create]`.",
      "No shell: the branch is rendered inside one argument, so it can never add arguments.",
    ],
    docs: [EXAMPLE, NODE_TYPES.tools, SCHEMA.nodes],
  },
  {
    id: "human",
    title: "escalated",
    sub: "`human.gate` · open anyway?",
    zone: "graph",
    x: 1120,
    y: 840,
    status: "built",
    pkg: "nodes",
    summary:
      "Asks you whether to push and open a pull request anyway when the approver escalates, with the approver's summary. It opens a decision with the recommended answer `keep`.",
    facts: [
      "`open` goes on to the push and the pull request, like `ship`; `keep` ends the run.",
      "A `timeout` and `default` would let it answer itself.",
      "Answered on the run's terminal or with `ork decide`.",
    ],
    docs: [EXAMPLE, NODE_TYPES.gate],
  },

  // ── Repo and GitHub ──────────────────────────────────────────────────────
  {
    id: "worktrees",
    title: "Builder's worktree",
    sub: "a branch of its own",
    zone: "repo",
    x: 1400,
    y: 120,
    status: "built",
    pkg: null,
    summary:
      "The builder's checkout beside the clone, on a new branch. The reviewers work in it but cannot write to it.",
    facts: [
      "Its branch is the builder's `output.branch`, which the push and the pull request use; the approver, readonly with no owner, reads it here too.",
      "The spec the `spec` node wrote in the project root is carried in and committed.",
      "Kept after the run as its result; `ork worktrees clean` removes it when you are done.",
      "With `commit: never` in the project's rules it is detached and nothing is committed; its path is `output.worktree`.",
    ],
    see: [
      {
        map: "architecture",
        node: "worktrees",
        label: "Worktrees in the architecture",
      },
    ],
    docs: [WORKTREES.workspace, DESIGN.worktrees],
  },
  {
    id: "github",
    title: "GitHub",
    sub: "your repo, your `gh` login",
    zone: "repo",
    x: 1400,
    y: 840,
    status: "external",
    pkg: null,
    summary:
      "Where the pull request opens, reached only through your own `git` and `gh` and their logins; you merge it there.",
    facts: ["Ork never handles the GitHub token."],
    docs: [DESIGN.concepts],
  },
];
