/**
 * @file The run lifecycle map's connections. Edges inside the run graph are the
 *   example's flow edges, drawn as in-process routing by the scheduler. Lanes
 *   in use: `x` 290 from you up to `ork run`; `x` 570 from the scheduler up to
 *   `spec`; `x` 1355 for the review loop on the right of the graph; `y` 530
 *   under the reviewers for their message channel; `y` 950 and 975 under every
 *   card.
 */

import { DESIGN, SCHEMA } from "../refs.js";

/** @typedef {import("../types.js").MapEdge} MapEdge */

const EXAMPLE = SCHEMA.example;

/** @type {ReadonlyArray<MapEdge>} */
export const EDGES = [
  {
    id: "you-cli",
    from: "you",
    to: "cli",
    kind: "human",
    label: "`ork run software-factory`",
    detail:
      "With `--input feature=…`; a missing required input stops the run before it starts.",
    via: [
      [290, 456],
      [290, 156],
    ],
    docs: [DESIGN.cli],
  },
  {
    id: "cli-compiler",
    from: "cli",
    to: "compiler",
    kind: "local",
    label: "compile",
    detail: "The same checks as `ork validate`.",
  },
  {
    id: "compiler-scheduler",
    from: "compiler",
    to: "scheduler",
    kind: "local",
    label: "run graph",
    detail:
      "Single edges, the ownership tree, the entry nodes and each loop edge's round limit.",
  },
  {
    id: "scheduler-spec",
    from: "scheduler",
    to: "spec",
    kind: "local",
    label: "starts the entry node",
    detail: "`spec` has no parent and no incoming edge, so it starts first.",
    via: [
      [570, 440],
      [570, 156],
    ],
  },
  {
    id: "scheduler-events",
    from: "scheduler",
    to: "events",
    kind: "event",
    label: "every step",
    detail: "Starts, reports, routing, rounds, usage and decisions.",
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "spec-builder",
    from: "spec",
    to: "builder",
    kind: "local",
    label: "`spec -> builder`",
    detail:
      "The spec's report fills `{{nodes.spec.output.artifacts.spec}}` in the builder's prompt.",
    docs: [EXAMPLE],
  },
  {
    id: "builder-worktree",
    from: "builder",
    to: "worktrees",
    kind: "git",
    label: "own worktree + branch",
    detail:
      "Created before its session starts; the session's working directory.",
  },
  {
    id: "builder-security",
    from: "builder",
    to: "security",
    kind: "local",
    label: "brief",
    detail:
      "`builder -> security, ux, code` fans out; each reviewer gets a context packet from its owner, not the builder's transcript.",
    docs: [EXAMPLE, DESIGN.context],
  },
  {
    id: "builder-ux",
    from: "builder",
    to: "ux",
    kind: "local",
    label: "brief",
    detail: "Same fan-out edge.",
  },
  {
    id: "builder-code",
    from: "builder",
    to: "code",
    kind: "local",
    label: "brief",
    detail: "Same fan-out edge.",
  },
  {
    id: "security-code",
    from: "security",
    to: "code",
    kind: "message",
    label: "`messages: between`",
    detail:
      "The only sibling channel the example declares; without it the bus would refuse their messages.",
    status: "specified",
    both: true,
    via: [
      [660, 530],
      [1180, 530],
    ],
    docs: [EXAMPLE, DESIGN.messaging],
  },
  {
    id: "security-reviews",
    from: "security",
    to: "reviews",
    kind: "local",
    label: "report",
    detail:
      "`security, ux, code -> reviews` fans in; the join waits for all three.",
  },
  {
    id: "ux-reviews",
    from: "ux",
    to: "reviews",
    kind: "local",
    label: "report",
    detail: "Same fan-in edge.",
  },
  {
    id: "code-reviews",
    from: "code",
    to: "reviews",
    kind: "local",
    label: "report",
    detail: "Same fan-in edge.",
  },
  {
    id: "reviews-builder",
    from: "reviews",
    to: "builder",
    kind: "local",
    label: "changes requested · max 2 rounds",
    detail:
      "Taken when `any(statuses, 'changes_requested')`. The builder's session resumes with the reviews; after two rounds the edge is exhausted and the builder escalates.",
    via: [
      [1355, 606],
      [1355, 306],
      [1100, 306],
    ],
    docs: [EXAMPLE, DESIGN.format],
  },
  {
    id: "reviews-approver",
    from: "reviews",
    to: "approver",
    kind: "local",
    label: "all pass",
    detail: "Taken when `all(statuses, 'pass')`.",
    docs: [EXAMPLE],
  },
  {
    id: "approver-merge",
    from: "approver",
    to: "merge",
    kind: "local",
    label: "`verdict == 'approve'`",
    detail: "The approver's structured `verdict` picks the edge.",
    docs: [EXAMPLE],
  },
  {
    id: "approver-human",
    from: "approver",
    to: "human",
    kind: "local",
    label: "`verdict == 'escalate'`",
    detail: "A person decides instead.",
    docs: [EXAMPLE],
  },
  {
    id: "merge-github",
    from: "merge",
    to: "github",
    kind: "process",
    label: "`gh pr merge … --squash`",
    detail:
      "Your `gh`, with arguments rendered from the builder's output and checked against `allow`.",
    via: [
      [710, 950],
      [1510, 950],
    ],
    docs: [EXAMPLE],
  },
  {
    id: "human-inbox",
    from: "human",
    to: "inbox",
    kind: "local",
    label: "decision ⇄ answer",
    detail:
      "The gate opens a decision with its question, options and recommendation, and waits for the answer.",
    status: "specified",
    both: true,
    via: [
      [1230, 975],
      [430, 975],
    ],
    docs: [DESIGN.messaging],
  },
  {
    id: "you-inbox",
    from: "you",
    to: "inbox",
    kind: "human",
    label: "answer",
    detail: "In `ork decide` or the UI inbox.",
    status: "specified",
    docs: [DESIGN.messaging],
  },
];
