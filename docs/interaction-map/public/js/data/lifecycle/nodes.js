/**
 * @file The run lifecycle map's components: you, the engine pieces a run passes
 *   through, the nodes of the `software-factory` example laid out as its run
 *   graph, and the repository it works on. Coordinates are in map units; the
 *   map is {@link SIZE} wide and tall.
 */

import { DESIGN, SCHEMA } from "../refs.js";

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
    status: "specified",
    pkg: "cli",
    src: "packages/cli/src/bin.ts",
    summary:
      "Starts a run of a workflow file with its inputs, and follows it until it ends or you detach.",
    facts: [
      "`--detach` returns at once; `ork logs --follow` and `ork tree` watch it later.",
      "`--driver sdk|cli` overrides every node's driver for this run.",
    ],
    see: [
      {
        map: "architecture",
        node: "cli",
        label: "The CLI in the architecture",
      },
    ],
    docs: [DESIGN.cli],
  },
  {
    id: "compiler",
    title: "Graph compiler",
    sub: "validate · expand · plan",
    zone: "engine",
    x: 320,
    y: 250,
    status: "specified",
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
    docs: [DESIGN.format, SCHEMA.edges],
  },
  {
    id: "scheduler",
    title: "Scheduler",
    sub: "starts · routes · counts rounds",
    zone: "engine",
    x: 320,
    y: 420,
    status: "specified",
    pkg: "core",
    summary:
      "Starts nodes when their inputs are ready, evaluates each outgoing edge's `when:` on the finished node's output, and counts how often a loop edge has been taken.",
    facts: [
      "Runs at most `limits.concurrency` sessions at once (4 here).",
      "Stops the run when spend reaches `limits.budgetUsd` ($20 here).",
      "When a loop edge has used its `maxRounds`, the node escalates to its owner; the root escalates to you.",
    ],
    see: [
      {
        map: "architecture",
        node: "scheduler",
        label: "The scheduler in the architecture",
      },
    ],
    docs: [DESIGN.concepts, DESIGN.format],
  },
  {
    id: "events",
    title: "Run events",
    sub: "`ork logs` · `ork tree`",
    zone: "engine",
    x: 320,
    y: 570,
    status: "specified",
    pkg: "core",
    summary:
      "Every step of the run as an event, so you can follow it live or replay it afterwards.",
    facts: [
      "`ork tree` shows the ownership tree with status, tokens and cost per node.",
    ],
    see: [
      { map: "architecture", node: "eventStore", label: "The event store" },
    ],
    docs: [DESIGN.messaging],
  },
  {
    id: "inbox",
    title: "Decisions",
    sub: "`ork decide` · UI inbox",
    zone: "engine",
    x: 320,
    y: 840,
    status: "specified",
    pkg: "core",
    summary:
      "Questions waiting for you, from every node of every run, each with its options and a recommended answer.",
    facts: [
      "A gate with `timeout` and `default` answers itself when the time runs out.",
    ],
    see: [
      { map: "messaging", node: "decisions", label: "Decisions in detail" },
    ],
    docs: [DESIGN.messaging],
  },

  // ── The run graph ────────────────────────────────────────────────────────
  {
    id: "spec",
    title: "spec",
    sub: "worker · opus · shared",
    zone: "graph",
    x: 860,
    y: 120,
    status: "specified",
    pkg: null,
    summary:
      "Writes a spec for the feature. It is the entry node, so it starts as soon as the run does.",
    facts: [
      "Its prompt is `Write a spec for: {{inputs.feature}}`.",
      "`isolation: shared`: it writes into the project checkout, not a worktree.",
      "Reports the spec as an artifact, which the builder's prompt references.",
    ],
    docs: [EXAMPLE],
  },
  {
    id: "builder",
    title: "builder",
    sub: "leader · opus · worktree",
    zone: "graph",
    x: 860,
    y: 250,
    status: "specified",
    pkg: null,
    summary:
      "Implements the spec on its own branch and owns the three reviewers. As a leader its session lives across review rounds, so it keeps what it learned.",
    facts: [
      "Prompt: `Implement the spec at {{nodes.spec.output.artifacts.spec}}.`",
      "Gets the default `isolation: worktree`: a branch of its own.",
      "Owns `security`, `ux` and `code`: it briefs them, and their escalations come to it.",
    ],
    docs: [EXAMPLE, DESIGN.concepts],
  },
  {
    id: "security",
    title: "security",
    sub: "worker · opus · readonly",
    zone: "graph",
    x: 600,
    y: 420,
    status: "specified",
    pkg: null,
    summary:
      "Reviews the builder's branch for security issues, in a fresh session each round.",
    facts: [
      "`parent: builder`.",
      "May message `code` over the declared channel.",
    ],
    docs: [EXAMPLE],
  },
  {
    id: "ux",
    title: "ux",
    sub: "worker · sonnet · readonly",
    zone: "graph",
    x: 860,
    y: 420,
    status: "specified",
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
    status: "specified",
    pkg: null,
    summary: "Reviews the builder's branch for code quality.",
    facts: [
      "`parent: builder`.",
      "May message `security` over the declared channel.",
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
    status: "specified",
    pkg: null,
    summary:
      "Waits for all three reviews, then outputs their statuses. Its two outgoing edges decide: back to the builder, or on to the approver.",
    facts: [
      "Output `statuses`: one status per review.",
      "`any(statuses, 'changes_requested')` loops back, at most 2 rounds.",
      "`all(statuses, 'pass')` goes on to the approver.",
    ],
    docs: [EXAMPLE, SCHEMA.nodes],
  },
  {
    id: "approver",
    title: "approver",
    sub: "worker · opus · readonly",
    zone: "graph",
    x: 860,
    y: 700,
    status: "specified",
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
    title: "merge",
    sub: "`tool.gh` · `pr merge`",
    zone: "graph",
    x: 600,
    y: 840,
    status: "specified",
    pkg: "nodes",
    summary:
      "Merges the builder's branch through your `gh`, if the approver approved.",
    facts: [
      "Command: `pr merge {{nodes.builder.output.branch}} --squash`.",
      "`allow: [pr merge]`: any other subcommand is refused.",
    ],
    docs: [EXAMPLE, SCHEMA.nodes],
  },
  {
    id: "human",
    title: "human",
    sub: "`human.gate` · merge or reject",
    zone: "graph",
    x: 1120,
    y: 840,
    status: "specified",
    pkg: "nodes",
    summary:
      "Asks you whether to merge anyway when the approver escalates. It opens a decision with the recommended answer `reject`.",
    facts: [
      "No outgoing edges in the example, so the run ends with your answer.",
      "A `timeout` and `default` would let it answer itself.",
    ],
    docs: [EXAMPLE],
  },

  // ── Repo and GitHub ──────────────────────────────────────────────────────
  {
    id: "worktrees",
    title: "Builder's worktree",
    sub: "a branch of its own",
    zone: "repo",
    x: 1400,
    y: 120,
    status: "specified",
    pkg: null,
    summary:
      "The builder's checkout under `.ork/worktrees/`, on a new branch. The reviewers read it but cannot write to it.",
    facts: [
      "Its branch is the builder's `output.branch`, which the approver and `merge` use.",
    ],
    see: [
      {
        map: "architecture",
        node: "worktrees",
        label: "Worktrees in the architecture",
      },
    ],
    docs: [DESIGN.concepts],
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
      "Where the merge lands, reached only through your own `gh` and its login.",
    facts: ["Ork never handles the GitHub token."],
    docs: [DESIGN.concepts],
  },
];
