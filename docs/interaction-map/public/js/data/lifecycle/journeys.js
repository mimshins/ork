/** @file The run lifecycle map's journeys. */

import { DESIGN, SCHEMA, NODE_TYPES, WATCH } from "../refs.js";

/** @typedef {import("../types.js").Journey} Journey */

/** @type {ReadonlyArray<Journey>} */
export const JOURNEYS = [
  {
    id: "happy-path",
    title: "Run software-factory end to end",
    who: "You · spec · builder · reviewers · approver",
    summary:
      "From `ork run` to a pull request on GitHub, when every review passes the first time, the approver approves and you say go.",
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
        title: "The approver approves, and you say go",
        detail:
          "It reports `verdict: approve`, which picks the edge to the `ship` gate; you answer `open`.",
      },
      {
        from: "merge",
        to: "github",
        title: "Your `git` pushes, your `gh` opens a pull request",
        detail:
          "`git push` and `gh pr create`, each allowed by its node's `allow` list. The run ends; you review and merge on GitHub.",
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
        docs: [DESIGN.format],
      },
      {
        from: "builder",
        title: "The builder fixes its branch",
        detail:
          "It keeps its own context from round 1; only the reviews are new.",
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
          "A third round would exceed `maxRounds: 2`, so the edge is not taken, and the scheduler asks you.",
      },
      {
        from: "scheduler",
        to: "inbox",
        title: "You are asked what to do",
        detail:
          "A decision with the reviews' summaries as context and options such as another round, stop, or go on to the approver.",
        docs: [DESIGN.messaging],
      },
      {
        from: "you",
        to: "inbox",
        title: "You answer",
        detail:
          "The run continues the way you chose, and the answer is logged.",
      },
    ],
  },
  {
    id: "checked-report",
    title: "A check sends the builder back",
    who: "builder · its worktree",
    summary:
      "With a `verify:` on the builder, which `software-factory` doesn't declare: a report isn't accepted until a program agrees, and a failure costs a turn of the same session, not a new one.",
    steps: [
      {
        from: "builder",
        title: "It reports `pass`",
        detail:
          "Its instructions named the check, so it may well have run it first and saved all that follows.",
        docs: [NODE_TYPES.steps],
      },
      {
        from: "builder",
        to: "worktrees",
        title: "The check runs in its worktree",
        detail:
          "`pnpm test`, as a one-off tool node with the builder's identity, before any of its work is committed.",
        docs: [NODE_TYPES.verify],
      },
      {
        from: "worktrees",
        to: "builder",
        title: "It fails: the same session resumes",
        detail:
          "With the reason and the last 8 KiB of the output, within what is left of the budgets. `attempts` says how many times.",
      },
      {
        from: "builder",
        title: "It fixes it and reports again",
        detail:
          "If it reports `fail` or `changes_requested` instead, the check stays failed and so does the node.",
      },
      {
        from: "builder",
        to: "worktrees",
        title: "The check passes",
        detail:
          "The report is accepted, `output.verify` holds the result, and the node's `notify:` rules and edges read it.",
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
          '"The approver escalated: … Push … and open a pull request anyway?" with `open` and `keep`, and `keep` recommended.',
      },
      {
        from: "you",
        to: "inbox",
        title: "You choose",
        detail:
          "The terminal or `ork decide` preselects the recommendation; in the UI's Decisions panel it's one click.",
        docs: [DESIGN.messaging],
      },
      {
        from: "inbox",
        to: "human",
        title: "The gate outputs your answer",
        detail:
          "`keep` ends the run with the branch kept; `open` takes the edge `choice == 'open'` to the push and the pull request.",
      },
      {
        from: "human",
        to: "merge",
        title: "On `open`, the same as `ship`",
        detail: "The push and `gh pr create` run with your logins.",
      },
    ],
  },
  {
    id: "watch",
    title: "A node waits on a source",
    who: "The scheduler · a node that watches · GitHub",
    summary:
      "From a tool node with `watch:` to the edges its last look picks, with no model turn. `software-factory` has none: this follows `examples/wait-for-ci.ork.yaml`. Not on `main` yet, and not tried against real GitHub.",
    steps: [
      {
        from: "compiler",
        title: "A wait that can't end is refused",
        detail:
          "`until` is read as an edge's `when:` is. A value or field the node doesn't declare is an error, and so is waiting for `!ok`, since a failed look doesn't hold it.",
        status: "partial",
        docs: [WATCH.check],
      },
      {
        from: "scheduler",
        to: "watching",
        title: "The node starts, and holds no session slot",
        detail:
          "It's one activation, however many looks it takes, recorded as `watch.started` with what it's waiting for. The Monitor shows that.",
        status: "partial",
        docs: [WATCH.execute, WATCH.facts],
      },
      {
        from: "watching",
        to: "github",
        title: "It looks, with no model turn",
        detail:
          "The node's own command, under its own `timeout`. Here `gh pr view` says `pending`, which isn't what `until` wants, so it waits.",
        status: "partial",
        docs: [WATCH.example],
      },
      {
        from: "watching",
        to: "events",
        title: "Only what changed is recorded",
        detail:
          "`watch.changed` when a look says something the last one didn't, comparing only the declared fields, so a timestamp isn't a change.",
        status: "partial",
        docs: [WATCH.events, WATCH.tests],
      },
      {
        from: "watching",
        title: "Between looks, nothing is working",
        detail:
          "It waits `every`. That doesn't count against `limits.timeout` unless something else in the run is working. A pause holds it here and stops its clock, and `ork stop` ends it.",
        status: "partial",
        docs: [WATCH.node, WATCH.spec],
      },
      {
        from: "watching",
        title: "A failed look tries again",
        detail:
          "A non-zero exit or a lost connection is tried at the next look, and `misses` in a row (default 3) fail the node. A value off the declared list fails it at once: waiting can't mend that.",
        status: "partial",
        docs: [WATCH.tests],
      },
      {
        from: "watching",
        to: "scheduler",
        title: "`until` holds: the last look is its output",
        detail:
          "`watch.ended` says how it ended and after how many looks, and the node's edges read the output as usual, here `json.result == 'failed'`. A wait past `watch.timeout` fails with `timedOut`, and `when: \"!ok\"` can catch it.",
        status: "partial",
        docs: [WATCH.node, WATCH.example],
      },
    ],
  },
];
