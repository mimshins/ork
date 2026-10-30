/** @file The feedback map's journeys. */

import { DESIGN } from "../refs.js";

/** @typedef {import("../types.js").Journey} Journey */

/** @type {ReadonlyArray<Journey>} */
export const JOURNEYS = [
  {
    id: "report",
    title: "An agent reports friction",
    who: "builder · Ork · you",
    summary:
      "The builder hits a gap in its brief and says so; the same run adds a signal of its own. Both end up as items in `ork feedback list`.",
    steps: [
      {
        from: "tool",
        title: "The builder calls `feedback`",
        detail:
          'Its brief did not name the spec\'s artifact path, so it spent turns finding it: `feedback(kind: "context-gap", target: "workflow", …)`, with event ids as evidence.',
        status: "specified",
        docs: [DESIGN.feedback],
      },
      {
        from: "tool",
        to: "recorder",
        title: "Within the cap, not a duplicate",
        detail:
          "Its first report this session (the cap is 3), and nothing like it earlier in the run, so it is kept.",
        status: "specified",
      },
      {
        from: "recorder",
        title: "Masked and fingerprinted",
        detail:
          "Secrets are masked before anything is written. The agent chose the target, so the pre-filled one is overridden. The fingerprint is target, kind, error code and normalized title.",
        status: "specified",
      },
      {
        from: "recorder",
        to: "table",
        title: "It joins an item",
        detail:
          "Two earlier runs reported the same thing, so the item's count goes to 3 and its last seen moves.",
        status: "specified",
      },
      {
        from: "recorder",
        to: "events",
        title: "`feedback.recorded` in the run's stream",
        detail: "So logs and the UI show it in context.",
        status: "specified",
      },
      {
        from: "events",
        to: "signals",
        title: "The run's events yield a signal",
        detail:
          "Later, the review loop hits `maxRounds` and escalates. No model is asked; the event says it.",
        status: "specified",
        docs: [DESIGN.feedback],
      },
      {
        from: "signals",
        to: "recorder",
        title: "Recorded the same way",
        detail:
          "Masked, fingerprinted and grouped like the agent's report; the target is pre-filled as `workflow`.",
        status: "specified",
      },
      {
        from: "you",
        to: "feedbackCmd",
        title: "You run `ork feedback list`",
        detail: "To see what the runs have reported.",
        status: "specified",
        docs: [DESIGN.cli],
      },
      {
        from: "feedbackCmd",
        to: "table",
        title: "A short list of items",
        detail:
          "Each with its count, first and last seen, and the runs and models it came from. `show` opens one; `dismiss` closes it.",
        status: "specified",
      },
    ],
  },
  {
    id: "lesson",
    title: "Triage, then a lesson",
    who: "You · ork:feedback-triage",
    summary:
      "You triage new items, accept one as a lesson, and the workflow's next run starts knowing it.",
    steps: [
      {
        from: "you",
        to: "actions",
        title: "You run `ork feedback triage`",
        detail: "Over every item still `new`.",
        status: "planned",
        docs: [DESIGN.cli],
      },
      {
        from: "actions",
        to: "triage",
        title: "Ork runs its own triage workflow",
        detail:
          "`ork:feedback-triage` is a workflow like yours, run by the same engine.",
        status: "planned",
        docs: [DESIGN.feedback],
      },
      {
        from: "triage",
        to: "table",
        title: "Items merged and summarized",
        detail:
          "Near-duplicates become one item, each gets a summary and a proposed fix, and they are marked `triaged`.",
        status: "planned",
      },
      {
        from: "you",
        to: "actions",
        title: "You accept an item as a lesson",
        detail:
          'The builder\'s context gap: "The spec is at `nodes.spec.output.artifacts.spec`." Feedback is model output, so only your acceptance makes it a lesson.',
        status: "planned",
      },
      {
        from: "actions",
        to: "apply",
        title: "The lesson is written",
        detail: "The item becomes `accepted`.",
        status: "planned",
      },
      {
        from: "apply",
        to: "lessons",
        title: "Into `.ork/lessons/software-factory.md`",
        detail: "A committed file you can review, edit and version with git.",
        status: "planned",
        docs: [DESIGN.feedback],
      },
      {
        from: "lessons",
        to: "compiler",
        title: "The next run loads it",
        detail:
          "As part of the workflow layer, for every node of that workflow; the 1,500-token cap is planned.",
        status: "partial",
        docs: [DESIGN.context],
      },
      {
        from: "compiler",
        title: "`ork context explain` shows it",
        detail: "Listed under the workflow layer, with its estimated tokens.",
      },
    ],
  },
  {
    id: "fix",
    title: "Apply a fix",
    who: "You · a fixer node",
    summary:
      "Instead of a lesson, you ask for a real fix; it arrives as a diff you accept or decline.",
    steps: [
      {
        from: "you",
        to: "actions",
        title: "You run `ork feedback apply <item>`",
        detail: "On a triaged `workflow` or `project` item.",
        status: "planned",
        docs: [DESIGN.cli],
      },
      {
        from: "actions",
        to: "apply",
        title: "A node proposes the fix",
        detail:
          "For example, an edit to the builder's brief in the workflow file, or a line in `AGENTS.md`.",
        status: "planned",
        docs: [DESIGN.feedback],
      },
      {
        from: "apply",
        to: "decisions",
        title: "The diff becomes a decision",
        detail: "Nothing is applied while it waits.",
        status: "planned",
      },
      {
        from: "actions",
        to: "decisions",
        title: "You read it and accept",
        detail: "Decline, and nothing changes.",
        status: "planned",
      },
      {
        from: "apply",
        to: "repoFiles",
        title: "It lands on a branch",
        detail: "You review and merge it like any other change.",
        status: "planned",
      },
    ],
  },
  {
    id: "publish",
    title: "Publish to Ork's Discussions",
    who: "You · your gh · Ork's maintainers",
    summary:
      'You share an `ork` item with Ork\'s maintainers: redacted, previewed, confirmed, and posted with your own `gh`, as a "+1" when the thread exists.',
    steps: [
      {
        from: "you",
        to: "actions",
        title: "You run `ork feedback publish <item>`",
        detail:
          "For an `ork` item, for example a tool error seen in a dozen runs. Opt-in, one item at a time.",
        status: "planned",
        docs: [DESIGN.feedback],
      },
      {
        from: "actions",
        to: "publish",
        title: "Only `ork` items go out",
        detail: "`workflow` and `project` items stay local.",
        status: "planned",
      },
      {
        from: "publish",
        title: "Redacted",
        detail:
          "Secrets, emails and hostnames removed; absolute paths rewritten to `<project>/…`; repo and workflow names too, if you ask.",
        status: "planned",
      },
      {
        from: "publish",
        title: "A header and a marker",
        detail:
          "Ork version, driver, model, node type, kind and count, and a hidden `<!-- ork-fingerprint: … -->`.",
        status: "planned",
      },
      {
        from: "publish",
        to: "decisions",
        title: "You see the exact text",
        detail: "As a decision: what you confirm is what is posted.",
        status: "planned",
      },
      {
        from: "actions",
        to: "decisions",
        title: "You confirm",
        detail: "Decline, and nothing leaves your machine.",
        status: "planned",
      },
      {
        from: "publish",
        to: "gh",
        title: "Your `gh` looks for the marker",
        detail:
          'In the "Agent feedback" category, found by its slug `agent-feedback`.',
        status: "planned",
      },
      {
        from: "gh",
        to: "discussions",
        title: 'A "+1" on the existing thread',
        detail:
          "With the new context as a comment. With no match, a new discussion starts.",
        status: "planned",
      },
      {
        from: "table",
        title: "The item is `published`",
        detail: "Its status becomes `published`.",
        status: "planned",
      },
    ],
  },
];
