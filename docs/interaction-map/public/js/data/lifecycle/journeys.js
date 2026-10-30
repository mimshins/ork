/** @file The run lifecycle map's journeys. */

import { DESIGN, SCHEMA } from "../refs.js";

/** @typedef {import("../types.js").Journey} Journey */

/** @type {ReadonlyArray<Journey>} */
export const JOURNEYS = [
  {
    id: "happy-path",
    title: "Run software-factory end to end",
    who: "You · spec · builder · reviewers · approver",
    summary:
      "From `ork run` to a squashed merge on GitHub, when every review passes the first time and the approver approves.",
    steps: [
      {
        from: "you",
        to: "cli",
        title: "You start the run",
        detail: '`ork run software-factory --input feature="…"`.',
        docs: [DESIGN.cli],
      },
      {
        from: "cli",
        to: "compiler",
        title: "The workflow compiles",
        detail:
          "Schema, graph, templates and predicates are checked; `spec` is the only entry node.",
        docs: [DESIGN.format],
      },
      {
        from: "compiler",
        to: "scheduler",
        title: "The run graph goes to the scheduler",
        detail:
          "With the ownership tree: `builder` owns `security`, `ux` and `code`.",
      },
      {
        from: "scheduler",
        to: "spec",
        title: "`spec` starts",
        detail:
          "A fresh opus session in the project checkout writes the spec and reports it as an artifact.",
        docs: [SCHEMA.example],
      },
      {
        from: "spec",
        to: "builder",
        title: "The builder gets the spec",
        detail:
          "Its prompt template is filled with the spec's artifact path, not the spec's text.",
        docs: [DESIGN.context],
      },
      {
        from: "builder",
        to: "worktrees",
        title: "The builder works on its own branch",
        detail:
          "Implements the spec in its worktree, then reports; Ork commits what it left and sets its branch.",
      },
      {
        from: "builder",
        to: "security",
        title: "Three reviewers start in parallel",
        detail:
          "`security`, `ux` and `code`, each in a fresh `readonly` session with a brief from the builder; within the run's concurrency of 4.",
      },
      {
        from: "security",
        to: "code",
        title: "Two reviewers compare notes",
        detail:
          "Over their declared channel; the bus delivers each message between the receiver's turns.",
        status: "specified",
        docs: [DESIGN.messaging],
      },
      {
        from: "code",
        to: "reviews",
        title: "The join collects the reviews",
        detail: "It waits for all three reports and outputs their `statuses`.",
      },
      {
        from: "reviews",
        to: "approver",
        title: "All pass: on to the approver",
        detail: "`all(statuses, 'pass')` holds, so the loop edge is skipped.",
      },
      {
        from: "approver",
        to: "merge",
        title: "The approver approves",
        detail:
          "It reports `verdict: approve`, which picks the edge to `merge`.",
      },
      {
        from: "merge",
        to: "github",
        title: "Your `gh` merges the branch",
        detail:
          "`gh pr merge <branch> --squash`, allowed by the node's `allow` list. The run ends; its events stay in the run store.",
      },
    ],
  },
  {
    id: "review-loop",
    title: "Reviews ask for changes, twice",
    who: "builder · reviewers · you",
    summary:
      "The bounded loop: reviews send the builder back, the builder fixes, and when the loop edge has used its two rounds the run escalates to you instead of looping forever.",
    steps: [
      {
        from: "reviews",
        to: "builder",
        title: "Round 1: changes requested",
        detail:
          "`any(statuses, 'changes_requested')` holds. The builder's long-lived session resumes with the three reports.",
        status: "partial",
        docs: [DESIGN.format],
      },
      {
        from: "builder",
        title: "The builder fixes its branch",
        detail:
          "It keeps its own context from round 1; only the reviews are new.",
        status: "partial",
      },
      {
        from: "builder",
        to: "code",
        title: "The reviewers run again, fresh",
        detail:
          "Workers never carry a transcript between tasks: each review starts from a new brief.",
        docs: [DESIGN.context],
      },
      {
        from: "reviews",
        to: "builder",
        title: "Round 2: changes requested again",
        detail: "The loop edge is taken for the second and last time.",
      },
      {
        from: "reviews",
        title: "The round limit is reached",
        detail:
          "A third round would exceed `maxRounds: 2`, so the edge is not taken. The node escalates to its owner; `builder` has none, so the scheduler raises a decision.",
      },
      {
        from: "scheduler",
        to: "inbox",
        title: "You are asked what to do",
        detail:
          "A decision with the reviews' summaries as context and options such as another round, stop, or go on to the approver.",
        status: "partial",
        docs: [DESIGN.messaging],
      },
      {
        from: "you",
        to: "inbox",
        title: "You answer",
        detail:
          "The run continues the way you chose, and the answer is logged.",
        status: "partial",
      },
    ],
  },
  {
    id: "gate",
    title: "The approver escalates to you",
    who: "approver · you",
    summary:
      "The approver will not approve on its own, so a human gate asks you, with a recommended answer.",
    steps: [
      {
        from: "approver",
        to: "human",
        title: "`verdict: escalate`",
        detail: "The approver's structured output picks the edge to the gate.",
        docs: [SCHEMA.example],
      },
      {
        from: "human",
        to: "inbox",
        title: "The gate opens a decision",
        detail:
          '"The approver escalated. Merge anyway?" with `merge` and `reject`, and `reject` recommended.',
        status: "partial",
      },
      {
        from: "you",
        to: "inbox",
        title: "You choose",
        detail:
          "`ork decide` preselects the recommendation; in the UI it is one click.",
        status: "partial",
        docs: [DESIGN.messaging],
      },
      {
        from: "inbox",
        to: "human",
        title: "The gate outputs your answer",
        detail:
          "In the example the gate has no outgoing edges, so the run ends here. An edge from the gate with a `when:` on the answer would carry on, for example to `merge`.",
        status: "partial",
      },
    ],
  },
];
