/** @file The context map's journeys. */

import { DESIGN, SCHEMA } from "../refs.js";

/** @typedef {import("../types.js").Journey} Journey */

/** @type {ReadonlyArray<Journey>} */
export const JOURNEYS = [
  {
    id: "compile-reviewer",
    title: "Compile the security reviewer's session",
    who: "Context compiler · security",
    summary:
      "How `security` in software-factory gets its context: layers resolved, `AGENTS.md` checked, prefix and brief ordered, limits applied, and the session started fresh.",
    steps: [
      {
        from: "builtins",
        to: "user",
        title: "Start from the built-ins and your layer",
        detail: "Any `ork:*` skill and anything in `~/.ork` is a candidate.",
        status: "specified",
      },
      {
        from: "user",
        to: "project",
        title: "The project's own setup comes next",
        detail:
          "The workflow inherits the project's instructions and skills, so they stay in.",
        status: "specified",
        docs: [SCHEMA.example],
      },
      {
        from: "project",
        to: "workflow",
        title: "The workflow adds its review checklist",
        detail:
          "`layers.skills: [./skills/review-checklist]` and `layers.context: [./context/house-style.md]`.",
        status: "specified",
        docs: [SCHEMA.example],
      },
      {
        from: "workflow",
        to: "nodeLayer",
        title: "The node is the last word",
        detail:
          "`security` has no skills of its own in the example; it sets `model: opus` and `isolation: readonly`.",
        status: "specified",
      },
      {
        from: "nodeLayer",
        to: "resolver",
        title: "The layers are resolved",
        detail:
          "One winner per skill name; shadowed project skills go on no list.",
        status: "specified",
        docs: [DESIGN.context],
      },
      {
        from: "project",
        to: "agentsRule",
        title: "`AGENTS.md` is checked",
        detail: "If the repo has `CLAUDE.md`, nothing is added.",
        status: "specified",
      },
      {
        from: "brief",
        to: "assembler",
        title: "The builder's brief is rendered",
        detail:
          "Its prompt plus the builder's branch, as a reference, not a diff pasted in.",
        status: "specified",
      },
      {
        from: "assembler",
        to: "sysprompt",
        title: "The stable prefix is built",
        detail:
          "Same order every round, so round 2's review hits the cache that round 1 filled.",
        status: "specified",
      },
      {
        from: "resolver",
        to: "limits",
        title: "Limits come from the node and defaults",
        detail:
          "opus from the node; `budgetUsd: 2` from `defaults`; write tools denied by `readonly`.",
        status: "specified",
      },
      {
        from: "plugin",
        to: "session",
        title: "A fresh session starts",
        detail: "No transcript from round 1: the worker sees only this spec.",
        status: "specified",
        docs: [DESIGN.concepts],
      },
      {
        from: "session",
        to: "report",
        title: "It reports a summary",
        detail:
          "Status `pass` or `changes_requested`, a short summary, and findings as an artifact.",
        status: "specified",
      },
    ],
  },
  {
    id: "shadowed-skill",
    title: "A workflow skill shadows a project skill",
    who: "Context compiler",
    summary:
      "The project has a `review` skill in `.claude/skills/`, and the workflow brings its own `review`. Only one may reach the session.",
    steps: [
      {
        from: "project",
        to: "workflow",
        title: "Two skills with one name",
        detail:
          "Layer 3 (project) and layer 4 (workflow) both define `review`.",
        status: "specified",
        docs: [DESIGN.context],
      },
      {
        from: "nodeLayer",
        to: "resolver",
        title: "The higher layer wins",
        detail:
          "The workflow's `review` is kept; the project's is recorded as shadowed.",
        status: "specified",
      },
      {
        from: "resolver",
        to: "settings",
        title: "The project's skill is switched off",
        detail:
          "It is left out of the session's skill allow-list, so Claude Code does not load it.",
        status: "specified",
      },
      {
        from: "resolver",
        to: "plugin",
        title: "The workflow's skill goes in the plugin",
        detail:
          "Namespaced as a plugin skill, so nothing collides at run time.",
        status: "specified",
      },
      {
        from: "explain",
        to: "resolver",
        title: "`ork context explain` shows why",
        detail:
          "It lists `review` from the workflow, with the project's `review` marked as shadowed.",
        status: "specified",
        docs: [DESIGN.cli],
      },
    ],
  },
];
